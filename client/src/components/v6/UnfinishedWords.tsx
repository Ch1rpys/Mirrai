/**
 * The lines they started and never finished (C6.5).
 *
 * Everything in this block is their own words, read from the record.
 * The one reconstructed line is only written after the user presses the
 * button, sits in a card that says it was rebuilt, and is never stored.
 * There is no copy button and no share button: a line the real person
 * did not say must not leave this page as if it were theirs.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useDayKey } from "@/lib/day";
import { formatDayKey } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface UnfinishedItem {
  kind: "open_loop" | "trailing";
  recordId: number;
  text: string;
  at: string | null;
  context: Array<{ recordId: number; role: string; text: string; at: string | null }>;
}

export default function UnfinishedWords({
  personaId,
  name,
}: {
  personaId: number;
  name: string;
}) {
  const { t, locale } = useLocale();
  const dayOf = useDayKey();
  const list = trpc.unsaid.list.useQuery({ personaId });
  const [answers, setAnswers] = useState<Record<number, string | null>>({});

  const complete = trpc.unsaid.complete.useMutation({
    onSuccess: (data: { text: string | null }, variables: { recordId: number }) => {
      setAnswers((previous) => ({ ...previous, [variables.recordId]: data.text }));
    },
  });

  const items: UnfinishedItem[] = list.data?.items ?? [];

  if (list.isLoading) {
    return <p className="text-xs text-muted-subtle">{t("unsaid.loading")}</p>;
  }
  if (list.isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground/80">{t("unsaid.failed")}</p>
        <Button size="sm" variant="outline" onClick={() => list.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">{t("unsaid.title", { name })}</h2>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          {t("unsaid.note", { name })}
        </p>
      </div>
      <ul className="space-y-3">
        {items.map((item) => {
          const date = dayOf(item.at);
          const answer = answers[item.recordId];
          const answered = Object.prototype.hasOwnProperty.call(answers, item.recordId);
          const busy =
            complete.isPending &&
            (complete.variables as { recordId?: number } | undefined)?.recordId ===
              item.recordId;
          return (
            <li key={`${item.kind}:${item.recordId}`} className="rounded-xl border border-border/70 p-4">
              {item.context.length > 0 && (
                <div className="space-y-0.5 mb-2">
                  {item.context.map((line) => (
                    <p key={line.recordId} className="text-[0.6875rem] text-muted-subtle truncate">
                      {line.role === "assistant" ? `${name}：` : ""}
                      {line.text}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-sm text-foreground whitespace-pre-wrap">{item.text}</p>
              <div className="flex items-center justify-between gap-3 mt-2">
                <span className="text-[0.6875rem] text-muted-subtle">
                  {date ? formatDayKey(date, locale) : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || answered}
                  onClick={() => complete.mutate({ personaId, recordId: item.recordId })}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {busy ? t("unsaid.writing") : t("unsaid.complete")}
                </Button>
              </div>
              {answered && (
                <div className="mt-3 rounded-lg border border-dashed border-border p-3 bg-muted/20">
                  <p className="text-[0.6875rem] uppercase tracking-wide text-muted-subtle">
                    {t("unsaid.reconstructedTitle", { name })}
                  </p>
                  <p className="text-sm text-foreground/85 mt-1 whitespace-pre-wrap">
                    {answer ?? t("unsaid.cannot")}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
