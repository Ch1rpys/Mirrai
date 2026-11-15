/**
 * How this person starts a conversation of their own.
 *
 * Distinct from `proactiveRate` on the behaviour profile. That number
 * used to be written as 0 whenever the records had never been marked
 * as "they spoke first", and a 0 was then read as "they never do".
 * Here, a missing profile is "not counted"; a profile with samples
 * and a rate of 0 is "counted, and they never did".
 */
import {
  PROACTIVE_OPENINGS,
  isProactiveOpening,
  type ProactiveOpening,
} from "./speech-acts";

/** Below this many of their own first words, there is no opening distribution. */
export const OPENING_MIN_SAMPLES = 15;

export type OpeningCounts = Partial<Record<ProactiveOpening, number>>;

export interface OpeningProfile {
  /** How many of their own first-word lines were counted. */
  samples: number;
  counts: OpeningCounts;
  /**
   * Their share of exchanges that they opened.
   *
   * `null` means this was never counted. 0 means it was counted and
   * they never opened.
   */
  rate: number | null;
  measuredAt?: string;
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function toCounts(value: unknown): OpeningCounts {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const out: OpeningCounts = {};
  for (const opening of PROACTIVE_OPENINGS) {
    if (record[opening] === undefined) continue;
    const n = toCount(record[opening]);
    if (n > 0) out[opening] = n;
  }
  return out;
}

function total(counts: OpeningCounts): number {
  let sum = 0;
  for (const opening of PROACTIVE_OPENINGS) sum += counts[opening] ?? 0;
  return sum;
}

export function normalizeOpeningProfile(value: unknown): OpeningProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const counts = toCounts(record.counts);
  const samples = Math.max(total(counts), toCount(record.samples));
  let rate: number | null = null;
  if (record.rate === null || record.rate === undefined) {
    rate = null;
  } else {
    const n = typeof record.rate === "number" ? record.rate : Number(record.rate);
    rate = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
  }
  const measuredAt = typeof record.measuredAt === "string" ? record.measuredAt : undefined;
  return {
    samples,
    counts,
    rate,
    ...(measuredAt ? { measuredAt } : {}),
  };
}

export function hasOpeningDistribution(
  profile: OpeningProfile | null | undefined,
): boolean {
  return Boolean(profile && profile.samples >= OPENING_MIN_SAMPLES && total(profile.counts) > 0);
}

/**
 * The probability used by the bought window.
 *
 * Not counted → 1 (today's behaviour). Counted and zero → 0 (skip).
 */
export function openingRateForWindow(
  profile: OpeningProfile | null | undefined,
): number | null {
  if (!profile) return null;
  return profile.rate;
}

export function sampleOpening(
  profile: OpeningProfile,
  rng: () => number = Math.random,
  forbidden: Iterable<ProactiveOpening> = [],
): ProactiveOpening | null {
  if (!hasOpeningDistribution(profile)) return null;
  const blocked = new Set(forbidden);
  const entries = PROACTIVE_OPENINGS.map((opening) => [opening, profile.counts[opening] ?? 0] as const)
    .filter(([opening, n]) => n > 0 && !blocked.has(opening));
  const sum = entries.reduce((acc, [, n]) => acc + n, 0);
  if (!sum) return null;
  let cursor = Math.max(0, Math.min(0.999999, rng())) * sum;
  for (const [opening, n] of entries) {
    cursor -= n;
    if (cursor < 0) return opening;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

export function isOpeningCounts(value: unknown): value is OpeningCounts {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value as object).every((key) => isProactiveOpening(key));
}
