/**
 * The habits that make a reply sound like a helpful assistant.
 *
 * Four cheap tells, the same ones the evaluation reports and the
 * reranker uses to throw a candidate away:
 *
 *   it ends on a question the person would not have asked;
 *   it opens with an emotion-acknowledgement formula;
 *   it lays the answer out as a numbered list;
 *   it is longer than this person runs.
 *
 * None of these replace the likelihood ruler. They sit beside it.
 */
import { ngramOverlap } from "./ngram";

const QUESTION_ENDING = /[?？]\s*$/;

const ACK_CLICHES = [
  /^(我理解你|我明白你|听起来你|这一定很难|谢谢你分享|i (hear|understand) you|that sounds|i'?m sorry you'?re going through)/i,
  /^(你的感受是|你现在一定|it's okay to feel|i appreciate you telling me)/i,
];

const NUMBERED_LIST = /(?:^|\n)\s*(?:[-*]|\d+[.)、])\s+\S+/;

export interface ResidueFlags {
  questionEnding: boolean;
  emotionCliche: boolean;
  listed: boolean;
  tooLong: boolean;
}

export interface ResidueScore extends ResidueFlags {
  /** How many of the four tells fired, 0–1. */
  rate: number;
}

/**
 * The length this person would still recognise as theirs.
 *
 * A high percentile of their own replies. Above it the line is a
 * paragraph, and a paragraph is what an assistant writes.
 */
export function lengthCeiling(lengths: number[], percentile = 0.9): number | null {
  const usable = lengths.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (usable.length < 8) return null;
  const index = Math.min(
    usable.length - 1,
    Math.max(0, Math.floor(percentile * (usable.length - 1))),
  );
  return usable[index];
}

export function residueFlags(
  text: string,
  options?: { ceiling?: number | null },
): ResidueFlags {
  const trimmed = String(text ?? "").trim();
  const ceiling = options?.ceiling;
  return {
    questionEnding: QUESTION_ENDING.test(trimmed),
    emotionCliche: ACK_CLICHES.some((pattern) => pattern.test(trimmed)),
    listed: NUMBERED_LIST.test(trimmed),
    tooLong: typeof ceiling === "number" ? trimmed.length > ceiling : false,
  };
}

export function scoreResidue(
  text: string,
  options?: { ceiling?: number | null },
): ResidueScore {
  const flags = residueFlags(text, options);
  const hits = [flags.questionEnding, flags.emotionCliche, flags.listed, flags.tooLong].filter(
    Boolean,
  ).length;
  return { ...flags, rate: hits / 4 };
}

/**
 * How much of the assistant-shaped tells show up across a run.
 *
 * Reported next to actMatch. It does not replace likelihood.
 */
export function aggregateResidue(scores: ResidueScore[]): number {
  if (!scores.length) return 0;
  return scores.reduce((sum, score) => sum + score.rate, 0) / scores.length;
}

/**
 * Dice overlap of character trigrams, used to drop a candidate that is
 * copying an exemplar rather than using it as material.
 */
export function exemplarDice(generated: string, exemplar: string): number {
  return ngramOverlap(generated, exemplar, 3);
}

export const EXEMPLAR_DICE_CEILING = 0.75;
