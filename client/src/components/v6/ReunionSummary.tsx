import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { zonedDateKey } from "@shared/timezone";
import { isUserMood } from "@shared/user-side";
import { toast } from "sonner";

/**
 * What the user gathered while they could not reach each other (C5.4).
 *
 * Four blocks, from things the user wrote or recorded — no model, no
 * synthesis. The page opens once when the state changes back, and stays
 * behind an entry on the profile until the user puts it away.
 */
export default function ReunionSummary({
  personaId,
  name,
  open,
  onClose,
}: {
  personaId: number;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const utils = trpc.useUtils();
  const [dismissed, setDismissed] = useState(false);
  const summary = trpc.persona.reunionSummary.useQuery(
    { personaId },
    { enabled: open },
  );
  const dismiss = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      setDismissed(true);
      utils.persona.get.invalidate();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const addEvent = trpc.relationship.add.useMutation({
    onSuccess: () => toast.success(t("reunion.saved")),
    onError: (error) => toast.error(error.message),
  });

  if (!open || dismissed) return null;

  const data = summary.data;
  const day = (value: string) => zonedDateKey(new Date(value), timezone);

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("reunion.title")}
        className="surface relative w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="section-title">{t("reunion.title")}</h2>
        {summary.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {summary.isError && (
          <p className="text-sm text-muted-foreground">
            {t("common.error")}{" "}
            <button type="button" onClick={() => summary.refetch()} className="underline underline-offset-2">
              {t("common.retry")}
            </button>
          </p>
        )}
        {data && !data.dismissed && (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("reunion.note", { from: day(data.from), to: day(data.to) })}
            </p>
            {data.todos.length === 0
              && data.unsaid.length === 0
              && data.letters.length === 0
              && data.moods.length === 0
              && data.answers.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("reunion.empty")}</p>
              )}
            {data.todos.length > 0 && (
              <section className="space-y-1.5">
                <p className="kicker">{t("reunion.todos", { name })}</p>
                <ul className="space-y-1 text-sm">
                  {data.todos.map((row) => (
                    <li key={row.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 whitespace-pre-wrap">
                      {row.body}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.unsaid.length > 0 && (
              <section className="space-y-1.5">
                <p className="kicker">{t("reunion.unsaid")}</p>
                <ul className="space-y-1 text-sm">
                  {data.unsaid.map((row) => (
                    <li key={row.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 whitespace-pre-wrap">
                      {row.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.letters.length > 0 && (
              <section className="space-y-1.5">
                <p className="kicker">{t("reunion.letters")}</p>
                <ul className="space-y-1 text-sm">
                  {data.letters.map((row) => (
                    <li key={row.id} className="rounded-md bg-muted/40 px-2.5 py-1.5 whitespace-pre-wrap">
                      {row.body}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(data.moods.length > 0 || data.answers.length > 0) && (
              <section className="space-y-1.5">
                <p className="kicker">{t("reunion.moods")}</p>
                <ul className="space-y-1 text-sm">
                  {data.moods.map((row) => (
                    <li key={row.date} className="text-muted-foreground">
                      {row.date} ·{" "}
                      {isUserMood(row.mood) ? t(`moodCheckIn.moods.${row.mood}` as never) : row.mood}
                    </li>
                  ))}
                  {data.answers.map((row, index) => (
                    <li key={`answer-${index}`} className="text-muted-foreground">
                      {t("reunion.answers")} ·{" "}
                      {["better", "same", "worse", "skipped"].includes(row.answer)
                        ? t(`afterChat.${row.answer}` as never)
                        : row.answer}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={addEvent.isPending}
                onClick={() =>
                  addEvent.mutate({
                    personaId,
                    kind: "reunion",
                    title: t("reunion.eventTitle"),
                    happenedAt: zonedDateKey(new Date(), timezone),
                  })
                }
              >
                {t("reunion.record")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dismiss.isPending}
                onClick={() =>
                  dismiss.mutate({
                    id: personaId,
                    patch: {
                      lastReunion: { from: data.from, to: data.to, dismissed: true },
                    },
                  })
                }
              >
                {t("reunion.dismiss")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
