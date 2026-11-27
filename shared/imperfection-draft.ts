/**
 * Counted drafts of how this person is imperfect in each state.
 *
 * The editor still has to be written by the user. These sentences are
 * what the fingerprint already knows — distant is short and ends on a
 * period — put into the same boxes, so the user can take them or leave
 * them. They never go into the prompt on their own.
 */
import { copy, type Locale } from "./copy";
import { isTextRecord } from "./records";
import { splitScenes, toTurns } from "./scenes";
import { DELAY_BUCKET_MIN, type DelayBucket, type DelayBuckets } from "./reply-delay";
import {
  endingClassOf,
  FINGERPRINT_STATES,
  MIN_FINGERPRINT_STATE_SAMPLES,
  type EmotionalState,
  type FingerprintRow,
  type StyleFingerprint,
} from "./style-fingerprint";
export interface ImperfectionDraft {
  text: string;
  evidence: number[];
}

export type ImperfectionDrafts = Partial<Record<EmotionalState, ImperfectionDraft[]>>;

export interface ImperfectionDraftSource {
  fingerprint?: StyleFingerprint | null;
  stickers?: unknown;
  replyDelay?: unknown;
}

export function draftImperfection(
  styleProfile: ImperfectionDraftSource,
  options: { locale?: Locale; rows?: FingerprintRow[] } = {},
): ImperfectionDrafts {
  const fingerprint = styleProfile.fingerprint;
  const perState = fingerprint?.perState;
  if (!fingerprint || !perState) return {};
  const locale = options.locale ?? "zh";
  const rows = options.rows ?? [];
  const out: ImperfectionDrafts = {};
  const bursts = burstStats(rows);

  for (const state of FINGERPRINT_STATES) {
    // Warm is the baseline the other states are compared against, so it
    // does not get a draft of its own.
    if (state === "warm") continue;
    const core = perState[state];
    if (!core) continue;
    const rest = restOf(perState, state);
    if (!rest) continue;
    const drafts: ImperfectionDraft[] = [];

    if (core.length.median <= rest.lengthMedian * 0.6) {
      const cutoff = Math.max(2, Math.round(core.length.median));
      drafts.push({
        text: copy(locale, "v6.imperfection.short", { n: String(Math.round(core.length.median)) }),
        evidence: evidenceIds(rows, state, (text) => charCount(text) <= cutoff),
      });
    } else if (core.length.median >= rest.lengthMedian * 1.5) {
      const cutoff = Math.max(2, Math.round(core.length.median));
      drafts.push({
        text: copy(locale, "v6.imperfection.long", { n: String(Math.round(core.length.median)) }),
        evidence: evidenceIds(rows, state, (text) => charCount(text) >= cutoff),
      });
    }

    const hereBurst = bursts?.[state]?.mean ?? null;
    const restBurst = bursts ? restBurstMean(bursts, state) : null;
    if (hereBurst != null && restBurst != null) {
      if (hereBurst >= restBurst * 1.4) {
        drafts.push({
          text: copy(locale, "v6.imperfection.burst"),
          evidence: evidenceIds(rows, state, () => true),
        });
      } else if (hereBurst <= restBurst * 0.7) {
        drafts.push({
          text: copy(locale, "v6.imperfection.single"),
          evidence: evidenceIds(rows, state, () => true),
        });
      }
    }

    const hereSticker = stickerRate(styleProfile, state);
    const restSticker = restStickerRate(styleProfile, state);
    if (
      hereSticker != null &&
      restSticker != null &&
      restSticker >= 0.1 &&
      hereSticker === 0 &&
      core.samples >= 30
    ) {
      drafts.push({
        text: copy(locale, "v6.imperfection.noSticker"),
        evidence: evidenceIds(rows, state, () => true),
      });
    }

    if (rest.laughRate >= 0.05 && core.laugh.rate === 0) {
      drafts.push({
        text: copy(locale, "v6.imperfection.noLaugh"),
        evidence: evidenceIds(rows, state, () => true),
      });
    }

    const hereGap = replyMedianMinutes(styleProfile, state);
    const restGap = restReplyMedianMinutes(styleProfile, state);
    if (hereGap != null && restGap != null && restGap > 0 && hereGap >= restGap * 3) {
      drafts.push({
        text: copy(locale, "v6.imperfection.slow", { m: String(Math.round(hereGap)) }),
        evidence: evidenceIds(rows, state, () => true),
      });
    }

    if (core.endings.period >= 0.5 && rest.periodRate <= 0.1) {
      drafts.push({
        text: copy(locale, "v6.imperfection.period"),
        evidence: evidenceIds(rows, state, (text) => endingClassOf(text) === "period"),
      });
    }

    if (drafts.length > 0) out[state] = drafts;
  }

  return out;
}

