import { useLocation } from "wouter";
import { CalendarHeart } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { zonedDateKey } from "@shared/timezone";

/**
 * The meeting-day line (C3.7).
 *
 * On the day the two of them are supposed to meet, the chat says the
 * meeting list exists — once, as a line, with no dialog and no
 * notification. Any other day it says nothing at all.
 */
export default function MeetDayNote({
  personaId,
  name,
  nextMeetAt,
  timezone,
  now,
}: {
  personaId: number;
  name: string;
  nextMeetAt?: string | null;
  /**
   * The *user's* own zone. The manual's acceptance is that the entry
   * appears on the meeting day where the reader is — TA's zone would
   * put the line on the wrong day when the two calendars disagree.
   */
  timezone?: string | null;
  /** Fixed in tests. */
  now?: Date;
}) {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const { data, isError, refetch } = trpc.letter.todos.useQuery({ personaId });

  if (!nextMeetAt) return null;
  const meetDay = /^\d{4}-\d{2}-\d{2}$/.test(nextMeetAt)
    ? nextMeetAt
    : zonedDateKey(new Date(nextMeetAt), timezone);
  const today = zonedDateKey(now ?? new Date(), timezone);
  if (Number.isNaN(new Date(nextMeetAt).getTime()) && !/^\d{4}-\d{2}-\d{2}$/.test(nextMeetAt)) {
    return null;
  }
  if (meetDay !== today) return null;

  if (isError) {
    return (
      <div className="container max-w-2xl mx-auto px-4 pt-3">
        <p className="text-[11px] text-muted-foreground">
          {t("common.error")}{" "}
          <button type="button" onClick={() => refetch()} className="underline underline-offset-2">
            {t("common.retry")}
          </button>
        </p>
      </div>
    );
  }

  const open = (data?.todos ?? []).filter((todo: any) => !todo.doneAt).length;
  if (open === 0) return null;

  return (
    <div className="container max-w-2xl mx-auto px-4 pt-3">
      <button
        type="button"
        onClick={() => navigate(`/persona/${personaId}/edit`)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <CalendarHeart className="w-3.5 h-3.5" />
        {t("meetDay.entry", { n: open, name })}
      </button>
    </div>
  );
}
