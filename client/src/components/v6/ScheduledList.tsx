import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { zonedDateKey } from "@shared/timezone";
import { toast } from "sonner";

/**
 * What has not arrived yet (C5.3).
 *
 * Kept in the letter box, because that is where the user writes the
 * things that wait. A capsule that is still ahead shows only its day; a
 * delivered one can be opened. A scheduled item that could not be
 * delivered says why instead of disappearing.
 */
export default function ScheduledList({
  personaId,
  name = "",
}: {
  personaId: number;
  name?: string;
}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const timezone = (user as any)?.timezone ?? null;
  const query = trpc.scheduled.list.useQuery({ personaId });
  const utils = trpc.useUtils();
  const cancel = trpc.scheduled.cancel.useMutation({
    onSuccess: () => {
      utils.scheduled.list.invalidate({ personaId });
      query.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const [opened, setOpened] = useState<number | null>(null);
  const open = trpc.scheduled.open.useQuery(
    { id: opened ?? 0 },
    { enabled: opened !== null },
  );
  /**
   * The mailbox counts a due capsule as waiting until it is opened
   * (C8.2), so opening says so.
   */
  const markOpened = trpc.scheduled.markOpened.useMutation();
  const toggleOpen = (id: number) => {
    const next = opened === id ? null : id;
    setOpened(next);
    if (next !== null) {
      markOpened.mutate({ id: next }, {
        onSuccess: () => {
          utils.letter.inbox.invalidate();
          utils.letter.unreadCount.invalidate();
        },
      });
    }
  };

  if (query.isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (query.isError) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("scheduled.loadFailed")}{" "}
        <button type="button" onClick={() => query.refetch()} className="underline underline-offset-2">
          {t("common.retry")}
        </button>
      </p>
    );
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  const dateOf = (iso: string) => zonedDateKey(new Date(iso), timezone);
  const reasonOf = (reason: string | null) => {
    const map: Record<string, string> = {
      asleep: "scheduled.reasonAsleep",
      sealed: "scheduled.reasonSealed",
      closed: "scheduled.reasonClosed",
      deleted: "scheduled.reasonDeleted",
    };
    return t((map[reason ?? ""] ?? "scheduled.reasonClosed") as never, {
      name: name || t("common.them"),
    });
  };

  return (
    <section className="space-y-2" aria-label={t("scheduled.title")}>
      <p className="kicker">{t("scheduled.title")}</p>
      <ul className="space-y-2">
        {items.map((item) => {
          const date = dateOf(item.dueAt);
          const pendingText =
            item.kind === "capsule"
              ? t("scheduled.pendingCapsule", { date })
              : item.kind === "letter"
                ? t("scheduled.pendingLetter", { date })
                : t("scheduled.pendingMessage", { date });
          return (
            <li key={item.id} className="rounded-lg border border-border/70 px-3 py-2 space-y-1.5">
              {item.state === "pending" && (
                <>
                  <p className="text-xs text-muted-foreground">{pendingText}</p>
                  {item.kind !== "capsule" && item.body && (
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words">{item.body}</p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ id: item.id })}
                  >
                    {t("scheduled.cancel")}
                  </Button>
                </>
              )}
              {item.state === "ready" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleOpen(item.id)}
                  >
                    {opened === item.id ? t("scheduled.close") : t("scheduled.open")}
                  </Button>
                  {opened === item.id && (
                    <>
                      {open.isError && (
                        <p className="text-xs text-muted-foreground">
                          {t("common.error")}{" "}
                          <button type="button" onClick={() => open.refetch()} className="underline underline-offset-2">
                            {t("common.retry")}
                          </button>
                        </p>
                      )}
                      {open.data?.body && (
                        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                          {open.data.body}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {item.state === "cancelled" && (
                <p className="text-xs text-muted-foreground">
                  {t("scheduled.cancelled", { date, reason: reasonOf(item.reason) })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