export function normalizeImperfectionDrafts(value: unknown): ImperfectionDrafts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: ImperfectionDrafts = {};
  for (const state of FINGERPRINT_STATES) {
    const rows = source[state];
    if (!Array.isArray(rows)) continue;
    const drafts: ImperfectionDraft[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const text = typeof (row as { text?: unknown }).text === "string"
        ? (row as { text: string }).text.trim()
        : "";
      if (!text) continue;
      const evidence = Array.isArray((row as { evidence?: unknown }).evidence)
        ? (row as { evidence: unknown[] }).evidence.filter((id): id is number => typeof id === "number")
        : [];
      drafts.push({ text, evidence });
    }
    if (drafts.length > 0) out[state] = drafts;
  }
  return out;
}

function restOf(
  perState: NonNullable<StyleFingerprint["perState"]>,
  skip: EmotionalState,
): { lengthMedian: number; laughRate: number; periodRate: number } | null {
  let samples = 0;
  let lengthAcc = 0;
  let laughAcc = 0;
  let periodAcc = 0;
  for (const state of FINGERPRINT_STATES) {
    if (state === skip) continue;
    const core = perState[state];
    if (!core) continue;
    samples += core.samples;
    lengthAcc += core.length.median * core.samples;
    laughAcc += core.laugh.rate * core.samples;
    periodAcc += core.endings.period * core.samples;
  }
  if (samples < MIN_FINGERPRINT_STATE_SAMPLES) return null;
  return {
    lengthMedian: lengthAcc / samples,
    laughRate: laughAcc / samples,
    periodRate: periodAcc / samples,
  };
}

function evidenceIds(
  rows: FingerprintRow[],
  state: EmotionalState,
  matches: (text: string) => boolean,
): number[] {
  const out: number[] = [];
  for (const row of rows) {
    if ((row.role ?? "assistant") !== "assistant" || !isTextRecord(row)) continue;
    if (row.emotion !== state) continue;
    if (typeof row.id !== "number") continue;
    const text = String(row.content ?? "").trim();
    if (!text || !matches(text)) continue;
    out.push(row.id);
    if (out.length >= 3) break;
  }
  return out;
}

interface BurstStat {
  /** How many messages they send in one go in this state. */
  mean: number;
  /** How many of their turns the mean was counted from. */
  turns: number;
}

/**
 * How many bubbles their turns have, per emotional state.
 *
 * This is read from the rows, not from the follow-up profile: "连发"
 * means two or three lines in one turn, not a second thought after a
 * silence. A turn is consecutive lines by the same person; the state is
 * the mood the scene was labelled with.
 */
