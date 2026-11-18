/**
 * A small model that tries to tell a real line from a rebuilt one.
 *
 * The overlap and the fingerprint say how close a line sits. They do not
 * say whether a stranger could still pick the rebuilt line out of a
 * pair. This file trains that stranger: hashed character n-grams, a
 * handful of dense counts, and a logistic regression. The AUC is the
 * number. The largest weights are the tells — what the model used,
 * not a claim that a person would use the same things.
 *
 * The model is tiny on purpose. It can flag "this looks generated". It
 * cannot say "this is something they would have said then".
 */
import { seededRandom } from "../_core/behavior-profile";
import {
  ENDING_CLASSES,
  endingClassOf,
  lastParticleOf,
  lineSurprise,
  type StyleFingerprint,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";

export const DISCRIMINATOR_MIN_PAIRS = 60;
export const DISCRIMINATOR_FOLDS = 5;
export const DISCRIMINATOR_EPOCHS = 30;
export const DISCRIMINATOR_LR = 0.1;
export const DISCRIMINATOR_REG = 1e-4;
export const DISCRIMINATOR_TOP_NGRAMS = 500;
export const DISCRIMINATOR_TELLS = 12;

const NGRAM_DIM = 1 << 14;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const LIST_RE = /(?:^|\n)\s*(?:[-*•]|\d+[.)])/;
const QUESTION_RE = /[?？]/g;
const EXCLAIM_RE = /[!！]/g;
// i18n:allow-input — matched against laughs in the records, not shown as copy.
const HA_CHAR = "哈";
// i18n:allow-input — matched against a period in the records, not shown as copy.
const PERIOD_CHARS = new Set(["。", ".", "．"]);

export const DENSE_FEATURES = [
  "chars",
  ...ENDING_CLASSES.map((name) => `ending.${name}` as const),
  "particle",
  "haRun",
  "emoji",
  "question",
  "exclaim",
  "newline",
  "list",
  "surprise",
] as const;
export type DenseFeature = (typeof DENSE_FEATURES)[number];

const DENSE_COUNT = DENSE_FEATURES.length;
const VEC_SIZE = NGRAM_DIM + DENSE_COUNT;

/** One real line and the rebuilt line that was meant to match it. */
export interface DiscriminatorPair {
  real: string;
  fake: string;
}
/** The handbook's name for a real/fake pair. */
export type Pair = DiscriminatorPair;

export interface DiscriminatorTell {
  feature: string;
  weight: number;
  side: "persona" | "real";
}

export interface SparseModel {
  bias: number;
  dense: Partial<Record<DenseFeature, number>>;
  ngrams: Array<{ gram: string; weight: number }>;
}

export interface DiscriminatorReport {
  pairs: number;
  auc: number;
  aucStd: number;
  tells: DiscriminatorTell[];
  insufficient: boolean;
}

export type FingerprintInput = StyleFingerprint | StyleFingerprintCore | null | undefined;

/**
 * Which fold each pair belongs to.
 *
 * The split is over pairs, not lines, so a real line and its rebuilt
 * twin never sit on opposite sides of a fold.
 */
export function assignPairFolds(
  pairCount: number,
  seed: string,
  folds = DISCRIMINATOR_FOLDS,
): number[] {
  const rng = seededRandom(`${seed}:folds`);
  const order = Array.from({ length: pairCount }, (_, i) => i);
  shuffleInPlace(order, rng);
  const assigned = Array.from({ length: pairCount }, () => 0);
  order.forEach((pairIndex, i) => {
    assigned[pairIndex] = i % folds;
  });
  return assigned;
}

/**
 * The train and test pair indices for every fold.
 *
 * A pair index that is in `test` of fold *k* is never in `train` of
 * the same fold — that is the leak the later assertion locks.
 */
export function splitPairFolds(
  pairCount: number,
  seed: string,
  folds = DISCRIMINATOR_FOLDS,
): Array<{ train: number[]; test: number[] }> {
  const assigned = assignPairFolds(pairCount, seed, folds);
  return Array.from({ length: folds }, (_, fold) => ({
    train: rangeWhere(assigned, (value) => value !== fold),
    test: rangeWhere(assigned, (value) => value === fold),
  }));
}

