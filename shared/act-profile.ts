/**
 * How often this person does each kind of turn, in each kind of moment.
 *
 * The counts live on the persona. They are measured once, during
 * distillation, and sampled before a reply is written. A prompt that
 * names one action is an instruction; a prompt that describes eleven
 * of them is a personality paragraph the model will ignore.
 *
 * Four conditions are enough: whether the other person asked, the
 * current mood, day or night in their timezone, and the stage of the
 * relationship. A bucket with too few samples falls back to the
 * unconditional counts, and that fallback is stored so it is visible.
 */
import type { SpeechAct } from "./speech-acts";
import { SPEECH_ACTS, isSpeechAct } from "./speech-acts";

/** Fewer than this and there is no distribution — the prompt stays as it is today. */
export const ACT_MIN_SAMPLES = 40;

/** A bucket thinner than this falls back to the unconditional counts. */
export const ACT_BUCKET_MIN_SAMPLES = 8;

export type ActDayPart = "day" | "night";

export interface ActCondition {
  asking: boolean;
  emotion: string;
  dayPart: ActDayPart;
  relationshipPhase: string;
}

export type ActCounts = Partial<Record<SpeechAct, number>>;

export interface ActBucket {
  asking?: boolean;
  emotion?: string;
  dayPart?: ActDayPart;
  relationshipPhase?: string;
  counts: ActCounts;
  samples: number;
  /** True when this bucket is too thin and the unconditional counts were used. */
  fallback?: boolean;
}

export interface ActProfile {
  samples: number;
  unconditional: ActCounts;
  buckets: ActBucket[];
  /** True when the user edited a count by hand. */
  edited?: boolean;
  measuredAt?: string;
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function toCounts(value: unknown): ActCounts {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const out: ActCounts = {};
  for (const act of SPEECH_ACTS) {
    if (record[act] === undefined) continue;
    const n = toCount(record[act]);
    if (n > 0) out[act] = n;
  }
  return out;
}

function total(counts: ActCounts): number {
  let sum = 0;
  for (const act of SPEECH_ACTS) sum += counts[act] ?? 0;
  return sum;
}

export function emptyCounts(): ActCounts {
  const out: ActCounts = {};
  for (const act of SPEECH_ACTS) out[act] = 0;
  return out;
}

export function incrementCount(counts: ActCounts, act: SpeechAct, by = 1): ActCounts {
  return { ...counts, [act]: (counts[act] ?? 0) + by };
}

/**
 * A hand correction on the action counts.
 *
 * Unlike-feedback of kind `act` subtracts one from the sampled (or
 * chosen) action. Zero is a floor: a count that was already empty stays
 * empty. The profile is marked edited so a later distillation does not
 * overwrite the correction.
 */
export function correctActCount(profile: ActProfile, wrong: SpeechAct, right?: SpeechAct): ActProfile {
  let unconditional = incrementCount(profile.unconditional, wrong, -1);
  if ((unconditional[wrong] ?? 0) < 0) unconditional = { ...unconditional, [wrong]: 0 };
  if (right && right !== wrong) unconditional = incrementCount(unconditional, right, 1);
  return {
    ...profile,
    unconditional,
    samples: total(unconditional),
    edited: true,
  };
}

export function normalizeActProfile(value: unknown): ActProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const unconditional = toCounts(record.unconditional);
  const samples = Math.max(total(unconditional), toCount(record.samples));
  const buckets: ActBucket[] = [];
  if (Array.isArray(record.buckets)) {
    for (const item of record.buckets) {
      if (!item || typeof item !== "object") continue;
      const bucket = item as Record<string, unknown>;
      const counts = toCounts(bucket.counts);
      buckets.push({
        ...(typeof bucket.asking === "boolean" ? { asking: bucket.asking } : {}),
        ...(typeof bucket.emotion === "string" && bucket.emotion ? { emotion: bucket.emotion } : {}),
        ...(bucket.dayPart === "day" || bucket.dayPart === "night"
          ? { dayPart: bucket.dayPart }
          : {}),
        ...(typeof bucket.relationshipPhase === "string" && bucket.relationshipPhase
          ? { relationshipPhase: bucket.relationshipPhase }
          : {}),
        counts,
        samples: Math.max(total(counts), toCount(bucket.samples)),
        ...(bucket.fallback === true ? { fallback: true } : {}),
      });
    }
  }
  const measuredAt = typeof record.measuredAt === "string" ? record.measuredAt : undefined;
  return {
    samples,
    unconditional,
    buckets,
    ...(record.edited === true ? { edited: true } : {}),
    ...(measuredAt ? { measuredAt } : {}),
  };
}