function burstStats(rows: FingerprintRow[]): Partial<Record<EmotionalState, BurstStat>> | null {
  const textRows = rows.filter((row) => isTextRecord(row));
  if (textRows.length === 0) return null;
  const totals = new Map<EmotionalState, { messages: number; turns: number }>();
  for (const scene of splitScenes(textRows)) {
    for (const turn of toTurns(scene)) {
      if ((turn[0]?.role ?? "assistant") !== "assistant") continue;
      const state = turn.map((row) => row.emotion).find(isState);
      if (!state) continue;
      const messages = turn.filter(
        (row) => (row.role ?? "assistant") === "assistant",
      ).length;
      if (messages === 0) continue;
      const entry = totals.get(state) ?? { messages: 0, turns: 0 };
      entry.messages += messages;
      entry.turns += 1;
      totals.set(state, entry);
    }
  }
  const out: Partial<Record<EmotionalState, BurstStat>> = {};
  for (const [state, entry] of totals) {
    if (entry.turns > 0) out[state] = { mean: entry.messages / entry.turns, turns: entry.turns };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function restBurstMean(
  stats: Partial<Record<EmotionalState, BurstStat>>,
  skip: EmotionalState,
): number | null {
  let messages = 0;
  let turns = 0;
  for (const state of FINGERPRINT_STATES) {
    if (state === skip) continue;
    const stat = stats[state];
    if (!stat) continue;
    messages += stat.mean * stat.turns;
    turns += stat.turns;
  }
  if (turns === 0) return null;
  return messages / turns;
}

function stickerRate(profile: { stickers?: unknown }, state: EmotionalState): number | null {
  return numericByState(profile.stickers, state, ["rate", "share"]);
}

function restStickerRate(profile: { stickers?: unknown }, skip: EmotionalState): number | null {
  return restNumericByState(profile.stickers, skip, ["rate", "share"]);
}

/**
 * Their median reply delay in one state, in minutes.
 *
 * The measured shape is `DelayBuckets` (B5.3). Its keys are
 * `band|state|asking|media` and `band|state|asking`; the three-part
 * bucket already includes both media values, so using it alone avoids
 * counting the same gap twice. The bucket's `mu` is the mean of
 * `ln(seconds)`, so `exp(mu)` is the median.
 */
function replyMedianMinutes(profile: { replyDelay?: unknown }, state: EmotionalState): number | null {
  const buckets = asDelayBuckets(profile.replyDelay);
  if (!buckets) return null;
  return medianMinutesForStates(buckets, new Set([state]));
}

function restReplyMedianMinutes(profile: { replyDelay?: unknown }, skip: EmotionalState): number | null {
  const buckets = asDelayBuckets(profile.replyDelay);
  if (!buckets) return null;
  const states = new Set(FINGERPRINT_STATES.filter((state) => state !== skip));
  return medianMinutesForStates(buckets, states);
}

function asDelayBuckets(value: unknown): DelayBuckets | null {
  const source = asRecord(value);
  const raw = asRecord(source?.buckets);
  if (!raw) return null;
  const buckets: Record<string, DelayBucket> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const bucket = asRecord(entry);
    if (!bucket) continue;
    const n = bucket.n;
    const mu = bucket.mu;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) continue;
    if (typeof mu !== "number" || !Number.isFinite(mu)) continue;
    const sigma = typeof bucket.sigma === "number" && Number.isFinite(bucket.sigma) ? bucket.sigma : 0;
    buckets[key] = { n, mu, sigma };
  }
  if (Object.keys(buckets).length === 0) return null;
  const samples = typeof source?.samples === "number" ? source.samples : 0;
  return {
    buckets,
    samples,
    resolution: source?.resolution === "minute" ? "minute" : "second",
  };
}

function medianMinutesForStates(
  profile: DelayBuckets,
  states: Set<string>,
): number | null {
  const chosen = new Map<string, DelayBucket>();
  for (const state of states) {
    const keys = Object.keys(profile.buckets).filter((key) => {
      const parts = key.split("|");
      return parts.length >= 2 && parts[1] === state;
    });
    const threePart = keys.filter((key) => key.split("|").length === 3);
    const use = threePart.length > 0 ? threePart : keys.filter((key) => key.split("|").length === 4);
    for (const key of use) {
      const bucket = profile.buckets[key];
      if (bucket) chosen.set(key, bucket);
    }
  }
  let n = 0;
  let mu = 0;
  for (const bucket of chosen.values()) {
    n += bucket.n;
    mu += bucket.mu * bucket.n;
  }
  if (n < DELAY_BUCKET_MIN) return null;
  return Math.exp(mu / n) / 60;
}

function numericByState(
  value: unknown,
  state: EmotionalState,
  keys: string[],
): number | null {
  const source = asRecord(value);
  if (!source) return null;
  /**
   * The measured shape is `byState` (B7.1): `{ byState: { warm: {rate} } }`.
   * The older `state` / `perState` lookups never matched a real
   * measurement, so the sticker rules could not fire at all.
   */
  const byState =
    asRecord(asRecord(source.byState)?.[state])
    ?? asRecord(source[state])
    ?? asRecord(asRecord(source.perState)?.[state]);
  if (!byState) return null;
  for (const key of keys) {
    const n = byState[key];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

function restNumericByState(
  value: unknown,
  skip: EmotionalState,
  keys: string[],
): number | null {
  let samples = 0;
  let acc = 0;
  for (const state of FINGERPRINT_STATES) {
    if (state === skip) continue;
    const n = numericByState(value, state, keys);
    if (n == null) continue;
    samples += 1;
    acc += n;
  }
  if (samples < 1) return null;
  return acc / samples;
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function isState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