/**
 * Train the discriminator, or refuse when there are not enough pairs.
 *
 * Below sixty pairs the AUC is a coin toss dressed as a measurement, so
 * nothing is fitted and `insufficient` is set. The caller prints that.
 */
export function trainDiscriminator(
  pairs: DiscriminatorPair[],
  fingerprint: FingerprintInput,
  seed: string,
): DiscriminatorReport & { model: SparseModel } {
  if (pairs.length < DISCRIMINATOR_MIN_PAIRS) {
    return {
      pairs: pairs.length,
      auc: 0,
      aucStd: 0,
      tells: [],
      insufficient: true,
      model: emptyModel(),
    };
  }

  const fp = fingerprint ?? null;
  const seen = new Map<number, string>();
  const folds = splitPairFolds(pairs.length, seed);
  const aucs: number[] = [];

  for (const { train, test } of folds) {
    const weights = new Float64Array(VEC_SIZE);
    let bias = 0;
    fit(weights, () => bias, (next) => {
      bias = next;
    }, pairs, train, fp, seen, seed);
    const realScores: number[] = [];
    const fakeScores: number[] = [];
    for (const index of test) {
      const pair = pairs[index]!;
      realScores.push(predict(weights, bias, pair.real, fp, seen));
      fakeScores.push(predict(weights, bias, pair.fake, fp, seen));
    }
    aucs.push(aucRank(realScores, fakeScores));
  }

  const finalWeights = new Float64Array(VEC_SIZE);
  let finalBias = 0;
  const all = Array.from({ length: pairs.length }, (_, i) => i);
  fit(finalWeights, () => finalBias, (next) => {
    finalBias = next;
  }, pairs, all, fp, seen, `${seed}:final`);

  const model = sparsify(finalWeights, finalBias, seen);
  const mean = meanOf(aucs);
  return {
    pairs: pairs.length,
    auc: mean,
    aucStd: stdOf(aucs, mean),
    tells: tellsOf(model),
    insufficient: false,
    model,
  };
}

/**
 * Probability that `text` is a real line, according to the fitted model.
 */
/**
 * The real/fake pairs sitting on one evaluation run's scores.
 *
 * `generatedSamples` is the k lines from `--k`; each one is a pair
 * against the same real line. A score with neither a sample nor a
 * generated line is skipped.
 */
export function pairsFromScores(
  scores: Array<{
    expectedText?: string;
    generatedText?: string;
    generatedSamples?: string[];
  }>,
): DiscriminatorPair[] {
  const pairs: DiscriminatorPair[] = [];
  for (const score of scores) {
    const real = score.expectedText?.trim();
    if (!real) continue;
    const fakes =
      score.generatedSamples && score.generatedSamples.length > 0
        ? score.generatedSamples
        : score.generatedText
          ? [score.generatedText]
          : [];
    for (const fake of fakes) {
      const trimmed = fake.trim();
      if (trimmed) pairs.push({ real, fake: trimmed });
    }
  }
  return pairs;
}

/**
 * Pairs from every evaluation run at or after `since`.
 *
 * "This persona version" is the cut: a run from before the current
 * snapshot is a different persona, and mixing the two would train on
 * somebody else.
 */
export function pairsFromEvalRuns(
  runs: Array<{ metricsJson?: unknown; createdAt?: Date | string | null }>,
  since?: Date | string | null,
): DiscriminatorPair[] {
  const sinceMs = since ? new Date(since).getTime() : Number.NaN;
  const out: DiscriminatorPair[] = [];
  for (const run of runs) {
    if (Number.isFinite(sinceMs) && run.createdAt) {
      const at = new Date(run.createdAt).getTime();
      if (Number.isFinite(at) && at < sinceMs) continue;
    }
    const metrics = run.metricsJson;
    if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) continue;
    const scores = (metrics as { scores?: unknown }).scores;
    if (!Array.isArray(scores)) continue;
    out.push(
      ...pairsFromScores(
        scores as Array<{
          expectedText?: string;
          generatedText?: string;
          generatedSamples?: string[];
        }>,
      ),
    );
  }
  return out;
}

/**
 * What the evaluation run stores: the report, without the weights.
 */
export function discriminatorForMetrics(
  report: DiscriminatorReport,
): DiscriminatorReport {
  return {
    pairs: report.pairs,
    auc: report.auc,
    aucStd: report.aucStd,
    tells: report.tells,
    insufficient: report.insufficient,
  };
}

