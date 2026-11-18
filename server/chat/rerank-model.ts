/**
 * The n-gram model four-way rerank is scored against.
 *
 * The last 80 collected rows used to be enough, and an empty list still
 * called the model four times. Forty of their own text lines is the
 * floor; more than five thousand is wasted. The cache key is the
 * records version, so an import rebuilds and a second turn does not.
 */
import { isTextRecord } from "@shared/records";
import { RERANK_MIN_ASSISTANT_LINES } from "@shared/eval-limits";
import { getRecordsVersion, iterateRecords } from "../db";
import { buildCharNgramModel, type CharNgramModel } from "../eval/metrics";

export const RERANK_TEXT_CAP = 5000;
export const RERANK_CACHE_CAP = 8;

export function lengthNormalisedLogProb(model: CharNgramModel, text: string): number {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean.length) return Number.NEGATIVE_INFINITY;
  return model.logProb(clean) / clean.length;
}

export interface RerankModel {
  texts: string[];
  ngram: CharNgramModel;
  llMedian: number;
  llIqr: number;
  lengthMedian: number;
  lengthP90: number;
  lengths: number[];
}

interface CacheEntry {
  key: string;
  model: RerankModel | null;
  used: number;
}

const cache: CacheEntry[] = [];
let clock = 0;

export function clearRerankModelCache(): void {
  cache.length = 0;
  clock = 0;
}

export function buildRerankModel(texts: string[]): RerankModel | null {
  const clean = texts.map((text) => text.trim()).filter(Boolean);
  if (clean.length < RERANK_MIN_ASSISTANT_LINES) return null;
  const ngram = buildCharNgramModel(clean);
  const ll = clean
    .map((text) => lengthNormalisedLogProb(ngram, text))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const lengths = clean.map((text) => Array.from(text).length).sort((a, b) => a - b);
  return {
    texts: clean,
    ngram,
    llMedian: quantile(ll, 0.5),
    llIqr: Math.max(0, quantile(ll, 0.75) - quantile(ll, 0.25)),
    lengthMedian: quantile(lengths, 0.5),
    lengthP90: quantile(lengths, 0.9),
    lengths,
  };
}

export async function getRerankModel(
  personaId: number,
  userId: number,
): Promise<RerankModel | null> {
  let version = "0:0";
  try {
    version = await getRecordsVersion(personaId, userId);
  } catch {
    version = "0:0";
  }
  const key = `${personaId}:${version}`;
  const hit = cache.find((entry) => entry.key === key);
  if (hit) {
    hit.used = ++clock;
    return hit.model;
  }
  const model = buildRerankModel(await collectRecentTexts(personaId, userId));
  remember(key, model);
  return model;
}

async function collectRecentTexts(personaId: number, userId: number): Promise<string[]> {
  const ring: string[] = [];
  let offset = 0;
  try {
    for await (const row of iterateRecords(personaId, userId, {
      role: "assistant",
      kinds: ["text"],
    })) {
      if (!isTextRecord(row)) continue;
      const text = String(row.content ?? "").trim();
      if (!text) continue;
      if (ring.length < RERANK_TEXT_CAP) {
        ring.push(text);
      } else {
        ring[offset] = text;
        offset = (offset + 1) % RERANK_TEXT_CAP;
      }
    }
  } catch {
    return [];
  }
  if (ring.length < RERANK_TEXT_CAP) return ring;
  return [...ring.slice(offset), ...ring.slice(0, offset)];
}

function remember(key: string, model: RerankModel | null): void {
  cache.push({ key, model, used: ++clock });
  while (cache.length > RERANK_CACHE_CAP) {
    let oldest = 0;
    for (let i = 1; i < cache.length; i++) {
      if (cache[i]!.used < cache[oldest]!.used) oldest = i;
    }
    cache.splice(oldest, 1);
  }
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx] ?? 0;
}
