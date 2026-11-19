/**
 * The calls in the records.
 *
 * A call is a record like any other: `[call:voice:2592]` with a
 * direction in its metadata. The measurement answers the questions a
 * person would ask about somebody's phone habits — who calls whom, how
 * long they talk, when they pick up — and nothing about what was said.
 *
 * Fewer than five calls and there is no measurement at all.
 */
import { isoWeekKey, zonedHour, zonedWeekday } from "./timezone";

export const CALL_MIN_SAMPLES = 5;
/** A weekday-and-hour slot needs this many answered calls. */
export const CALL_SLOT_MIN = 2;

export type CallDirection = "in" | "out" | "missed";

export interface CallRow {
  id?: number;
  role: string;
  kind?: string | null;
  content?: string | null;
  timestamp?: Date | string | null;
  meta?: Record<string, unknown> | null;
}

export interface CallStats {
  samples: number;
  /** `in` is a call they made to the user. */
  byDirection: { in: number; out: number; missed: number };
  durationSec: { median: number; p90: number; total: number };
  /** Median number of calls in a week that had at least one call. */
  perWeekMedian: number;
  /** Weekday × hour of the calls that connected, at least twice each. */
  answerSlots: Array<{ weekday: number; hour: number; n: number }>;
  longest: { recordId: number; durationSec: number; at: string };
  first: { recordId: number; at: string };
  last: { recordId: number; at: string };
}

interface ParsedCall {
  recordId: number;
  at: Date;
  direction: CallDirection;
  durationSec: number;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The duration is in the token, and metadata wins when both are there. */
function durationOf(row: CallRow): number {
  const fromMeta = asNumber(row.meta?.durationSec);
  if (fromMeta != null && fromMeta > 0) return fromMeta;
  const match = String(row.content ?? "").match(/^\[call:[a-z]+:(\d+(?:\.\d+)?)\]$/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A missing direction is read from who sent the row.
 *
 * Older exports only carry the token; a call line from the persona is a
 * call they made.
 */
function directionOf(row: CallRow): CallDirection {
  const raw = row.meta?.direction;
  if (raw === "in" || raw === "out" || raw === "missed") return raw;
  return row.role === "assistant" ? "in" : "out";
}

function callsOf(rows: CallRow[]): ParsedCall[] {
  const out: ParsedCall[] = [];
  for (const row of rows) {
    if ((row.kind ?? "text") !== "call") continue;
    const raw = row.timestamp;
    const at = raw instanceof Date ? raw : raw ? new Date(raw) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const recordId = typeof row.id === "number" && Number.isFinite(row.id) ? row.id : 0;
    out.push({
      recordId,
      at,
      direction: directionOf(row),
      durationSec: durationOf(row),
    });
  }
  return out;
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function measureCalls(
  rows: CallRow[],
  timeZone?: string | null,
): CallStats | null {
  const calls = callsOf(rows);
  if (calls.length < CALL_MIN_SAMPLES) return null;

  const byDirection: CallStats["byDirection"] = { in: 0, out: 0, missed: 0 };
  const weekCounts = new Map<string, number>();
  const slotCounts = new Map<string, { weekday: number; hour: number; n: number }>();
  const durations: number[] = [];

  let first = calls[0]!;
  let last = calls[0]!;
  let longest = calls[0]!;

  for (const call of calls) {
    byDirection[call.direction] += 1;
    if (call.at.getTime() < first.at.getTime()) first = call;
    if (call.at.getTime() > last.at.getTime()) last = call;

    const week = isoWeekKey(call.at, timeZone);
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);

    // A missed call was not answered, so it says nothing about when
    // they pick up or how long they talk.
    if (call.direction === "missed" || call.durationSec <= 0) continue;
    durations.push(call.durationSec);
    if (call.durationSec > longest.durationSec) longest = call;
    const weekday = zonedWeekday(call.at, timeZone);
    const hour = zonedHour(call.at, timeZone);
    const key = `${weekday}:${hour}`;
    const slot = slotCounts.get(key);
    if (slot) slot.n += 1;
    else slotCounts.set(key, { weekday, hour, n: 1 });
  }

  const answerSlots = [...slotCounts.values()]
    .filter((slot) => slot.n >= CALL_SLOT_MIN)
    .sort((a, b) => b.n - a.n || a.weekday - b.weekday || a.hour - b.hour);

  return {
    samples: calls.length,
    byDirection,
    durationSec: {
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      total: durations.reduce((sum, value) => sum + value, 0),
    },
    perWeekMedian: median([...weekCounts.values()]),
    answerSlots,
    longest: {
      recordId: longest.recordId,
      durationSec: longest.durationSec,
      at: longest.at.toISOString(),
    },
    first: { recordId: first.recordId, at: first.at.toISOString() },
    last: { recordId: last.recordId, at: last.at.toISOString() },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonNegative(value: unknown, fallback = 0): number {
  const n = asNumber(value);
  return n != null && n >= 0 ? n : fallback;
}

function stampOf(value: unknown): { recordId: number; at: string } | null {
  if (!isPlainObject(value) || typeof value.at !== "string") return null;
  if (Number.isNaN(new Date(value.at).getTime())) return null;
  return { recordId: nonNegative(value.recordId), at: value.at };
}

/**
 * Reads a stored measurement back.
 *
 * A shape that does not carry the counts is not a measurement — it is
 * dropped rather than filled with zeroes, the same way the other
 * measurements are.
 */
export function normalizeCallStats(value: unknown): CallStats | null {
  if (!isPlainObject(value)) return null;
  const samples = asNumber(value.samples);
  if (samples == null || samples < CALL_MIN_SAMPLES) return null;
  const byDirection = isPlainObject(value.byDirection) ? value.byDirection : {};
  const durationSec = isPlainObject(value.durationSec) ? value.durationSec : {};
  const longest = stampOf(value.longest);
  const first = stampOf(value.first);
  const last = stampOf(value.last);
  if (!longest || !first || !last) return null;

  const answerSlots: CallStats["answerSlots"] = [];
  if (Array.isArray(value.answerSlots)) {
    for (const entry of value.answerSlots) {
      if (!isPlainObject(entry)) continue;
      const weekday = asNumber(entry.weekday);
      const hour = asNumber(entry.hour);
      const n = asNumber(entry.n);
      if (weekday == null || hour == null || n == null) continue;
      if (weekday < 0 || weekday > 6 || hour < 0 || hour > 23 || n < CALL_SLOT_MIN) continue;
      answerSlots.push({ weekday, hour, n });
    }
  }

  return {
    samples,
    byDirection: {
      in: nonNegative(byDirection.in),
      out: nonNegative(byDirection.out),
      missed: nonNegative(byDirection.missed),
    },
    durationSec: {
      median: nonNegative(durationSec.median),
      p90: nonNegative(durationSec.p90),
      total: nonNegative(durationSec.total),
    },
    perWeekMedian: nonNegative(value.perWeekMedian),
    answerSlots,
    longest: {
      ...longest,
      durationSec: nonNegative((value.longest as Record<string, unknown>).durationSec),
    },
    first,
    last,
  };
}
