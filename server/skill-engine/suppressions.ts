/**
 * Mining subtractions by counting, not by asking a model for prose.
 *
 * A candidate without evidence is dropped. A sample too thin to see a
 * habit is not a ban — the editor says so rather than inventing one.
 */
import {
  QUESTION_ENDING_FLOOR,
  SUPPRESSION_MIN_SAMPLES,
  normalizeSuppressions,
  type Suppression,
} from "@shared/suppressions";
import { residueFlags } from "@shared/assistant-residue";
import { copy } from "@shared/copy";
import { isTextRecord } from "@shared/records";
import type { Locale } from "@shared/copy";

export interface MineSuppressionParams {
  messages: Array<{ role: string; content: string; timestamp?: Date | string | null; kind?: string | null }>;
  locale?: Locale;
}

// i18n:allow-input — these are matched against what they actually wrote.
const CLICHES = [
  "我理解你",
  "听起来你",
  "这一定很难",
  "谢谢你分享",
  "i hear you",
  "that sounds",
  "i understand you",
];

const ADVICE = /(你可以|你应该|建议你|不如|you should|you could|maybe you)/i;

function theirs(
  messages: MineSuppressionParams["messages"],
): Array<{ content: string; at?: string }> {
  return messages
    .filter((row) => row.role === "assistant" && isTextRecord(row) && String(row.content ?? "").trim())
    .map((row) => ({
      content: String(row.content).trim(),
      ...(row.timestamp ? { at: String(row.timestamp) } : {}),
    }));
}

function idFor(kind: string, pattern: string): string {
  const slug = `${kind}:${pattern}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 48);
  return `suppression-${slug || kind}`;
}

/**
 * Counts their habits. Only a floor-crossing absence becomes a candidate.
 */
export function mineSuppressions(params: MineSuppressionParams): Suppression[] {
  const lines = theirs(params.messages);
  if (lines.length < SUPPRESSION_MIN_SAMPLES) return [];

  const out: Suppression[] = [];
  const questionEnding = lines.filter((line) => residueFlags(line.content).questionEnding);
  const rate = questionEnding.length / lines.length;
  if (rate < QUESTION_ENDING_FLOOR) {
    const counter = lines.filter((line) => !residueFlags(line.content).questionEnding).slice(0, 3);
    out.push({
      id: idFor("no_question_ending", "end"),
      pattern: copy(params.locale ?? "zh", "labels.suppressions.neverQuestion", { count: lines.length }),
      kind: "no_question_ending",
      confidence: 0.7,
      source: "auto",
      verified: false,
      evidence: counter.map((line) => ({ snippet: line.content.slice(0, 200), ...(line.at ? { at: line.at } : {}) })),
    });
  }

  for (const phrase of CLICHES) {
    const hits = lines.filter((line) => line.content.toLowerCase().includes(phrase.toLowerCase()));
    if (hits.length === 0) {
      const counter = lines.slice(0, 3);
      out.push({
        id: idFor("no_phrase", phrase),
        pattern: phrase,
        kind: "no_phrase",
        confidence: 0.6,
        source: "auto",
        verified: false,
        evidence: counter.map((line) => ({ snippet: line.content.slice(0, 200), ...(line.at ? { at: line.at } : {}) })),
      });
    }
  }

  const adviceHits = lines.filter((line) => ADVICE.test(line.content));
  if (adviceHits.length / lines.length < QUESTION_ENDING_FLOOR) {
    out.push({
      id: idFor("no_advice", "advice"),
      pattern: copy(params.locale ?? "zh", "labels.suppressions.neverAdvice", { count: lines.length }),
      kind: "no_advice",
      confidence: 0.55,
      source: "auto",
      verified: false,
      evidence: lines.filter((line) => !ADVICE.test(line.content)).slice(0, 3).map((line) => ({
        snippet: line.content.slice(0, 200),
        ...(line.at ? { at: line.at } : {}),
      })),
    });
  }

  return normalizeSuppressions(out);
}

const FORGET_PATTERNS = {
  forget_admit: /(忘了|不记得了|想不起来|i forget|i don't remember)/i,
  forget_wrong: /(不是那个|你记错了|搞混了|that's not it)/i,
  forget_deflect: /(先不说这个|换个|anyway|whatever)/i,
} as const;

/**
 * How they forget, when the sample is thick enough to see it.
 *
 * Three kinds. None of them exist when the record does not show them.
 */
export function mineForgetStyles(params: MineSuppressionParams): Suppression[] {
  const lines = theirs(params.messages);
  if (lines.length < SUPPRESSION_MIN_SAMPLES) return [];
  const out: Suppression[] = [];
  for (const [kind, pattern] of Object.entries(FORGET_PATTERNS)) {
    const hits = lines.filter((line) => pattern.test(line.content));
    if (!hits.length) continue;
    out.push({
      id: idFor(kind, "forget"),
      pattern: hits[0].content.slice(0, 80),
      kind: kind as Suppression["kind"],
      confidence: Math.min(0.8, hits.length / 10),
      source: "auto",
      verified: false,
      evidence: hits.slice(0, 3).map((line) => ({
        snippet: line.content.slice(0, 200),
        ...(line.at ? { at: line.at } : {}),
      })),
    });
  }
  return normalizeSuppressions(out);
}
