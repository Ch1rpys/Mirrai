import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import NotFound from "@/pages/NotFound";
import { toast } from "sonner";
import BlindRound, { type BlindPick } from "@/components/v6/BlindRound";
import type { FeedbackReason } from "@shared/speech-acts";

/**
 * The sitting the owner takes, or invites a friend to take.
 *
 * One pair at a time. The result waits until every pair has an answer,
 * because a running score is a hint about the remaining lines.
 */
export default function BlindTest() {
  const params = useParams<{ id: string }>();
  const personaId = Number.parseInt(params.id ?? "", 10);
  const hasPersonaId = Number.isInteger(personaId) && personaId > 0;
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const { t } = useLocale();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [subject, setSubject] = useState<"self" | "friend" | null>(null);
  const [pairs, setPairs] = useState<Array<{ first: string; second: string }>>([]);
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<{
    n: number;
    pickedReal: number;
    pickedPersona: number;
    unsure: number;
  } | null>(null);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  const { data: persona, isLoading, isError } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && hasPersonaId },
  );
  const start = trpc.blind.start.useMutation({
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const answer = trpc.blind.answer.useMutation({
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const invite = trpc.blind.invite.useMutation({
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const exportRecord = trpc.blind.exportRecord.useQuery(
    { sessionId: sessionId ?? 0 },
    { enabled: Boolean(summary && sessionId) },
  );

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, pairs]);

  if (!hasPersonaId) return <NotFound />;
  if (authLoading || (isLoading && isAuthenticated)) return <PageLoader />;
  if (isError || !persona) return <NotFound />;

  const name = persona.name;
  const current = pairs[index];

  async function begin(nextSubject: "self" | "friend") {
    const result = await start.mutateAsync({ personaId, subject: nextSubject });
    setSubject(nextSubject);
    setSessionId(result.sessionId);
    setPairs(result.groups);
    setIndex(0);
    setSummary(null);
    setInvitePath(null);
  }

  async function submit(pick: BlindPick, reason?: FeedbackReason) {
    if (sessionId == null) return;
    const seconds = Math.max(0, (Date.now() - shownAt.current) / 1000);
    const result = await answer.mutateAsync({
      sessionId,
      group: index,
      pick,
      seconds,
      reason,
    });
    if (result.done && result.summary) {
      setSummary(result.summary);
      return;
    }
    setIndex((value) => value + 1);
  }

  async function makeInvite() {
    if (sessionId == null) return;
    const result = await invite.mutateAsync({ sessionId });
    const url = `${window.location.origin}${result.path}`;
    setInvitePath(url);
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("fidelity.blind.copied"));
    } catch {
      toast.success(url);
    }
  }

  function downloadExport() {
    const markdown = exportRecord.data?.markdown;
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "blind-test.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 p-5 sm:p-8">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        onClick={() => navigate(`/persona/${personaId}/profile`)}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("fidelity.blind.title")}
      </button>
      <h1 className="font-display text-xl font-semibold">{t("fidelity.blind.title")}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("fidelity.blind.intro", { name })}
      </p>
      <p className="text-xs leading-relaxed text-muted-subtle">
        {t("fidelity.blind.introSelf")}
      </p>

      {!sessionId && !summary ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void begin("self")} disabled={start.isPending}>
            {t("fidelity.blind.startSelf")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void begin("friend")}
            disabled={start.isPending}
          >
            {t("fidelity.blind.startFriend")}
          </Button>
        </div>
      ) : null}

      {current && !summary && subject !== "friend" ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-subtle">
            {t("fidelity.blind.progress", { current: index + 1, total: pairs.length })}
          </p>
          <BlindRound
            first={current.first}
            second={current.second}
            disabled={answer.isPending}
            onSubmit={(pick, reason) => void submit(pick, reason)}
          />
        </div>
      ) : null}

      {/**
       * A friend sitting is the friend's to answer, so the owner gets
       * the link straight away — not after answering the pairs. The
       * link works from here and after the owner's own result: the
       * server starts a fresh guest sitting when the sitting it is
       * asked about is already finished.
       */}
      {subject === "friend" && !summary ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void makeInvite()}>
              {t("fidelity.blind.invite")}
            </Button>
          </div>
          {invitePath ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("fidelity.blind.inviteHint", { name, count: pairs.length })}
              <br />
              {invitePath}
            </p>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">
            {t("fidelity.blind.result", {
              n: summary.n,
              real: Math.round(summary.pickedReal * summary.n),
              persona: Math.round(summary.pickedPersona * summary.n),
              unsure: Math.round(summary.unsure * summary.n),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void makeInvite()}>
              {t("fidelity.blind.invite")}
            </Button>
            <Button type="button" variant="outline" onClick={downloadExport}>
              {t("fidelity.blind.export")}
            </Button>
          </div>
          {invitePath ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("fidelity.blind.inviteHint", { name, count: pairs.length })}
              <br />
              {invitePath}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
