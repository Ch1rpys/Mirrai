/**
 * What is going on in their life, and what was left unfinished.
 *
 * These are written by the user, in the persona's own jsonb, until the
 * foreign-key debt of a real table is paid. An automatic candidate from
 * the records is stored here too, unverified, and it does not reach a
 * proactive prompt until it is confirmed.
 *
 * A `routine` row is a recurring window read off the records. It only
 * counts as something in progress while the clock is inside that window.
 */
import { copy, type Locale } from "./copy";
import { zonedHour, zonedWeekday } from "./timezone";

export type LifeEventKind = "life" | "open_loop" | "routine";

export interface LifeEventEvidence {
  at?: string;
  snippet: string;
}

export interface RoutineSchedule {
  weekdays: number[];
  startHour: number;
  endHour: number;
}

export interface LifeEvent {
  id: string;
  kind: LifeEventKind;
  title: string;
  detail: string;
  /** Who said it — the user, them, or both. */
  whoSaid: string;
  /** When it ends, if it has an end. */
  endsAt?: string;
  closed: boolean;
  source: "auto" | "manual";
  verified: boolean;
  evidence: LifeEventEvidence[];
  schedule?: RoutineSchedule;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toEvidence(value: unknown): LifeEventEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: LifeEventEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = toText(record.snippet);
    if (!snippet) continue;
    const at = toText(record.at);
    out.push(at ? { at, snippet } : { snippet });
  }
  return out;
}

function toKind(value: unknown): LifeEventKind {
  if (value === "open_loop") return "open_loop";
  if (value === "routine") return "routine";
  return "life";
}

export function normalizeRoutineSchedule(value: unknown): RoutineSchedule | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const weekdays = Array.isArray(record.weekdays)
    ? [...new Set(
        record.weekdays
          .map((day) => Math.round(Number(day)))
          .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      )].sort((a, b) => a - b)
    : [];
  const startHour = Math.round(Number(record.startHour));
  const endHour = Math.round(Number(record.endHour));
  if (!weekdays.length) return undefined;
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return undefined;
  if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24) return undefined;
  if (endHour <= startHour) return undefined;
  return { weekdays, startHour, endHour };
}

function hourInSchedule(hour: number, schedule: RoutineSchedule): boolean {
  return hour >= schedule.startHour && hour < schedule.endHour;
}

export function normalizeLifeEvents(value: unknown): LifeEvent[] {
  if (!Array.isArray(value)) return [];
  const out: LifeEvent[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const title = toText(record.title);
    if (!title) return;
    const kind = toKind(record.kind);
    const schedule = kind === "routine" ? normalizeRoutineSchedule(record.schedule) : undefined;
    if (kind === "routine" && !schedule) return;
    const source = record.source === "auto" ? "auto" : "manual";
    out.push({
      id: toText(record.id) || `${kind}-${index + 1}`,
      kind,
      title,
      detail: toText(record.detail),
      whoSaid: toText(record.whoSaid),
      ...(toText(record.endsAt) ? { endsAt: toText(record.endsAt) } : {}),
      closed: record.closed === true,
      source,
      verified: source === "manual" ? record.verified !== false : record.verified === true,
      evidence: toEvidence(record.evidence),
      ...(schedule ? { schedule } : {}),
    });
  });
  return out;
}

export function activeLifeEvents(events: LifeEvent[]): LifeEvent[] {
  return events.filter((event) => event.verified && !event.closed);
}

export function openLoops(events: LifeEvent[]): LifeEvent[] {
  return activeLifeEvents(events).filter((event) => event.kind === "open_loop");
}

/**
 * Confirmed routines whose window covers this clock.
 */
export function currentRoutines(
  events: LifeEvent[],
  now: Date,
  timeZone?: string | null,
): LifeEvent[] {
  const hour = zonedHour(now, timeZone);
  const weekday = zonedWeekday(now, timeZone);
  return activeLifeEvents(events).filter((event) => {
    if (event.kind !== "routine" || !event.schedule) return false;
    if (!event.schedule.weekdays.includes(weekday)) return false;
    return hourInSchedule(hour, event.schedule);
  });
}

export function renderRoutineNowLine(title: string, locale: Locale = "zh"): string {
  return copy(locale, "prompt.timeRoutine", { title });
}

export function inProgressLife(
  events: LifeEvent[],
  now?: Date,
  timeZone?: string | null,
): LifeEvent[] {
  const lives = activeLifeEvents(events).filter((event) => event.kind === "life");
  if (!now) return lives;
  return [...lives, ...currentRoutines(events, now, timeZone)];
}
