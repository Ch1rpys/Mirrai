/**
 * How long they take to answer, by the hour and the situation.
 *
 * A single log-normal is the old ruler. This one keeps a bucket per
 * band, and finer buckets when the records actually have them. A bucket
 * with too few gaps is not used.
 */
import { BEHAVIOR_MAX_GAP_SEC } from "./behavior-profile";
import { isUserAsking } from "./speech-acts";
import { splitScenes, toTurns } from "./scenes";
import { zonedHour } from "./timezone";

export interface DelayBucket {
  n: number;
  /** Mean of ln(seconds). exp(mu) is the median. */
  mu: number;
  sigma: number;
}

export interface DelayBuckets {
  buckets: Record<string, DelayBucket>;
  samples: number;
  /** Second-resolution timestamps, unless more than half sit on :00. */
  resolution: "second" | "minute";
}

export const DELAY_BUCKET_MIN = 8;
export const DELAY_SAMPLE_MIN = 30;
export const DELAY_BANDS = ["night", "morning", "afternoon", "evening"] as const;
export type DelayBand = (typeof DELAY_BANDS)[number];

const LAYERS = [
  "band|state|asking|media",
  "band|state|asking",
  "band|asking",
  "band",
  "all",
] as const;

const STATES = ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"] as const;

export interface DelayRow {
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  emotion?: string | null;
}

