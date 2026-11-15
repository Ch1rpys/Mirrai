/**
 * Picking among four candidates.
 *
 * The highest likelihood is the average sentence. What people recognise
 * is the line that sits near this person's own median — after the
 * assistant-shaped ones and the ones that copied an exemplar are gone.
 */
import {
  EXEMPLAR_DICE_CEILING,
  exemplarDice,
  lengthCeiling,
  residueFlags,
} from "@shared/assistant-residue";
import { buildCharNgramModel, type CharNgramModel } from "../eval/metrics";

export interface RerankCandidate {
  text: string;
}

export interface RerankScore {
  index: number;
  text: string;
  discarded?: "residue" | "exemplar" | "empty";
  lengthNormLogProb?: number;
  distanceToMedian?: number;
}

export interface RerankResult {
  index: number;
  text: string;
  scores: RerankScore[];
}

export function lengthNormalisedLogProb(model: CharNgramModel, text: string): number {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean.length) return Number.NEGATIVE_INFINITY;
  return model.logProb(clean) / clean.length;
}

export function pickRerankWinner(params: {
  candidates: RerankCandidate[];
  trainingTexts: string[];
  exemplars?: string[];
  lengths?: number[];
}): RerankResult | null {
  const usable = params.candidates.map((item) => item.text.trim());
  if (!usable.some(Boolean)) return null;
  const model = buildCharNgramModel(params.trainingTexts);
  const ceiling = lengthCeiling(params.lengths ?? params.trainingTexts.map((text) => text.length));
  const realLog = params.trainingTexts
    .map((text) => lengthNormalisedLogProb(model, text))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const median = realLog.length
    ? realLog[Math.floor(realLog.length / 2)]
    : 0;

  const scores: RerankScore[] = usable.map((text, index) => {
    if (!text) return { index, text, discarded: "empty" };
    const residue = residueFlags(text, { ceiling });
    if (residue.emotionCliche || residue.listed) {
      return { index, text, discarded: "residue" };
    }
    if ((params.exemplars ?? []).some((ex) => exemplarDice(text, ex) > EXEMPLAR_DICE_CEILING)) {
      return { index, text, discarded: "exemplar" };
    }
    const lengthNormLogProb = lengthNormalisedLogProb(model, text);
    return {
      index,
      text,
      lengthNormLogProb,
      distanceToMedian: Math.abs(lengthNormLogProb - median),
    };
  });

  const survivors = scores.filter((row) => !row.discarded);
  const pool = survivors.length ? survivors : scores.filter((row) => row.text);
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const da = a.distanceToMedian ?? Number.POSITIVE_INFINITY;
    const db = b.distanceToMedian ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return (b.lengthNormLogProb ?? 0) - (a.lengthNormLogProb ?? 0);
  });
  const winner = pool[0];
  return { index: winner.index, text: winner.text, scores };
}
