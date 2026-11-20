import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";

/**
 * "How are you after that?" (C4.2)
 *
 * One line and four buttons, above the conversation, once. It does not
 * pop up, does not push, and does not leave a dot: the answer is for the
 * user, not a notification. Three "worse" in a row brings one quiet card
 * offering a pause — an offer, not a decision.
 */
export default function AfterChat({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t } = useLocale();
  const [answered, setAnswered] = useState(false);
  /**
   * The session being asked about, captured when the query first
   * returned it. Marking the question as shown makes the query return
   * null afterwards, and a background refetch must not take the
   * question away from the person who is still looking at it.
   */
  const [prompt, setPrompt] = useState<{ sessionStartAt: string } | null>(null);
  const [worseDismissed, setWorseDismissed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const { data } = trpc.checkin.pending.useQuery({ personaId });
  const answer = trpc.checkin.answer.useMutation({
    onSuccess: () => setAnswered(true),
  });
  const markPrompted = trpc.checkin.markPrompted.useMutation();
  const prompted = useRef<string | null>(null);

  /**
   * Record the asking, not just the answer.
   *
   * A person who sees the question and ignores it has not answered —
   * but they have been asked, and that is what the once-a-day rule is
   * about. The question stays on screen for this visit; the record
   * keeps the next visit from asking again.
   */
  useEffect(() => {
    const sessionStartAt = data?.pending?.sessionStartAt;
    if (!sessionStartAt || answered) return;
    setPrompt((current) => current ?? { sessionStartAt });
    if (prompted.current === sessionStartAt) return;
    prompted.current = sessionStartAt;
    markPrompted.mutate({ personaId, sessionStartAt });
  }, [data?.pending, answered, markPrompted, personaId]);
  const acknowledge = trpc.checkin.acknowledgeWorse.useMutation();
  const setQuiet = trpc.persona.update.useMutation({
    onSuccess: () => setWorseDismissed(true),
  });

  /**
   * The card is shown once.
   *
   * Showing it records that it was shown, so a reload does not bring it
   * back and the transparency panel does not collect a copy every time
   * the page opens.
   */
  useEffect(() => {
    if (!data?.worse || acknowledged) return;
    setAcknowledged(true);
    acknowledge.mutate({ personaId });
  }, [data?.worse, acknowledged, acknowledge, personaId]);

  // The first render uses the query's answer; once captured, the local
  // copy keeps the question on screen through a refetch.
  const activePrompt = prompt ?? data?.pending ?? null;
  if (activePrompt && !answered) {
    const sessionStartAt = activePrompt.sessionStartAt;
    return (
      <div
        className="container max-w-2xl mx-auto mb-3"
        data-after-chat="question"
      >
        <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <p className="text-xs text-muted-foreground mb-2">{t("afterChat.question")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => answer.mutate({ personaId, sessionStartAt, answer: "better" })}>
              {t("afterChat.better")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => answer.mutate({ personaId, sessionStartAt, answer: "same" })}>
              {t("afterChat.same")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => answer.mutate({ personaId, sessionStartAt, answer: "worse" })}>
              {t("afterChat.worse")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => answer.mutate({ personaId, sessionStartAt, answer: "skipped" })}>
              {t("afterChat.skipped")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (data?.worse && !worseDismissed) {
    return (
      <div className="container max-w-2xl mx-auto mb-3" data-after-chat="worse">
        <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("afterChat.worseCard", { name })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setQuiet.mutate({ id: personaId, presence: "quiet" })}>
              {t("afterChat.slowDown")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setWorseDismissed(true)}>
              {t("afterChat.noThanks")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
