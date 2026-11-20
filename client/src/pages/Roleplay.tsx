import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DigitalPersonaBadge from "@/components/DigitalPersonaBadge";
import CrisisCard from "@/components/CrisisCard";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { toast } from "sonner";

/**
 * The role swap (C4.4).
 *
 * The user plays the person; the app plays the user, rebuilt from their
 * own lines. The limits are shown and enforced by the server. The page
 * is a practice room, so it says what it is at the top and nowhere does
 * it pretend to be the real conversation.
 */
type Turn = { role: "user" | "assistant"; content: string };

export default function Roleplay() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const { t } = useLocale();
  const [, navigate] = useLocation();

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [turnsLeft, setTurnsLeft] = useState(30);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [ended, setEnded] = useState(false);
  const [crisis, setCrisis] = useState(false);
  const [note, setNote] = useState("");

  const start = trpc.roleplay.start.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setRemaining(data.remainingSeconds);
      setTurnsLeft(data.remainingTurns);
      setTurns([]);
      setEnded(false);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const say = trpc.roleplay.say.useMutation({
    onSuccess: (data, variables) => {
      setTurns((current) => [...current, { role: "user", content: variables.text }]);
      if (data.ended) {
        setEnded(true);
        setCrisis(Boolean((data as { crisis?: boolean }).crisis));
        return;
      }
      setTurns((current) => [...current, { role: "assistant", content: (data as any).reply }]);
      setRemaining((data as any).remainingSeconds);
      setTurnsLeft(30 - (data as any).turns);
    },
    onError: (error: any) => toast.error(error.message),
  });
  const end = trpc.roleplay.end.useMutation({
    onSuccess: () => {
      setEnded(true);
      toast.success(t("roleplay.saved"));
    },
    onError: (error: any) => toast.error(error.message),
  });

  if (!Number.isFinite(personaId) || personaId <= 0) return <NotFound />;
  if (persona.isLoading) return <PageLoader />;
  if (persona.isError) {
    const code = (persona.error as { data?: { code?: string } } | null)?.data?.code;
    if (code === "NOT_FOUND") return <NotFound />;
    return (
      <div className="container max-w-2xl py-16 text-center space-y-3">
        <p className="text-sm text-foreground/85">{t("common.error")}</p>
        <Button variant="outline" onClick={() => persona.refetch()}>{t("common.retry")}</Button>
      </div>
    );
  }
  if (!persona.data) return <NotFound />;

  const name = persona.data.name;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  function send() {
    const text = input.trim();
    if (!text || !sessionId || say.isPending) return;
    setInput("");
    say.mutate({ sessionId, text });
  }

  return (
    <div className="container max-w-2xl py-6 space-y-4">
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
          aria-label={t("common.back")}
          className="app-nav-icon mt-1"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t("roleplay.title")}</h1>
            <DigitalPersonaBadge compact />
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("roleplay.topNote", { name })}
          </p>
        </div>
      </header>

      <p className="text-xs text-muted-foreground" data-roleplay-clock>
        {t("roleplay.remaining", { time: clock })} · {t("roleplay.turnsLeft", { n: Math.max(0, turnsLeft) })}
      </p>

      {!sessionId && !ended ? (
        <Button size="sm" onClick={() => start.mutate({ personaId })} disabled={start.isPending}>
          {t("roleplay.start")}
        </Button>
      ) : null}

      {crisis ? <CrisisCard onClose={() => setCrisis(false)} /> : null}

      {turns.length > 0 ? (
        <ul className="space-y-2">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={`rounded-xl border border-border/60 p-3 ${
                turn.role === "assistant" ? "bg-muted/20" : ""
              }`}
            >
              <p className="text-[11px] text-muted-subtle mb-1">
                {turn.role === "assistant" ? t("roleplay.rebuiltYou") : t("roleplay.youAreThem", { name })}
              </p>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{turn.content}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {sessionId && !ended ? (
        <div className="space-y-2">
          <Textarea
            value={input}
            rows={2}
            maxLength={2000}
            placeholder={t("roleplay.placeholder", { name })}
            aria-label={t("roleplay.placeholder", { name })}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="flex justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => end.mutate({ sessionId, note: note.trim() || undefined })}
            >
              {t("roleplay.end")}
            </Button>
            <Button size="sm" onClick={send} disabled={!input.trim() || say.isPending}>
              <Send className="w-3.5 h-3.5" />
              {t("roleplay.send")}
            </Button>
          </div>
        </div>
      ) : null}

      {ended ? (
        <section className="surface p-4 space-y-2">
          <p className="text-sm leading-relaxed text-foreground/90">{t("roleplay.endCard", { name })}</p>
          <Textarea
            value={note}
            rows={3}
            maxLength={20_000}
            placeholder={t("roleplay.notePlaceholder")}
            aria-label={t("roleplay.notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={!note.trim() || end.isPending || !sessionId}
              onClick={() => {
                if (!sessionId) return;
                end.mutate({ sessionId, note: note.trim() });
              }}
            >
              {t("roleplay.saveNote")}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
