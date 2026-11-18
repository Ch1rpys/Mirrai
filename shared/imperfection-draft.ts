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
import {
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
  doubleText?: unknown;
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
      drafts.push({
        text: copy(locale, "v6.imperfection.short", { n: String(Math.round(core.length.median)) }),
        evidence: evidenceIds(rows, state, () => true),
      });
    } else if (core.length.median >= rest.lengthMedian * 1.5) {
      drafts.push({
        text: copy(locale, "v6.imperfection.long", { n: String(Math.round(core.length.median)) }),
        evidence: evidenceIds(rows, state, () => true),
      });
    }

    const hereBurst = burstMean(styleProfile, state);
    const restBurst = restBurstMean(styleProfile, state);
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
        evidence: evidenceIds(rows, state, (text) => text.includes("。")),
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

function burstMean(profile: { doubleText?: unknown }, state: EmotionalState): number | null {
  return numericByState(profile.doubleText, state, ["mean", "avg", "perTurn"]);
}

function restBurstMean(profile: { doubleText?: unknown }, skip: EmotionalState): number | null {
  return restNumericByState(profile.doubleText, skip, ["mean", "avg", "perTurn"]);
}

function stickerRate(profile: { stickers?: unknown }, state: EmotionalState): number | null {
  return numericByState(profile.stickers, state, ["rate", "share"]);
}

function restStickerRate(profile: { stickers?: unknown }, skip: EmotionalState): number | null {
  return restNumericByState(profile.stickers, skip, ["rate", "share"]);
}

function replyMedianMinutes(profile: { replyDelay?: unknown }, state: EmotionalState): number | null {
  const seconds = numericByState(profile.replyDelay, state, ["medianSec", "medianMinutes"]);
  if (seconds == null) return null;
  const source = asRecord(profile.replyDelay);
  const byState = asRecord(source?.[state]);
  if (byState && typeof byState.medianMinutes === "number") return byState.medianMinutes;
  return seconds / 60;
}

function restReplyMedianMinutes(profile: { replyDelay?: unknown }, skip: EmotionalState): number | null {
  return restNumericByState(profile.replyDelay, skip, ["medianMinutes", "medianSec"]);
}

function numericByState(
  value: unknown,
  state: EmotionalState,
  keys: string[],
): number | null {
  const source = asRecord(value);
  if (!source) return null;
  const byState = asRecord(source[state]) ?? asRecord(asRecord(source.perState)?.[state]);
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
