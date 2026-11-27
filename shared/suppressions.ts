/**
 * Subtraction rules — the things this person does *not* do.
 *
 * Discriminative rules say what a trigger means. These say what never
 * happens: they do not end on a question, they do not give advice, they
 * do not use a phrase the product would. A prompt that only describes a
 * person still asks the model to invent the rest; a prompt that also
 * subtracts the generic habits leaves less for it to fill in.
 *
 * Same shape as a micro-rule on purpose: unconfirmed candidates stay in
 * the editor, and only `verified` ones are rendered. Hand-written rows
 * count as confirmed.
 */
import { copy, type Locale } from "./copy";

export const SUPPRESSION_KINDS = [
  "no_question_ending",
  "no_phrase",
  "no_advice",
  "no_subclause",
  "no_word_class",
  "avoid_topic",
  "forget_admit",
  "forget_wrong",
  "forget_deflect",
  "multi_point",
  "knowledge_boundary",
] as const;

export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export interface SuppressionEvidence {
  at?: string;
  snippet: string;
}

export interface Suppression {
  id: string;
  /** The pattern, phrase, or topic this forbids. */
  pattern: string;
  kind: SuppressionKind;
  confidence: number;
  source: "auto" | "manual";
  verified: boolean;
  evidence: SuppressionEvidence[];
}

const KIND_SET = new Set<string>(SUPPRESSION_KINDS);

export function isSuppressionKind(value: unknown): value is SuppressionKind {
  return typeof value === "string" && KIND_SET.has(value);
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toEvidence(value: unknown): SuppressionEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: SuppressionEvidence[] = [];
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

function toConfidence(value: unknown): number {
  if (value === undefined || value === null) return 0.5;
  const n = typeof value === "number" ? value : Number(toText(value));
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * The key a rejected subtraction is remembered under (C10.6).
 *
 * The mined id is derived from the kind and the phrase, so both are
 * stable across a re-distillation. Recorded in
 * `personaData.rejectedFeedbackKeys`, it keeps the same candidate from
 * coming back.
 */
export function suppressionRejectedKey(kind: SuppressionKind, pattern: string): string {
  return `suppression:${kind}:${pattern}`;
}

export function normalizeSuppressions(value: unknown): Suppression[] {
  if (!Array.isArray(value)) return [];
  const out: Suppression[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const pattern = toText(record.pattern);
    const kind = record.kind;
    if (!isSuppressionKind(kind)) return;
    if (!pattern && kind !== "multi_point") return;
    const source = record.source === "manual" ? "manual" : "auto";
    out.push({
      id: toText(record.id) || `suppression-${index + 1}`,
      pattern,
      kind,
      confidence: toConfidence(record.confidence),
      source,
      verified: source === "manual" ? record.verified !== false : record.verified === true,
      evidence: toEvidence(record.evidence),
    });
  });
  return out;
}

export function activeSuppressions(
  rules: Suppression[],
  includeUnverified = false,
): Suppression[] {
  return rules.filter((rule) => (includeUnverified ? true : rule.verified));
}

const KIND_LINE: Record<SuppressionKind, `prompt.suppression.${SuppressionKind}`> = {
  no_question_ending: "prompt.suppression.no_question_ending",
  no_phrase: "prompt.suppression.no_phrase",
  no_advice: "prompt.suppression.no_advice",
  no_subclause: "prompt.suppression.no_subclause",
  no_word_class: "prompt.suppression.no_word_class",
  avoid_topic: "prompt.suppression.avoid_topic",
  forget_admit: "prompt.suppression.forget_admit",
  forget_wrong: "prompt.suppression.forget_wrong",
  forget_deflect: "prompt.suppression.forget_deflect",
  multi_point: "prompt.suppression.multi_point",
  knowledge_boundary: "prompt.suppression.knowledge_boundary",
};

/**
 * The confirmed subtractions, written as constraints.
 *
 * They sit next to the discriminative rules, inside the material fence:
 * the user can read them, so they are material, not a hidden system
 * order. The wording is still a constraint — "do not" — because a
 * description of an absence is easy to ignore.
 */
export function renderSuppressions(
  rules: Suppression[],
  locale: Locale = "zh",
): string {
  const active = activeSuppressions(rules);
  if (!active.length) return "";
  const lines = active.map((rule) =>
    copy(locale, KIND_LINE[rule.kind], { pattern: rule.pattern }),
  );
  return [
    copy(locale, "prompt.suppressionsHeading"),
    copy(locale, "prompt.suppressionsIntro"),
    ...lines,
  ].join("\n");
}

/** Below this rate, and with enough samples, "they never end on a question" is a candidate. */
export const QUESTION_ENDING_FLOOR = 0.08;

/** Mining does not invent a ban from a rumour. */
export const SUPPRESSION_MIN_SAMPLES = 40;
