import { useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft, CornerUpLeft, Inbox, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import CrisisCard from "@/components/CrisisCard";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { useLocation } from "wouter";
import { toast } from "sonner";

/**
 * The rehearsal room (C3.2).
 *
 * Practice, not conversation. The page says so at the top, the cards say
 * what they are ("about N times in ten"), and nothing here is saved as a
 * message. The only two ways out are the ones the room names: say it
 * differently, or keep the sentence for the way-out list.
 */
interface Variant {
  act: string;
  share: number;
  text: string | null;
  silent: boolean;
}

export default function Rehearsal() {
  const params = useParams<{ id: string }>();
  const personaId = Number(params.id);
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const [line, setLine] = useState("");
  const [result, setResult] = useState<
    | { mode: "variants"; variants: Variant[]; id?: number }
    | { mode: "my_side_only"; id?: number }
    | { mode: "crisis" }
    | null
  >(null);

  const persona = trpc.persona.get.useQuery({ id: personaId }, { enabled: personaId > 0 });
  const run = trpc.rehearsal.run.useMutation({
    onSuccess: (data) => setResult(data as never),
    onError: (error: any) => toast.error(error.message),
  });
  const keep = trpc.rehearsal.keep.useMutation({
    onSuccess: () => toast.success(t("rehearsal.kept")),
    onError: (error: any) => toast.error(error.message),
  });
  /**
   * "Say it another way" goes through the wording assistant (C3.6).
   *
   * The assistant works on a sentence in the way-out list, so the line
   * is kept first and the user lands on the page that holds the list.
   * The old button went back to the chat, where there is no assistant.
   */
  const keepForWording = trpc.rehearsal.keep.useMutation({
    onSuccess: () => {
      toast.success(t("rehearsal.kept"));
      navigate(`/persona/${personaId}/graduation`);
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
  const unavailable =
    persona.data.graduationStatus === "graduated" || persona.data.presence === "asleep";

  function submit() {
    const trimmed = line.trim();
    if (!trimmed) return;
    setResult(null);
    run.mutate({ personaId, line: trimmed });
  }

  return (
    <div className="container max-w-2xl py-6 space-y-5">
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => navigate(`/persona/${personaId}/profile`)}
          aria-label={t("common.back")}
          className="app-nav-icon mt-1"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="page-title">{t("rehearsal.title")}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            {t("rehearsal.topNote", { name })}
          </p>
        </div>
      </header>

      {unavailable ? (
        <p className="surface p-4 text-sm text-muted-foreground">{t("rehearsal.unavailable")}</p>
      ) : (
        <>
          <div className="space-y-2">
            <Textarea
              value={line}
              rows={2}
              maxLength={2000}
              placeholder={t("rehearsal.placeholder")}
              aria-label={t("rehearsal.placeholder")}
              onChange={(event) => setLine(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-subtle">{t("rehearsal.cost")}</p>
              <Button
                size="sm"
                onClick={submit}
                disabled={!line.trim() || run.isPending}
              >
                {run.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {run.isPending ? t("rehearsal.running") : t("rehearsal.run")}
              </Button>
            </div>
          </div>

          {result?.mode === "crisis" ? <CrisisCard onClose={() => setResult(null)} /> : null}

          {result?.mode === "variants" ? (
            <section className="space-y-3">
              {result.variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("rehearsal.notGenerated")}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {result.variants.map((variant) => (
                    <div key={variant.act} className="surface p-3 space-y-2">
                      <p className="text-[11px] text-muted-subtle">
                        {t("rehearsal.card", {
                          n: Math.round(variant.share * 10),
                          act: variant.silent
                            ? t("rehearsal.acts.silence")
                            : t(`rehearsal.acts.${variant.act}` as never),
                        })}
                      </p>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {variant.silent
                          ? t("rehearsal.silent", { name })
                          : variant.text ?? t("rehearsal.notGenerated")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {result?.mode === "my_side_only" ? (
            <section className="surface p-4 space-y-3">
              <p className="text-sm leading-relaxed text-foreground/90">
                {t("rehearsal.mySideOnly", { name })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (result.id) keep.mutate({ id: result.id });
                  }}
                >
                  <Inbox className="w-3.5 h-3.5" />
                  {t("rehearsal.keep")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (result.id) keepForWording.mutate({ id: result.id });
                  }}
                >
                  <CornerUpLeft className="w-3.5 h-3.5" />
                  {t("rehearsal.sayAnotherWay")}
                </Button>
              </div>
            </section>
          ) : null}

          {result ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                {t("rehearsal.editAgain")}
              </Button>
              {result.mode === "variants" && result.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => keep.mutate({ id: result.id as number })}
                >
                  <Inbox className="w-3.5 h-3.5" />
                  {t("rehearsal.keepLine", { name })}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
