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

/** A photograph is "near" a memory within this many days. */
export const MEMORY_PHOTO_DAYS = 3;

function utcDay(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whether a calendar day (YYYY-MM-DD) is within `days` of a full date. */
export function isDayNearMemoryDate(
  dayKey: string,
  date: string,
  days = MEMORY_PHOTO_DAYS,
): boolean {
  const a = utcDay(dayKey);
  const b = utcDay(date);
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= days * 86_400_000;
}

/**
 * Whether a wall-clock day matches a month-and-day memory.
 *
 * The memory has no year ("05-21"), so the photo matches if its
 * month and day are within the window in any year. February 29 is
 * compared in a leap year so the window around late February works.
 */
export function isMonthDayNearMemoryDate(
  dayKey: string,
  date: string,
  days = MEMORY_PHOTO_DAYS,
): boolean {
  const memory = /^(\d{2})-(\d{2})$/.exec(date);
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!memory || !day) return false;
  const month = Number(memory[1]);
  const dayOfMonth = Number(memory[2]);
  const photoMonth = Number(day[2]);
  const photoDay = Number(day[3]);
  const reference = (m: number, d: number) => Date.UTC(2000, m - 1, d);
  const yearLength = 366 * 86_400_000;
  const diff = Math.abs(reference(photoMonth, photoDay) - reference(month, dayOfMonth));
  return Math.min(diff, yearLength - diff) <= days * 86_400_000;
}