/**
 * A dense logistic regression, the same SGD the discriminator uses.
 *
 * The A/B pairs (B8.8) train on feature differences rather than on
 * hashed n-grams, so they reuse this loop instead of the text model.
 */
export function trainLogistic(
  examples: Array<{ x: number[]; y: number }>,
  seed: string,
): { weights: number[]; bias: number } {
  if (examples.length === 0) return { weights: [], bias: 0 };
  const dim = examples[0]!.x.length;
  const weights = new Float64Array(dim);
  let bias = 0;
  for (let epoch = 0; epoch < DISCRIMINATOR_EPOCHS; epoch++) {
    const rng = seededRandom(`${seed}:epoch:${epoch}`);
    const order = examples.slice();
    shuffleInPlace(order, rng);
    for (const example of order) {
      let z = bias;
      for (let i = 0; i < dim; i++) z += weights[i]! * (example.x[i] ?? 0);
      const p = sigmoid(z);
      const err = p - example.y;
      for (let i = 0; i < dim; i++) {
        const value = example.x[i] ?? 0;
        weights[i] -= DISCRIMINATOR_LR * (err * value + DISCRIMINATOR_REG * weights[i]!);
      }
      bias -= DISCRIMINATOR_LR * err;
    }
  }
  return { weights: Array.from(weights), bias };
}

export function scoreReal(
  model: SparseModel,
  text: string,
  fingerprint: FingerprintInput,
): number {
  const dense = denseValues(text, fingerprint ?? null);
  let z = model.bias;
  for (let i = 0; i < DENSE_FEATURES.length; i++) {
    const key = DENSE_FEATURES[i]!;
    z += (model.dense[key] ?? 0) * dense[i]!;
  }
  if (model.ngrams.length === 0) return sigmoid(z);
  const counts = ngramCounts(text);
  for (const { gram, weight } of model.ngrams) {
    const n = counts.get(gram);
    if (n) z += weight * n;
  }
  return sigmoid(z);
}

function emptyModel(): SparseModel {
  return { bias: 0, dense: {}, ngrams: [] };
}

function fit(
  weights: Float64Array,
  readBias: () => number,
  writeBias: (value: number) => void,
  pairs: DiscriminatorPair[],
  indices: number[],
  fingerprint: FingerprintInput,
  seen: Map<number, string>,
  seed: string,
): void {
  const examples: Array<{ text: string; y: number }> = [];
  for (const index of indices) {
    const pair = pairs[index]!;
    examples.push({ text: pair.real, y: 1 });
    examples.push({ text: pair.fake, y: 0 });
  }
  for (let epoch = 0; epoch < DISCRIMINATOR_EPOCHS; epoch++) {
    const rng = seededRandom(`${seed}:epoch:${epoch}`);
    shuffleInPlace(examples, rng);
    for (const example of examples) {
      const vector = features(example.text, fingerprint, seen);
      const p = predictFromVector(weights, readBias(), vector);
      const err = p - example.y;
      for (const { index, value } of vector) {
        weights[index] -= DISCRIMINATOR_LR * (err * value + DISCRIMINATOR_REG * weights[index]!);
      }
      writeBias(readBias() - DISCRIMINATOR_LR * err);
    }
  }
}

function predict(
  weights: Float64Array,
  bias: number,
  text: string,
  fingerprint: FingerprintInput,
  seen: Map<number, string>,
): number {
  return predictFromVector(weights, bias, features(text, fingerprint, seen));
}

function predictFromVector(
  weights: Float64Array,
  bias: number,
  vector: Array<{ index: number; value: number }>,
): number {
  let z = bias;
  for (const { index, value } of vector) z += weights[index]! * value;
  return sigmoid(z);
}

function features(
  text: string,
  fingerprint: FingerprintInput,
  seen: Map<number, string>,
): Array<{ index: number; value: number }> {
  const out: Array<{ index: number; value: number }> = [];
  const chars = Array.from(text);
  const ngram = new Map<number, number>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) {
      const gram = chars.slice(i, i + n).join("");
      const dim = hashGram(gram);
      ngram.set(dim, (ngram.get(dim) ?? 0) + 1);
      if (!seen.has(dim)) seen.set(dim, gram);
    }
  }
  for (const [dim, value] of ngram) out.push({ index: dim, value });
  const dense = denseValues(text, fingerprint);
  for (let i = 0; i < dense.length; i++) {
    if (dense[i] === 0) continue;
    out.push({ index: NGRAM_DIM + i, value: dense[i]! });
  }
  return out;
}

