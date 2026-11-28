/**
 * A record's day on the user's own calendar (C2.6, C2.4–C2.8).
 *
 * The server stores instants; every page used to print the first ten
 * characters of the UTC instant, so a line said at 00:30 in Shanghai
 * (16:30 UTC the day before) was shown under the previous day. The day
 * a person remembers is the day it was where they live.
 */
import { zonedDateKey } from "@shared/timezone";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * A calendar day (`2022-03-01`), or a wall clock with no zone of its own
 * (`2022-03-01 16:30`, `2022-03-01T16:30:00`).
 *
 * These name a day where the person lives; they are not instants. A
 * value with an explicit zone designator (`Z`, `+08:00`) is an instant
 * and still has to be converted — those are the ones the server stores.
 */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/**
 * The calendar day of an instant in a zone, as `YYYY-MM-DD`.
 *
 * Falls back to the first ten characters when the input is not readable
 * and to the UTC day when the zone is unknown. An ISO date without a
 * time, a value the app already stores as a day key, and a zone-less wall
 * clock pass through untouched: they are calendar days already, and
 * reading them as instants shifted every one of them a day west of
 * Greenwich (a `2022-03-01` line showed as `2022-02-28` in New York).
 */
export function dayKeyInZone(
  value: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!value) return "";
  const text = String(value);
  const calendar = CALENDAR_DAY.exec(text.trim());
  if (calendar) return `${calendar[1]}-${calendar[2]}-${calendar[3]}`;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return text.slice(0, 10);
  return zonedDateKey(at, timezone || "UTC") || text.slice(0, 10);
}

/** The same, bound to the signed-in person's time zone. */
export function useDayKey(): (value: string | null | undefined) => string {
  const { user } = useAuth();
  const timezone = (user as { timezone?: string | null } | null)?.timezone ?? null;
  return (value) => dayKeyInZone(value, timezone);
}
