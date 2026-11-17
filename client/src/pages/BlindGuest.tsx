import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import PageLoader from "@/components/PageLoader";
import BlindRound, { type BlindPick } from "@/components/v6/BlindRound";
import type { FeedbackReason } from "@shared/speech-acts";

/**
 * The sitting a friend takes from a link, without an account.
 *
 * The page can only see the two lines of the current pair. It cannot
 * see which is real until every pair has an answer.
 */
export default function BlindGuest() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const { t } = useLocale();
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<{
    n: number;
    pickedReal: number;
    pickedPersona: number;
    unsure: number;
  } | null>(null);
  const shownAt = useRef(Date.now());

  const { data, isLoading, isError, error } = trpc.blind.guestLoad.useQuery(
    { token },
    { enabled: token.length > 0 },
  );
  const answer = trpc.blind.guestAnswer.useMutation();

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, data?.groups]);

  if (!token) return <p className="p-6 text-sm">{t("common.error")}</p>;
  if (isLoading) return <PageLoader />;
  if (isError || !data) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        {error?.message ?? t("common.error")}
      </p>
    );
  }

  const current = data.groups[index];

  async function submit(pick: BlindPick, reason?: FeedbackReason) {
    const seconds = Math.max(0, (Date.now() - shownAt.current) / 1000);
    const result = await answer.mutateAsync({
      token,
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

  return (
    <div className="mx-auto max-w-xl space-y-6 p-5 sm:p-8">
      <h1 className="font-display text-xl font-semibold">{t("fidelity.blind.title")}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("fidelity.blind.introGuest", { name: data.name })}
      </p>
      {current && !summary ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-subtle">
            {t("fidelity.blind.progress", {
              current: index + 1,
              total: data.groups.length,
            })}
          </p>
          <BlindRound
            first={current.first}
            second={current.second}
            disabled={answer.isPending}
            onSubmit={(pick, reason) => void submit(pick, reason)}
          />
        </div>
      ) : null}
      {summary ? (
        <p className="text-sm leading-relaxed">
          {t("fidelity.blind.result", {
            n: summary.n,
            real: Math.round(summary.pickedReal * summary.n),
            persona: Math.round(summary.pickedPersona * summary.n),
            unsure: Math.round(summary.unsure * summary.n),
          })}
        </p>
      ) : null}
    </div>
  );
}