/**
 * Whether this profile is thick enough to sample from.
 *
 * Below the floor the conversation uses today's prompt: naming an
 * action from three examples would be a rumour.
 */
export function hasActDistribution(profile: ActProfile | null | undefined): boolean {
  return Boolean(profile && profile.samples >= ACT_MIN_SAMPLES && total(profile.unconditional) > 0);
}

function bucketMatches(bucket: ActBucket, condition: ActCondition): boolean {
  if (bucket.asking !== undefined && bucket.asking !== condition.asking) return false;
  if (bucket.emotion && bucket.emotion !== condition.emotion) return false;
  if (bucket.dayPart && bucket.dayPart !== condition.dayPart) return false;
  if (bucket.relationshipPhase && bucket.relationshipPhase !== condition.relationshipPhase) {
    return false;
  }
  return true;
}

function specificity(bucket: ActBucket): number {
  return (
    (bucket.asking !== undefined ? 1 : 0) +
    (bucket.emotion ? 1 : 0) +
    (bucket.dayPart ? 1 : 0) +
    (bucket.relationshipPhase ? 1 : 0)
  );
}

/**
 * The counts this condition should draw from.
 *
 * The most specific bucket that still has enough samples wins. A thin
 * bucket is returned with `fallback: true` and the unconditional
 * counts, so the editor can show that this moment had no distribution
 * of its own.
 */
export function countsForCondition(
  profile: ActProfile,
  condition: ActCondition,
): { counts: ActCounts; bucket: ActBucket | null; fallback: boolean } {
  const matches = profile.buckets
    .filter((bucket) => bucketMatches(bucket, condition))
    .sort((a, b) => specificity(b) - specificity(a) || b.samples - a.samples);
  const best = matches[0];
  if (best && best.samples >= ACT_BUCKET_MIN_SAMPLES && total(best.counts) > 0) {
    return { counts: best.counts, bucket: best, fallback: false };
  }
  return {
    counts: profile.unconditional,
    bucket: best ?? null,
    fallback: true,
  };
}

export interface SampleActOptions {
  /** When the timing switch is off, silence is drawn out of the distribution. */
  dropSilence?: boolean;
  rng?: () => number;
}

export interface SampledAct {
  act: SpeechAct;
  /** The first draw, before silence was dropped. */
  drawn: SpeechAct;
  resampled: boolean;
  fallback: boolean;
}

function drawFrom(counts: ActCounts, rng: () => number): SpeechAct | null {
  const entries = SPEECH_ACTS.map((act) => [act, counts[act] ?? 0] as const).filter(
    ([, n]) => n > 0,
  );
  const sum = entries.reduce((acc, [, n]) => acc + n, 0);
  if (!sum) return null;
  let cursor = Math.max(0, Math.min(0.999999, rng())) * sum;
  for (const [act, n] of entries) {
    cursor -= n;
    if (cursor < 0) return act;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

/**
 * Picks one action for this turn.
 *
 * Silence is a real draw. When the timing switch is off it is not a
 * product behaviour, so it is taken out of the bag and drawn again.
 * The original draw is kept so evaluation can see that silence was
 * on the table.
 */
export function sampleAct(
  profile: ActProfile,
  condition: ActCondition,
  options: SampleActOptions = {},
): SampledAct | null {
  if (!hasActDistribution(profile)) return null;
  const rng = options.rng ?? Math.random;
  const { counts, fallback } = countsForCondition(profile, condition);
  const usable = options.dropSilence ? { ...counts, silence: 0 } : counts;
  const first = drawFrom(counts, rng);
  if (!first) return null;
  if (first !== "silence" || !options.dropSilence) {
    return { act: first, drawn: first, resampled: false, fallback };
  }
  const second = drawFrom(usable, rng) ?? drawFrom({ ...counts, silence: 0 }, rng);
  if (!second || second === "silence") {
    // A distribution that is only silence still has to say something
    // when silence is not allowed. Answering is the least invented verb.
    return { act: "answer", drawn: first, resampled: true, fallback };
  }
  return { act: second, drawn: first, resampled: true, fallback };
}

export function isActCounts(value: unknown): value is ActCounts {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value as object).every((key) => isSpeechAct(key));
}

/** Day in their own timezone is 6–22; the rest is night. */
export function dayPartFromHour(hour: number): ActDayPart {
  const h = Math.round(hour);
  return h >= 6 && h < 22 ? "day" : "night";
}
