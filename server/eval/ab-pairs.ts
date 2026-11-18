/**
 * A/B choice pairs from the web chat.
 *
 * Every eight turns the persona offers two unreplied lines. The features
 * stored with each pick are the B3.3 scoring items. Thirty of them train
 * a logistic regression (the same SGD as B8.1) whose weights go onto
 * `styleProfile.rerankWeights`.
 */
import { normalizePersonaSettings } from "@shared/persona-settings";
import { scoreResidue } from "@shared/assistant-residue";
import { labelSpeechActByRule } from "@shared/speech-acts";
import {
  lineSurprise,
  type StyleFingerprint,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";
import { normalizeStyleProfile } from "@shared/style-profile";
import { scoreReal, trainLogistic, type SparseModel } from "./discriminator";

export const CHOICE_MIN_PAIRS = 30;

export const CHOICE_FEATURE_KEYS = [
  "ll",
  "length",
  "surprise",
  "residue",
  "act",
  "real",
] as const;

export type ChoiceFeatureKey = (typeof CHOICE_FEATURE_KEYS)[number];
export type ChoiceFeatures = Record<ChoiceFeatureKey, number>;

export interface PendingChoice {
  options: [string, string];
  features: [ChoiceFeatures, ChoiceFeatures];
  sampledAct: string | null;
  periodId: string | null;
}

export interface ChoicePairExample {
  chosen: ChoiceFeatures;
  rejected: ChoiceFeatures;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Whether this web turn should offer two unreplied lines.
 *
 * Crisis, ritual and silence are decided by the caller: this only looks
 * at the switch, the channel, and `chatCount % 8`. A count of zero is
 * skipped so the first message is not billed twice.
 */
export function shouldOfferChoice(
  persona: { settings?: unknown; chatCount?: number | null },
  channel?: string | null,
): boolean {
  if (channel && channel !== "web") return false;
  const settings = normalizePersonaSettings(persona.settings);
  if (!settings.layers.abPairs) return false;
  const count = Number(persona.chatCount) || 0;
  return count > 0 && count % 8 === 0;
}

export function featuresOfLine(
  text: string,
  ctx: {
    fingerprint?: StyleFingerprint | StyleFingerprintCore | null;
    sampledAct?: string | null;
    discriminator?: SparseModel | null;
  },
): ChoiceFeatures {
  const trimmed = String(text ?? "");
  const fingerprint = ctx.fingerprint ?? null;
  const ceiling = fingerprint && "length" in fingerprint ? fingerprint.length.p90 : null;
  const labelled = labelSpeechActByRule(trimmed, undefined, { precisionOnly: true });
  const actMismatch =
    Boolean(ctx.sampledAct) && labelled !== null && labelled !== ctx.sampledAct ? 1 : 0;
  return {
    ll: 0,
    length: Array.from(trimmed).length,
    surprise: fingerprint ? lineSurprise(trimmed, fingerprint) : 0,
    residue: scoreResidue(trimmed, { ceiling }).rate,
    act: actMismatch,
    real: ctx.discriminator ? scoreReal(ctx.discriminator, trimmed, fingerprint) : 0.5,
  };
}

export function pendingChoiceOf(metadata: unknown): PendingChoice | null {
  if (!isPlainObject(metadata)) return null;
  const raw = metadata.pendingChoice;
  if (!isPlainObject(raw)) return null;
  const options = Array.isArray(raw.options)
    ? raw.options.filter((item): item is string => typeof item === "string")
    : [];
  if (options.length < 2) return null;
  const features = Array.isArray(raw.features)
    ? raw.features.map((item) => featuresFromUnknown(item))
    : [emptyFeatures(), emptyFeatures()];
  return {
    options: [options[0]!, options[1]!],
    features: [features[0] ?? emptyFeatures(), features[1] ?? emptyFeatures()],
    sampledAct: typeof raw.sampledAct === "string" ? raw.sampledAct : null,
    periodId: typeof raw.periodId === "string" ? raw.periodId : null,
  };
}

export function matchesChoicePair(
  chosen: string,
  rejected: string,
  options: [string, string],
): boolean {
  const [a, b] = options;
  return (chosen === a && rejected === b) || (chosen === b && rejected === a);
}

export function sparseModelFromUnknown(value: unknown): SparseModel | null {
  if (!isPlainObject(value)) return null;
  const model = isPlainObject(value.model) ? value.model : value;
  if (typeof model.bias !== "number") return null;
  const ngrams = Array.isArray(model.ngrams)
    ? model.ngrams.flatMap((item) => {
        if (!isPlainObject(item)) return [];
        if (typeof item.gram !== "string" || typeof item.weight !== "number") return [];
        return [{ gram: item.gram, weight: item.weight }];
      })
    : [];
  const dense = isPlainObject(model.dense)
    ? (model.dense as SparseModel["dense"])
    : {};
  return { bias: model.bias, dense, ngrams };
}

export function fingerprintFromPersona(persona: { styleProfile?: unknown }): {
  fingerprint: StyleFingerprint | null;
  discriminator: SparseModel | null;
} {
  const profile = normalizeStyleProfile(persona.styleProfile);
  const fingerprint =
    profile.fingerprint && typeof profile.fingerprint === "object"
      ? (profile.fingerprint as StyleFingerprint)
      : null;
  return {
    fingerprint,
    discriminator: sparseModelFromUnknown(profile.discriminator),
  };
}

/**
 * Train rerank weights from chosen-minus-rejected feature differences.
 *
 * A feature that is systematically smaller on the chosen line gets a
 * negative weight — so always picking the shorter line makes `length`
 * negative.
 */
export function trainRerankWeights(
  pairs: ChoicePairExample[],
  seed: string,
): Record<ChoiceFeatureKey, number> | null {
  if (pairs.length < CHOICE_MIN_PAIRS) return null;
  const examples: Array<{ x: number[]; y: number }> = [];
  for (const pair of pairs) {
    const diff = CHOICE_FEATURE_KEYS.map(
      (key) => (pair.chosen[key] ?? 0) - (pair.rejected[key] ?? 0),
    );
    examples.push({ x: diff, y: 1 });
    examples.push({ x: diff.map((value) => -value), y: 0 });
  }
  const fitted = trainLogistic(examples, seed);
  const weights = {} as Record<ChoiceFeatureKey, number>;
  for (let i = 0; i < CHOICE_FEATURE_KEYS.length; i++) {
    weights[CHOICE_FEATURE_KEYS[i]!] = fitted.weights[i] ?? 0;
  }
  return weights;
}

export function pairExamplesFromRows(
  rows: Array<{ features?: unknown }>,
): ChoicePairExample[] {
  const out: ChoicePairExample[] = [];
  for (const row of rows) {
    if (!isPlainObject(row.features)) continue;
    const chosen = featuresFromUnknown(row.features.chosen);
    const rejected = featuresFromUnknown(row.features.rejected);
    out.push({ chosen, rejected });
  }
  return out;
}

function emptyFeatures(): ChoiceFeatures {
  return { ll: 0, length: 0, surprise: 0, residue: 0, act: 0, real: 0.5 };
}

function featuresFromUnknown(value: unknown): ChoiceFeatures {
  const source = isPlainObject(value) ? value : {};
  const next = emptyFeatures();
  for (const key of CHOICE_FEATURE_KEYS) {
    const raw = source[key];
    if (typeof raw === "number" && Number.isFinite(raw)) next[key] = raw;
  }
  return next;
}
