/**
 * Past replies of theirs, retrieved by how the other person had just
 * spoken — not by a fact in a memory.
 *
 * The first scorer is character bigrams (the same tokens memory
 * retrieval already uses). An embedding is a second implementation
 * behind the same function, so a packed build does not need another
 * model, and swapping the scorer later does not change the caller.
 */
import { copy, type Locale } from "@shared/copy";
import { keywordCoverage, tokenize } from "./retrieval";

export const EXEMPLAR_MIN_SCORE = 0.08;
export const EXEMPLAR_MAX = 4;

export interface CollectedReply {
  id: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
}

export interface Exemplar {
  id: number;
  content: string;
  score: number;
  previousUser: string;
}

export type ExemplarScoreFn = (queryTokens: Set<string>, previousUser: string) => number;

export function bigramScore(queryTokens: Set<string>, previousUser: string): number {
  return keywordCoverage(previousUser, queryTokens);
}

function medianLength(texts: string[]): number {
  const lengths = texts.map((text) => text.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  if (!lengths.length) return 80;
  return lengths[Math.floor(lengths.length / 2)];
}

export function truncateExemplar(text: string, medianChars: number): string {
  const ceiling = Math.max(1, Math.round(medianChars * 1.5));
  const trimmed = text.trim();
  if (trimmed.length <= ceiling) return trimmed;
  return trimmed.slice(0, ceiling);
}

/**
 * Their replies whose preceding user line is closest to this one.
 *
 * A held-out id is excluded so evaluation cannot retrieve the answer.
 * Below the floor, nothing is returned — four unrelated lines would
 * be worse than none.
 */
export function retrieveExemplars(params: {
  userMessage: string;
  records: CollectedReply[];
  excludeIds?: Iterable<number>;
  excludeTexts?: Iterable<string>;
  score?: ExemplarScoreFn;
  minScore?: number;
  limit?: number;
}): Exemplar[] {
  const query = params.userMessage.trim();
  if (!query) return [];
  const queryTokens = tokenize(query);
  if (!queryTokens.size) return [];
  const score = params.score ?? bigramScore;
  const minScore = params.minScore ?? EXEMPLAR_MIN_SCORE;
  const limit = params.limit ?? EXEMPLAR_MAX;
  const excludedIds = new Set(params.excludeIds ?? []);
  const excludedTexts = new Set(
    [...(params.excludeTexts ?? [])].map((text) => text.trim()).filter(Boolean),
  );

  const median = medianLength(
    params.records.filter((row) => row.role === "assistant").map((row) => row.content),
  );

  const scored: Exemplar[] = [];
  for (let i = 0; i < params.records.length; i++) {
    const row = params.records[i];
    if (row.role !== "assistant") continue;
    if (excludedIds.has(row.id)) continue;
    const content = row.content.trim();
    if (!content || excludedTexts.has(content)) continue;
    let previousUser = "";
    for (let j = i - 1; j >= 0; j--) {
      if (params.records[j].role === "user" && params.records[j].content.trim()) {
        previousUser = params.records[j].content.trim();
        break;
      }
    }
    if (!previousUser) continue;
    const value = score(queryTokens, previousUser);
    if (value < minScore) continue;
    scored.push({
      id: row.id,
      content: truncateExemplar(content, median),
      score: value,
      previousUser,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const unique: Exemplar[] = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (seen.has(item.content)) continue;
    seen.add(item.content);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function renderExemplars(exemplars: Exemplar[], locale: Locale = "zh"): string {
  if (!exemplars.length) return "";
  const lines = exemplars.map((item) => `- ${item.content}`);
  return [copy(locale, "prompt.exemplarsHeading"), copy(locale, "prompt.exemplarsIntro"), ...lines].join(
    "\n",
  );
}
