/**
 * How long this turn is allowed to be.
 *
 * The model used to get the user's maxTokens, or the provider's 4096.
 * A person who writes twelve characters does not write four thousand.
 * The cap is their own p95, with a little room; without a fingerprint
 * there is no cap.
 */
import {
  MIN_FINGERPRINT_SAMPLES,
  type StyleFingerprint,
} from "./style-fingerprint";

/** Sentence ends the cap will cut on, walking backwards from the budget. */
const SENTENCE_BOUNDARIES = new Set(["。", "！", "？", "!", "?", "…", "\n", " "]);

export interface ReplyBudget {
  maxTokens: number;
  maxChars: number;
  stop?: string[];
}

/**
 * This turn's writing budget.
 *
 * `burstMax` is the largest burst in the behaviour profile. A 1 means
 * they never send two lines; together with a tiny newline rate that
 * becomes a stop sequence so the model does not invent a paragraph.
 */
export function replyBudget(
  fp: StyleFingerprint | null,
  burstMax: number,
  options?: { userMaxTokens?: number; newlineRate?: number | null },
): ReplyBudget | null {
  if (!fp || fp.samples < MIN_FINGERPRINT_SAMPLES) return null;
  const p95 = fp.turnChars?.p95;
  if (typeof p95 !== "number" || !Number.isFinite(p95)) return null;
  const maxChars = Math.max(12, Math.ceil(p95 * 1.5));
  let maxTokens = Math.ceil(maxChars * 2);
  const userMax = options?.userMaxTokens;
  if (typeof userMax === "number" && Number.isFinite(userMax) && userMax > 0) {
    maxTokens = Math.min(maxTokens, Math.floor(userMax));
  }
  const budget: ReplyBudget = { maxTokens, maxChars };
  const newlineRate = options?.newlineRate;
  if (burstMax === 1 && typeof newlineRate === "number" && newlineRate < 0.02) {
    budget.stop = ["\n"];
  }
  return budget;
}

/** Cuts a reply to `maxChars` on a sentence boundary when one exists. */
export function capReply(text: string, maxChars: number): { text: string; capped: boolean } {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, capped: false };
  const prefix = chars.slice(0, maxChars);
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (SENTENCE_BOUNDARIES.has(prefix[i]!)) {
      return { text: prefix.slice(0, i + 1).join(""), capped: true };
    }
  }
  return { text: prefix.join(""), capped: true };
}
