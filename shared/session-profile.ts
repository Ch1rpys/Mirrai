/**
 * How a scene of theirs used to run, and how it used to end.
 *
 * A reply that goes on past their usual length, or past the hour they
 * used to go quiet, is not more of them — it is the app keeping the
 * chat open. These numbers are when they used to close it themselves.
 */
import { isTextRecord } from "./records";
import { zonedDateKey, zonedHour, zonedMinute } from "./timezone";

export const SESSION_MIN_MESSAGES = 6;
export const SESSION_MIN_SCENES = 20;
export const CLOSER_MIN_N = 3;
export const CLOSER_MAX_KINDS = 8;
export const CLOSER_PROMPT_MAX = 4;
export const BEDTIME_AFTER_HOUR = 21;
export const BEDTIME_MIN_DAYS = 20;
export const CLOSE_BY_THEM_MIN = 0.3;
export const BEDTIME_SESSION_MIN = 10;

export interface SessionLine {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
}

export interface SessionProfile {
  scenes: number;
  lengthMin: { median: number; p90: number };
  closeByThemRate: number;
  closers: Array<{ text: string; n: number }>;
  bedtime?: { median: number; p25: number; p75: number; days: number };
  goodnightFirstRate?: number;
}

function spokenAt(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function minuteOfDay(date: Date, timeZone?: string | null): number {
  return zonedHour(date, timeZone) * 60 + zonedMinute(date, timeZone);
}

// i18n:allow-input — the word that marks a goodnight exchange in the records.
const GOODNIGHT = "晚安";

function hasGoodnight(text: string): boolean {
  return text.includes(GOODNIGHT);
}

export function measureSessions(
  scenes: SessionLine[][],
  personaTimeZone?: string | null,
): SessionProfile | null {
  const lengths: number[] = [];
  let closedByThem = 0;
  const closerCounts = new Map<string, number>();
  let goodnightScenes = 0;
  let goodnightFirst = 0;
  const lastTaByDay = new Map<string, Date>();

  for (const scene of scenes) {
    const timed = scene
      .map((row) => ({ row, at: spokenAt(row.timestamp) }))
      .filter((item) => item.at != null) as Array<{ row: SessionLine; at: number }>;
    if (timed.length === 0) continue;
    timed.sort((a, b) => a.at - b.at);
    for (const item of timed) {
      if (item.row.role !== "assistant" || !isTextRecord(item.row)) continue;
      const date = asDate(item.row.timestamp);
      if (!date) continue;
      const day = zonedDateKey(date, personaTimeZone);
      const prev = lastTaByDay.get(day);
      if (!prev || date.getTime() > prev.getTime()) lastTaByDay.set(day, date);
    }

    const textRows = timed.filter((item) => isTextRecord(item.row));
    if (textRows.length < SESSION_MIN_MESSAGES) continue;
    const first = textRows[0]!;
    const last = textRows[textRows.length - 1]!;
    lengths.push((last.at - first.at) / 60_000);
    if (last.row.role === "assistant") {
      closedByThem += 1;
      const text = String(last.row.content ?? "").trim();
      if (text) closerCounts.set(text, (closerCounts.get(text) ?? 0) + 1);
    }

    const goodnightAt = textRows.filter((item) => hasGoodnight(String(item.row.content ?? "")));
    if (goodnightAt.length > 0) {
      goodnightScenes += 1;
      if (goodnightAt[0]!.row.role === "assistant") goodnightFirst += 1;
    }
  }

  if (lengths.length < SESSION_MIN_SCENES) return null;
  const sorted = [...lengths].sort((a, b) => a - b);
  const closers = [...closerCounts.entries()]
    .filter(([, n]) => n >= CLOSER_MIN_N)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CLOSER_MAX_KINDS)
    .map(([text, n]) => ({ text, n }));

  const bedtimeMinutes: number[] = [];
  for (const date of lastTaByDay.values()) {
    if (zonedHour(date, personaTimeZone) < BEDTIME_AFTER_HOUR) continue;
    bedtimeMinutes.push(minuteOfDay(date, personaTimeZone));
  }
  bedtimeMinutes.sort((a, b) => a - b);

  return {
    scenes: lengths.length,
    lengthMin: { median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) },
    closeByThemRate: closedByThem / lengths.length,
    closers,
    ...(bedtimeMinutes.length >= BEDTIME_MIN_DAYS
      ? {
          bedtime: {
            median: quantile(bedtimeMinutes, 0.5),
            p25: quantile(bedtimeMinutes, 0.25),
            p75: quantile(bedtimeMinutes, 0.75),
            days: bedtimeMinutes.length,
          },
        }
      : {}),
    ...(goodnightScenes > 0 ? { goodnightFirstRate: goodnightFirst / goodnightScenes } : {}),
  };
}

export function shouldClose(input: {
  sessionMin: number;
  personaMinuteOfDay: number;
  profile: SessionProfile;
  closedThisSession: boolean;
}): boolean {
  if (input.closedThisSession) return false;
  if (input.profile.closeByThemRate < CLOSE_BY_THEM_MIN) return false;
  if (input.sessionMin > input.profile.lengthMin.p90) return true;
  const bedtime = input.profile.bedtime;
  if (
    bedtime &&
    input.personaMinuteOfDay >= bedtime.p25 &&
    input.personaMinuteOfDay <= bedtime.p75 + 30 &&
    input.sessionMin >= BEDTIME_SESSION_MIN
  ) {
    return true;
  }
  return false;
}

export function normalizeSessionProfile(value: unknown): SessionProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const length = source.lengthMin as { median?: unknown; p90?: unknown } | undefined;
  const median = Number(length?.median);
  const p90 = Number(length?.p90);
  const scenes = Math.round(Number(source.scenes) || 0);
  const closeByThemRate = Number(source.closeByThemRate);
  if (!Number.isFinite(median) || !Number.isFinite(p90) || scenes < 1) return undefined;
  const closers: Array<{ text: string; n: number }> = [];
  if (Array.isArray(source.closers)) {
    for (const item of source.closers) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const text = String(row.text ?? "").trim();
      const n = Math.round(Number(row.n) || 0);
      if (!text || n < 1) continue;
      closers.push({ text, n });
      if (closers.length >= CLOSER_MAX_KINDS) break;
    }
  }
  const bedtimeRaw = source.bedtime as Record<string, unknown> | undefined;
  const bedtime =
    bedtimeRaw && typeof bedtimeRaw === "object"
      ? {
          median: Number(bedtimeRaw.median),
          p25: Number(bedtimeRaw.p25),
          p75: Number(bedtimeRaw.p75),
          days: Math.round(Number(bedtimeRaw.days) || 0),
        }
      : undefined;
  const goodnightFirstRate = Number(source.goodnightFirstRate);
  return {
    scenes,
    lengthMin: { median, p90 },
    closeByThemRate: Number.isFinite(closeByThemRate) ? closeByThemRate : 0,
    closers,
    ...(bedtime &&
    Number.isFinite(bedtime.median) &&
    Number.isFinite(bedtime.p25) &&
    Number.isFinite(bedtime.p75) &&
    bedtime.days >= 1
      ? { bedtime }
      : {}),
    ...(Number.isFinite(goodnightFirstRate) ? { goodnightFirstRate } : {}),
  };
}