export function bandOf(date: Date, timeZone: string): DelayBand {
  const hour = zonedHour(date, timeZone);
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function at(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isState(value: string | null | undefined): value is (typeof STATES)[number] {
  return typeof value === "string" && (STATES as readonly string[]).includes(value);
}

function fit(gaps: number[]): DelayBucket {
  const logs = gaps.map((seconds) => Math.log(Math.max(seconds, 1e-6)));
  const mu = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const variance = logs.length > 1
    ? logs.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (logs.length - 1)
    : 0;
  return { n: gaps.length, mu, sigma: Math.sqrt(Math.max(0, variance)) };
}

function keysFor(sample: {
  band: DelayBand;
  state?: string;
  asking: boolean;
  media: boolean;
}): string[] {
  const asking = sample.asking ? "true" : "false";
  const media = sample.media ? "true" : "false";
  const keys: string[] = [];
  if (sample.state) {
    keys.push(`${sample.band}|${sample.state}|${asking}|${media}`);
    keys.push(`${sample.band}|${sample.state}|${asking}`);
  }
  keys.push(`${sample.band}|${asking}`);
  keys.push(sample.band);
  keys.push("all");
  return keys;
}

function resolutionOf(rows: DelayRow[]): "second" | "minute" {
  const stamps = rows.map((row) => at(row.timestamp)).filter((date): date is Date => date !== null);
  if (stamps.length === 0) return "second";
  const onTheMinute = stamps.filter((date) => date.getSeconds() === 0 && date.getMilliseconds() === 0).length;
  return onTheMinute * 2 > stamps.length ? "minute" : "second";
}

/**
 * One gap: the last line of a user turn, then the first line of the
 * next turn of theirs, inside the same scene, and not longer than the
 * behaviour profile's maximum gap.
 */
export function measureReplyDelay(rows: DelayRow[], personaTimeZone: string): DelayBuckets | null {
  const groups = new Map<string, number[]>();
  let samples = 0;
  for (const scene of splitScenes(rows)) {
    const turns = toTurns(scene);
    for (let i = 0; i < turns.length - 1; i++) {
      const user = turns[i];
      const theirs = turns[i + 1];
      if (user[0]?.role !== "user" || theirs[0]?.role !== "assistant") continue;
      const asked = user[user.length - 1];
      const answered = theirs[0];
      const from = at(asked?.timestamp);
      const to = at(answered?.timestamp);
      if (!asked || !answered || !from || !to) continue;
      const gapSec = (to.getTime() - from.getTime()) / 1000;
      if (!(gapSec > 0) || gapSec > BEHAVIOR_MAX_GAP_SEC) continue;
      const state = isState(answered.emotion) ? answered.emotion : undefined;
      const sample = {
        band: bandOf(from, personaTimeZone),
        state,
        asking: isUserAsking(asked.content),
        media: Boolean(asked.kind && asked.kind !== "text"),
      };
      samples += 1;
      for (const key of keysFor(sample)) {
        const list = groups.get(key) ?? [];
        list.push(gapSec);
        groups.set(key, list);
      }
    }
  }
  if (samples < DELAY_SAMPLE_MIN) return null;
  const buckets: Record<string, DelayBucket> = {};
  for (const [key, gaps] of groups) buckets[key] = fit(gaps);
  return { buckets, samples, resolution: resolutionOf(rows) };
}

export function pickDelayBucket(
  profile: DelayBuckets,
  condition: { band: string; state?: string; asking: boolean; media: boolean },
): { bucket: DelayBucket; via: string } {
  const asking = condition.asking ? "true" : "false";
  const media = condition.media ? "true" : "false";
  const candidates: Array<{ key: string; via: string }> = [];
  if (condition.state) {
    candidates.push(
      { key: `${condition.band}|${condition.state}|${asking}|${media}`, via: LAYERS[0] },
      { key: `${condition.band}|${condition.state}|${asking}`, via: LAYERS[1] },
    );
  }
  candidates.push(
    { key: `${condition.band}|${asking}`, via: LAYERS[2] },
    { key: condition.band, via: LAYERS[3] },
    { key: "all", via: LAYERS[4] },
  );
  for (const candidate of candidates) {
    const bucket = profile.buckets[candidate.key];
    if (bucket && bucket.n >= DELAY_BUCKET_MIN) return { bucket, via: candidate.via };
  }
  const fallback = profile.buckets.all ?? { n: profile.samples, mu: Math.log(30), sigma: 0.6 };
  return { bucket: fallback, via: "all" };
}

/**
 * The two numbers the waiting gauge shows (C3.1).
 *
 * The bucket is a log-normal, so the median is exp(mu) and the ninetieth
 * percentile is exp(mu + 1.2816 sigma). Both are seconds.
 */
export function delayQuantiles(bucket: DelayBucket): {
  medianSec: number;
  p90Sec: number;
} {
  return {
    medianSec: Math.exp(bucket.mu),
    p90Sec: Math.exp(bucket.mu + 1.2816 * bucket.sigma),
  };
}

function standardNormal(rng: () => number): number {
  const u1 = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, rng()));
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Milliseconds. Clamped to 1 second … 6 hours. */
export function sampleDelayMs(bucket: DelayBucket, rng: () => number): number {
  const seconds = Math.exp(bucket.mu + bucket.sigma * standardNormal(rng));
  const clamped = Math.max(1, Math.min(BEHAVIOR_MAX_GAP_SEC, seconds));
  return Math.round(clamped * 1000);
}

export function normalizeReplyDelay(value: unknown): DelayBuckets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const samples = typeof record.samples === "number" ? record.samples : 0;
  if (samples < DELAY_SAMPLE_MIN) return null;
  if (record.resolution !== "second" && record.resolution !== "minute") return null;
  if (!record.buckets || typeof record.buckets !== "object" || Array.isArray(record.buckets)) return null;
  const buckets: Record<string, DelayBucket> = {};
  for (const [key, raw] of Object.entries(record.buckets as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const bucket = raw as Record<string, unknown>;
    const n = typeof bucket.n === "number" ? bucket.n : 0;
    const mu = typeof bucket.mu === "number" ? bucket.mu : NaN;
    const sigma = typeof bucket.sigma === "number" ? bucket.sigma : NaN;
    if (n > 0 && Number.isFinite(mu) && Number.isFinite(sigma) && sigma >= 0) {
      buckets[key] = { n, mu, sigma };
    }
  }
  if (!buckets.all && Object.keys(buckets).length === 0) return null;
  return { buckets, samples, resolution: record.resolution };
}