function denseValues(text: string, fingerprint: FingerprintInput): number[] {
  const values = Array.from({ length: DENSE_COUNT }, () => 0);
  const set = (key: DenseFeature, value: number) => {
    values[DENSE_FEATURES.indexOf(key)] = value;
  };
  set("chars", Array.from(text).length / 20);
  set(`ending.${endingClassOf(text)}`, 1);
  set("particle", lastParticleOf(text) === "none" ? 0 : 1);
  set("haRun", maxHaRun(text) / 10);
  set("emoji", countMatches(text, EMOJI_RE) / 5);
  set("question", countMatches(text, QUESTION_RE) / 5);
  set("exclaim", countMatches(text, EXCLAIM_RE) / 5);
  set("newline", text.includes("\n") ? 1 : 0);
  set("list", LIST_RE.test(text) ? 1 : 0);
  set("surprise", fingerprint ? Math.min(lineSurprise(text, fingerprint), 8) / 8 : 0);
  return values;
}

function ngramCounts(text: string): Map<string, number> {
  const chars = Array.from(text);
  const counts = new Map<string, number>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) {
      const gram = chars.slice(i, i + n).join("");
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  return counts;
}

function sparsify(weights: Float64Array, bias: number, seen: Map<number, string>): SparseModel {
  const dense: Partial<Record<DenseFeature, number>> = {};
  for (let i = 0; i < DENSE_COUNT; i++) {
    const weight = weights[NGRAM_DIM + i] ?? 0;
    if (weight !== 0) dense[DENSE_FEATURES[i]!] = weight;
  }
  const ranked: Array<{ gram: string; weight: number }> = [];
  for (const [dim, gram] of seen) {
    const weight = weights[dim] ?? 0;
    if (weight === 0) continue;
    ranked.push({ gram, weight });
  }
  ranked.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    bias,
    dense,
    ngrams: ranked.slice(0, DISCRIMINATOR_TOP_NGRAMS),
  };
}

function tellsOf(model: SparseModel): DiscriminatorTell[] {
  const merged = new Map<string, number>();
  const add = (feature: string, weight: number) => {
    merged.set(feature, (merged.get(feature) ?? 0) + weight);
  };
  for (const key of DENSE_FEATURES) {
    const weight = model.dense[key];
    if (weight) add(key, weight);
  }
  for (const { gram, weight } of model.ngrams) {
    add(periodGramAsEnding(gram), weight);
  }
  return [...merged.entries()]
    .map(([feature, weight]) => ({
      feature,
      weight,
      side: (weight < 0 ? "persona" : "real") as "persona" | "real",
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, DISCRIMINATOR_TELLS);
}

/**
 * A lone period n-gram is the same tell as the ending-class one-hot.
 *
 * The handbook's check looks for the named ending, not the hashed
 * character, so the two are reported as one feature.
 */
function periodGramAsEnding(gram: string): string {
  if (PERIOD_CHARS.has(gram)) return "ending.period";
  return gram;
}

function maxHaRun(text: string): number {
  let max = 0;
  let run = 0;
  for (const char of Array.from(text)) {
    if (char === HA_CHAR) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max >= 2 ? max : 0;
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return (text.match(global) ?? []).length;
}

function hashGram(gram: string): number {
  let hash = 2166136261;
  for (let i = 0; i < gram.length; i++) {
    hash ^= gram.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 & (NGRAM_DIM - 1);
}

function aucRank(realScores: number[], fakeScores: number[]): number {
  const n = realScores.length * fakeScores.length;
  if (n === 0) return 0.5;
  let wins = 0;
  for (const real of realScores) {
    for (const fake of fakeScores) {
      if (real > fake) wins += 1;
      else if (real === fake) wins += 0.5;
    }
  }
  return wins / n;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

function rangeWhere(values: number[], pred: (value: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (pred(values[i]!)) out.push(i);
  }
  return out;
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdOf(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const sum = values.reduce((acc, value) => acc + (value - mean) ** 2, 0);
  return Math.sqrt(sum / (values.length - 1));
}
