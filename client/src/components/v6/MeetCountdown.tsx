import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { meetCountdown } from "@shared/persona-state";

/**
 * The meeting countdown (C5.1).
 *
 * A line while the day is ahead, "you meet today" on the day, and one
 * quiet question the next time the chat is opened after it. The question
 * is answered by pressing one of its three buttons; that also clears the
 * date, so it never comes back.
 *
 * `inline` is the header line. `banner` is the question below it: no
 * modal, no toast, no notification.
 */
export default function MeetCountdown({
  personaId,
  nextMeetAt,
  timezone,
  now,
  mode = "inline",
}: {
  personaId: number;
  nextMeetAt?: string | null;
  timezone?: string | null;
  /** Fixed in tests. */
  now?: Date;
  mode?: "inline" | "banner";
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [answered, setAnswered] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const update = trpc.persona.updateSettings.useMutation({
    onSuccess: () => {
      setAnswered(true);
      utils.persona.get.invalidate();
    },
  });
  const addEvent = trpc.relationship.add.useMutation();

  const at = now ?? new Date();
  const countdown = meetCountdown(
    { settings: { ldr: { nextMeetAt: nextMeetAt ?? null, weather: false } } },
    at,
    timezone,
  );

  function clear() {
    update.mutate({ id: personaId, patch: { ldr: { nextMeetAt: null } } });
  }

  if (mode === "inline") {
    if (countdown.state === "upcoming") {
      return (
        // The full line needs the width a phone does not have; the short
        // one is what fits there. Both say when (C5.1).
        <span className="text-[0.625rem] text-muted-subtle flex-shrink-0 truncate">
          <span className="sm:hidden">{t("ldr.upcomingShort", { n: countdown.days })}</span>
          <span className="hidden sm:inline">
            {t("ldr.upcoming", { n: countdown.days, date: countdown.date })}
          </span>
        </span>
      );
    }
    if (countdown.state === "today") {
      return (
        <span className="text-[0.625rem] text-muted-subtle flex-shrink-0">
          {t("ldr.today")}
        </span>
      );
    }
    return null;
  }

  if (countdown.state !== "past" || answered) return null;

  return (
    <div className="container max-w-2xl mx-auto px-4 pt-3">
      <div className="surface px-4 py-3 space-y-2">
        <p className="text-sm">{t("ldr.askPast", { date: countdown.date })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              addEvent.mutate({
                personaId,
                kind: "meetup",
                title: t("ldr.metEvent"),
                happenedAt: countdown.date,
              });
              clear();
            }}
          >
            {t("ldr.met")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setRescheduling(true);
              setNewDate("");
            }}
          >
            {t("ldr.rescheduled")}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear}>
            {t("ldr.dropped")}
          </Button>
        </div>
        {rescheduling && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              aria-label={t("ldr.newDate")}
              value={newDate}
              onChange={(event) => setNewDate(event.target.value)}
              className="w-44"
            />
            <Button
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
                update.mutate({ id: personaId, patch: { ldr: { nextMeetAt: newDate } } });
              }}
            >
              {t("ldr.confirmDate")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
