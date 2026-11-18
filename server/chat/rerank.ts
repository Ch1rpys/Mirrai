/**
 * Picking among four candidates.
 *
 * The highest likelihood is the average sentence. What people recognise
 * is the line that sits near this person's own median — after the
 * assistant-shaped ones and the ones that copied an exemplar are gone.
 *
 * When a fingerprint is in play the same two hard discards stay, and
 * the surviving lines are scored on likelihood, length, surprise,
 * residue, the sampled act, and a discriminator — smaller is closer.
 */
import {
  EXEMPLAR_DICE_CEILING,
  exemplarDice,
  lengthCeiling,
  residueFlags,
  scoreResidue,
} from "@shared/assistant-residue";
import { labelSpeechActByRule } from "@shared/speech-acts";
import {
  lineSurprise,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";
import { scoreReal, type SparseModel } from "../eval/discriminator";
import { buildCharNgramModel, type CharNgramModel } from "../eval/metrics";
import {
  buildRerankModel,
  lengthNormalisedLogProb,
  type RerankModel,
} from "./rerank-model";

export { lengthNormalisedLogProb };

export const DEFAULT_RERANK_WEIGHTS = {
  ll: 1,
  length: 0.5,
  surprise: 0.5,
  residue: 2,
  act: 1,
  real: 1,
} as const;

export type RerankWeightKey = keyof typeof DEFAULT_RERANK_WEIGHTS;

export interface RerankCandidate {
  text: string;
}

export interface RerankScore {
  index: number;
  text: string;
  discarded?: "residue" | "exemplar" | "empty";
  lengthNormLogProb?: number;
  distanceToMedian?: number;
  score?: number;
  ll?: number;
  length?: number;
  surprise?: number;
  residue?: number;
  act?: number;
  real?: number;
}

export interface RerankResult {
  index: number;
  text: string;
  scores: RerankScore[];
}

export function pickRerankWinner(params: {
  candidates: RerankCandidate[];
  trainingTexts?: string[];
  model?: RerankModel | null;
  exemplars?: string[];
  lengths?: number[];
  fingerprint?: StyleFingerprintCore | null;
  sampledAct?: string | null;
  discriminator?: SparseModel | null;
  weights?: Partial<Record<RerankWeightKey, number>> | Record<string, number> | null;
  fingerprintRerank?: boolean;
}): RerankResult | null {
  const usable = params.candidates.map((item) => item.text.trim());
  if (!usable.some(Boolean)) return null;
  const model = params.model ?? buildRerankModel(params.trainingTexts ?? []);
  const ngram: CharNgramModel = model?.ngram ?? buildCharNgramModel(params.trainingTexts ?? []);
  const training = model?.texts ?? params.trainingTexts ?? [];
  const ceiling = lengthCeiling(params.lengths ?? model?.lengths ?? training.map((text) => text.length));
  const realLog = training
    .map((text) => lengthNormalisedLogProb(ngram, text))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const median = model?.llMedian ?? (realLog.length ? realLog[Math.floor(realLog.length / 2)]! : 0);
  const fingerprintOn = Boolean(params.fingerprintRerank && params.fingerprint);
  const weights = mergeWeights(params.weights);

  const scores: RerankScore[] = usable.map((text, index) => {
    if (!text) return { index, text, discarded: "empty" };
    const residue = residueFlags(text, { ceiling });
    const discarded: RerankScore["discarded"] =
      residue.emotionCliche || residue.listed
        ? "residue"
        : (params.exemplars ?? []).some((ex) => exemplarDice(text, ex) > EXEMPLAR_DICE_CEILING)
          ? "exemplar"
          : undefined;
    const lengthNormLogProb = lengthNormalisedLogProb(ngram, text);
    const row: RerankScore = {
      index,
      text,
      discarded,
      lengthNormLogProb,
      distanceToMedian: Math.abs(lengthNormLogProb - median),
    };
    if (fingerprintOn && params.fingerprint) {
      Object.assign(row, scoreFingerprint(text, params.fingerprint, {
        model,
        ngram,
        median,
        ceiling,
        sampledAct: params.sampledAct ?? null,
        discriminator: params.discriminator ?? null,
        weights,
        lengthNormLogProb,
      }));
    }
    return row;
  });

  const survivors = scores.filter((row) => !row.discarded);
  const pool = survivors.length ? survivors : scores.filter((row) => row.text);
  if (!pool.length) return null;
  pool.sort((a, b) => {
    if (fingerprintOn) {
      const sa = a.score ?? Number.POSITIVE_INFINITY;
      const sb = b.score ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
    }
    const da = a.distanceToMedian ?? Number.POSITIVE_INFINITY;
    const db = b.distanceToMedian ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return (b.lengthNormLogProb ?? 0) - (a.lengthNormLogProb ?? 0);
  });
  const winner = pool[0]!;
  return { index: winner.index, text: winner.text, scores };
}

function mergeWeights(
  raw?: Partial<Record<RerankWeightKey, number>> | Record<string, number> | null,
): Record<RerankWeightKey, number> {
  const next: Record<RerankWeightKey, number> = { ...DEFAULT_RERANK_WEIGHTS };
  if (!raw) return next;
  for (const key of Object.keys(DEFAULT_RERANK_WEIGHTS) as RerankWeightKey[]) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
  }
  return next;
}

function scoreFingerprint(
  text: string,
  fingerprint: StyleFingerprintCore,
  ctx: {
    model: RerankModel | null;
    ngram: CharNgramModel;
    median: number;
    ceiling: number | null;
    sampledAct: string | null;
    discriminator: SparseModel | null;
    weights: Record<RerankWeightKey, number>;
    lengthNormLogProb: number;
  },
): Pick<RerankScore, "score" | "ll" | "length" | "surprise" | "residue" | "act" | "real"> {
  const llIqr = Math.max(0.1, ctx.model?.llIqr ?? 0.1);
  const lengthMedian = ctx.model?.lengthMedian ?? fingerprint.length.median;
  const lengthP90 = ctx.model?.lengthP90 ?? fingerprint.length.p90;
  const chars = Array.from(text).length;
  const ll = Math.min(3, Math.abs(ctx.lengthNormLogProb - ctx.median) / llIqr);
  const length = Math.min(
    3,
    Math.abs(chars - lengthMedian) / Math.max(1, lengthP90 - lengthMedian),
  );
  const surprise = Math.min(3, lineSurprise(text, fingerprint) / 5);
  const residue = scoreResidue(text, { ceiling: ctx.ceiling }).rate;
  const labelled = labelSpeechActByRule(text, undefined, { precisionOnly: true });
  const act = ctx.sampledAct && labelled !== ctx.sampledAct ? 1 : 0;
  const real = ctx.discriminator
    ? scoreReal(ctx.discriminator, text, fingerprint)
    : 0.5;
  const w = ctx.weights;
  const score =
    w.ll * ll +
    w.length * length +
    w.surprise * surprise +
    w.residue * residue +
    w.act * act -
    w.real * real;
  return { score, ll, length, surprise, residue, act, real };
}
