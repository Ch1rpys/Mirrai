/**
 * "Did they ever say this?" (C2.3)
 *
 * The chat is rebuilt from a model, so a line the replica writes is not
 * a line the person ever said. This finds the closest real lines, and
 * says which of three things is true: exactly said, said something
 * similar, or nothing in the record.
 *
 * It reads the record, never a model. The similar candidates come from
 * the character-bigram index and, when the local embedding model is
 * running, from the embeddings too.
 */
import { charBigrams } from "@shared/act-clusters";
import * as db from "../db";

export type NearestVerdict = "verbatim" | "similar" | "none";

export interface NearestMatch {
  id: number;
  content: string;
  at: string | null;
}

export interface NearestSentence {
  text: string;
  verdict: NearestVerdict;
  matches: NearestMatch[];
}

/** Splits an input into the sentences the verdict is given per. */
export function splitSentences(text: string): string[] {
  return text
    /**
     * English full stops are sentence ends too. The lookahead needs a
     * following space so decimals and "3.5" stay in one sentence.
     */
    .split(/(?<=[。！？!?；;…\n])|(?<=\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The comparison form: no spaces, no punctuation, lower case.
 *
 * "好啦，不生气了。" and "好啦 不气了" are compared on what is left
 * after this, and the difference is the words, not the punctuation.
 */
export function normalizeForNearest(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** Character-bigram Jaccard, the same tokens the rest of the app uses. */
export function bigramJaccard(left: string, right: string): number {
  const a = charBigrams(left);
  const b = charBigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function toMatches(
  rows: Array<{ id: number; content: string; timestamp: Date | null }>,
  limit = 3,
): NearestMatch[] {
  return rows.slice(0, limit).map((row) => ({
    id: row.id,
    content: row.content,
    at: row.timestamp?.toISOString() ?? null,
  }));
}

export async function findNearest(params: {
  personaId: number;
  userId: number;
  text: string;
}): Promise<NearestSentence[]> {
  const sentences = splitSentences(params.text);
  const out: NearestSentence[] = [];
  for (const sentence of sentences) {
    const normalized = normalizeForNearest(sentence);
    if (!normalized) continue;
    const candidates = await db.candidateRecordsByOverlap(params.personaId, params.userId, {
      text: sentence,
      role: "assistant",
      limit: 200,
    });

    // 1. Exactly this line — or, from four characters up, this line
    //    inside one of theirs ("好" must not count as said just because
    //    some other line contains it).
    let verbatim = candidates.filter(
      (row) => normalizeForNearest(row.content) === normalized,
    );
    if (verbatim.length === 0 && [...normalized].length >= 4) {
      verbatim = candidates.filter((row) =>
        normalizeForNearest(row.content).includes(normalized),
      );
    }
    if (verbatim.length > 0) {
      out.push({
        text: sentence,
        verdict: "verbatim",
        matches: toMatches(
          [...verbatim].sort(
            (a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0),
          ),
        ),
      });
      continue;
    }

    // 2. A similar line: overlapping word pairs, or a close embedding.
    const scored = candidates
      .map((row) => ({ row, score: bigramJaccard(normalized, normalizeForNearest(row.content)) }))
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    const semantic = await db.searchRecordsSemantic(params.personaId, params.userId, {
      q: sentence,
      role: "assistant",
      k: 10,
    });
    const byId = new Map(scored.map((item) => [item.row.id, item.row]));
    for (const hit of semantic?.hits ?? []) {
      if (hit.score < 0.8 || byId.has(hit.id)) continue;
      const row = {
        id: hit.id,
        content: hit.content,
        timestamp: hit.timestamp,
        role: hit.role,
        speaker: hit.speaker,
        coverage: 1,
      };
      byId.set(hit.id, row);
      scored.push({ row, score: hit.score });
    }
    if (scored.length > 0) {
      out.push({
        text: sentence,
        verdict: "similar",
        matches: toMatches(scored.map((item) => item.row)),
      });
    } else {
      out.push({ text: sentence, verdict: "none", matches: [] });
    }
  }
  return out;
}
