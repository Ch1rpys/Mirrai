/**
 * When they are usually asleep, read from the hours they never write.
 *
 * A half-hour that almost never has a message is quiet. The longest
 * quiet stretch, if it is between four and twelve hours, is sleep.
 * A busy hour is not guessed from silence — that is a confirmed routine.
 */
import { zonedDateKey, zonedHour, zonedMinute, parseZoneless } from "./timezone";

export interface RoutineProfile {
  days: number;
  /** Minutes from midnight. endMin may be less than startMin when it crosses midnight. */
  sleep?: { startMin: number; endMin: number };
}

export interface RoutineRow {
  role: string;
  timestamp?: Date | string | null;
}

const SLOTS = 48;
const SLOT_MINUTES = 30;
const DAY_MINUTES = 24 * 60;
const MIN_DAYS = 60;
const MIN_QUIET_SLOTS = 8; // 4 hours
const MAX_QUIET_SLOTS = 24; // 12 hours

function at(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minuteOfDay(date: Date, timeZone: string): number {
  return zonedHour(date, timeZone) * 60 + zonedMinute(date, timeZone);
}

export function formatMinuteOfDay(minute: number): string {
  const wrapped = ((minute % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function measureRoutine(rows: RoutineRow[], personaTimeZone: string): RoutineProfile | null {
  const slotDays: Array<Set<string>> = Array.from({ length: SLOTS }, () => new Set());
  const allDays = new Set<string>();
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const when = at(row.timestamp);
    if (!when) continue;
    const day = zonedDateKey(when, personaTimeZone);
    allDays.add(day);
    const slot = Math.floor(minuteOfDay(when, personaTimeZone) / SLOT_MINUTES) % SLOTS;
    slotDays[slot].add(day);
  }
  const days = allDays.size;
  if (days < MIN_DAYS) return null;
  const quiet = slotDays.map((set) => set.size / days < 0.01);
  let best = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < SLOTS * 2; i++) {
    if (quiet[i % SLOTS]) {
      if (run === 0) runStart = i;
      run += 1;
      if (run > best && run <= SLOTS) {
        best = run;
        bestStart = runStart % SLOTS;
      }
    } else {
      run = 0;
    }
  }
  const profile: RoutineProfile = { days };
  if (best >= MIN_QUIET_SLOTS && best <= MAX_QUIET_SLOTS) {
    const startMin = bestStart * SLOT_MINUTES;
    const endMin = (startMin + best * SLOT_MINUTES) % DAY_MINUTES;
    profile.sleep = { startMin, endMin };
  }
  return profile;
}

function contains(minute: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  if (startMin < endMin) return minute >= startMin && minute < endMin;
  return minute >= startMin || minute < endMin;
}

export function isAsleep(now: Date, routine: RoutineProfile, timeZone: string): boolean {
  if (!routine.sleep) return false;
  return contains(minuteOfDay(now, timeZone), routine.sleep.startMin, routine.sleep.endMin);
}

function nextDateKey(key: string): string {
  const [year, month, day] = key.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day + 1));
  return utc.toISOString().slice(0, 10);
}

export function nextWake(now: Date, routine: RoutineProfile, timeZone: string): Date {
  if (!routine.sleep || !isAsleep(now, routine, timeZone)) return now;
  const end = formatMinuteOfDay(routine.sleep.endMin);
  const today = zonedDateKey(now, timeZone);
  const todayWake = parseZoneless(`${today} ${end}`, timeZone);
  if (todayWake && todayWake.getTime() > now.getTime()) return todayWake;
  const tomorrowWake = parseZoneless(`${nextDateKey(today)} ${end}`, timeZone);
  return tomorrowWake ?? now;
}

export function normalizeRoutine(value: unknown): RoutineProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const days = typeof record.days === "number" ? Math.round(record.days) : 0;
  if (days < MIN_DAYS) return null;
  const profile: RoutineProfile = { days };
  const sleep = record.sleep;
  if (sleep && typeof sleep === "object" && !Array.isArray(sleep)) {
    const startMin = (sleep as { startMin?: unknown }).startMin;
    const endMin = (sleep as { endMin?: unknown }).endMin;
    if (typeof startMin === "number" && typeof endMin === "number"
      && startMin >= 0 && startMin < DAY_MINUTES
      && endMin >= 0 && endMin < DAY_MINUTES
      && startMin !== endMin) {
      profile.sleep = { startMin, endMin };
    }
  }
  return profile;
}
