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
 * The calendar day of an instant in a zone, as `YYYY-MM-DD`.
 *
 * Falls back to the UTC day when the input is not a readable instant or
 * the zone is unknown — an ISO date string without a time, and a value
 * the app already stores as a day key, pass through untouched.
 */
export function dayKeyInZone(
  value: string | null | undefined,
  timezone: string | null | undefined,
): string {
  if (!value) return "";
  const text = String(value);
  // Already a day, e.g. "2022-03-01" or "2022-03-01T00:00:00+08:00".
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
