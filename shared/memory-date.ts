/**
 * Dates a memory is allowed to carry.
 *
 * An anniversary is either a real day ("2021-05-21") or a month and a
 * day ("05-21"). Anything else used to be stored as a date, and the
 * anniversary sweep could never match it.
 */
import { isRealDayKey } from "./timezone";

export function isMemoryDate(value: string): boolean {
  const trimmed = value.trim();
  if (isRealDayKey(trimmed)) return true;
  const match = /^(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // The last day of that month. `Date.UTC` counts the month from zero,
  // and a day of zero is the last day of the month before — which is
  // the month we want.
  const lastDay = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  return day <= lastDay;
}
