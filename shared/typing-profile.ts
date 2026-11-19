/**
 * How long they take to type a character, and how long they pause
 * between the lines of a burst.
 *
 * The gap between two of their own messages is not only typing — they
 * also stop to think, or to look at the last line. The 25th percentile
 * of (gap ÷ characters) is the faster quarter of those gaps, which is
 * closer to the typing itself. Minute-resolution exports cannot tell
 * a two-second pause from a fifty-second one, so they are not measured.
 */
import { isTextRecord } from "./records";
import { splitScenes, toTurns } from "./scenes";

export const TYPING_MIN_PAIRS = 30;
export const TYPING_MS_PER_CHAR_MIN = 80;
export const TYPING_MS_PER_CHAR_MAX = 400;

export interface BurstGapMs {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface TypingProfile {
  msPerChar: number;
  burstGapMs: BurstGapMs;
  pairs: number;
}

export interface TypingRow {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
  speaker?: string | null;
}

function at(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function resolutionOf(rows: TypingRow[]): "second" | "minute" {
  const stamps = rows.map((row) => at(row.timestamp)).filter((date): date is Date => date !== null);
  if (stamps.length === 0) return "second";
  const onTheMinute = stamps.filter((date) => date.getSeconds() === 0 && date.getMilliseconds() === 0).length;
  return onTheMinute * 2 > stamps.length ? "minute" : "second";
}

function contentOf(row: TypingRow): string {
  return typeof row.content === "string" ? row.content : "";
}

/**
 * Adjacent text lines they sent in one turn, as (gap ms / later chars)
 * and the raw gaps.
 *
 * Only when the timestamps actually have seconds. Fewer than thirty
 * pairs is not a measurement.
 */
export function measureTyping(rows: TypingRow[]): TypingProfile | null {
  if (resolutionOf(rows) !== "second") return null;
  const perChar: number[] = [];
  const gaps: number[] = [];
  for (const scene of splitScenes(rows)) {
    for (const turn of toTurns(scene)) {
      if (turn[0]?.role !== "assistant") continue;
      const texts = turn.filter((row) => isTextRecord(row) && contentOf(row).length > 0);
      for (let i = 1; i < texts.length; i++) {
        const previous = at(texts[i - 1]!.timestamp);
        const next = at(texts[i]!.timestamp);
        if (!previous || !next) continue;
        const gapMs = next.getTime() - previous.getTime();
        const chars = charCount(contentOf(texts[i]!));
        if (gapMs <= 0 || chars <= 0) continue;
        perChar.push(gapMs / chars);
        gaps.push(gapMs);
      }
    }
  }
  if (perChar.length < TYPING_MIN_PAIRS) return null;
  const sortedPerChar = [...perChar].sort((a, b) => a - b);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  return {
    msPerChar: clamp(
      quantile(sortedPerChar, 0.25),
      TYPING_MS_PER_CHAR_MIN,
      TYPING_MS_PER_CHAR_MAX,
    ),
    burstGapMs: {
      p10: quantile(sortedGaps, 0.1),
      p25: quantile(sortedGaps, 0.25),
      p50: quantile(sortedGaps, 0.5),
      p75: quantile(sortedGaps, 0.75),
      p90: quantile(sortedGaps, 0.9),
    },
    pairs: perChar.length,
  };
}

/** Inverse-CDF sample from the five stored burst-gap percentiles. */
export function sampleBurstGapMs(profile: TypingProfile, rng: () => number): number {
  const u = rng();
  const knots: Array<[number, number]> = [
    [0.1, profile.burstGapMs.p10],
    [0.25, profile.burstGapMs.p25],
    [0.5, profile.burstGapMs.p50],
    [0.75, profile.burstGapMs.p75],
    [0.9, profile.burstGapMs.p90],
  ];
  if (u <= knots[0]![0]) return knots[0]![1];
  const last = knots[knots.length - 1]!;
  if (u >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const [u1, v1] = knots[i]!;
    if (u <= u1) {
      const [u0, v0] = knots[i - 1]!;
      const t = (u - u0) / (u1 - u0);
      return v0 + t * (v1 - v0);
    }
  }
  return last[1];
}

/** Typing indicator before the first line. Never longer than the delay itself. */
export function delayTypingMs(text: string, profile: TypingProfile, delayMs: number): number {
  const chars = Math.max(1, charCount(text));
  return Math.min(delayMs, clamp(chars * profile.msPerChar, 800, 12_000));
}

/**
 * Gaps before the 2nd…nth lines, and a typing duration for each of
 * those gaps. Both arrays are one shorter than `parts`.
 */
export function burstTypingMs(
  parts: string[],
  profile: TypingProfile,
  rng: () => number,
): { gapsMs: number[]; typingMs: number[] } {
  const gapsMs: number[] = [];
  const typingMs: number[] = [];
  for (let i = 1; i < parts.length; i++) {
    const gap = Math.max(0, Math.round(sampleBurstGapMs(profile, rng)));
    const chars = Math.max(1, charCount(parts[i] ?? ""));
    const typing = Math.min(gap, clamp(chars * profile.msPerChar, 600, 8_000));
    gapsMs.push(gap);
    typingMs.push(typing);
  }
  return { gapsMs, typingMs };
}

export function normalizeTyping(value: unknown): TypingProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const msPerChar = typeof record.msPerChar === "number" ? record.msPerChar : NaN;
  const pairs = typeof record.pairs === "number" ? record.pairs : 0;
  const rawGaps = record.burstGapMs;
  if (!Number.isFinite(msPerChar) || pairs < TYPING_MIN_PAIRS) return null;
  if (!rawGaps || typeof rawGaps !== "object" || Array.isArray(rawGaps)) return null;
  const gaps = rawGaps as Record<string, unknown>;
  const burstGapMs: BurstGapMs = {
    p10: typeof gaps.p10 === "number" ? gaps.p10 : NaN,
    p25: typeof gaps.p25 === "number" ? gaps.p25 : NaN,
    p50: typeof gaps.p50 === "number" ? gaps.p50 : NaN,
    p75: typeof gaps.p75 === "number" ? gaps.p75 : NaN,
    p90: typeof gaps.p90 === "number" ? gaps.p90 : NaN,
  };
  if (Object.values(burstGapMs).some((n) => !Number.isFinite(n) || n < 0)) return null;
  return {
    msPerChar: clamp(msPerChar, TYPING_MS_PER_CHAR_MIN, TYPING_MS_PER_CHAR_MAX),
    burstGapMs,
    pairs,
  };
}
