/**
 * Mining the private lexicon by counting, then asking which counts are theirs.
 *
 * Everyday n-grams are dropped against a built-in list. The model only
 * sees the remainder, and it may only tag terms that were on that list.
 */
import { extractJsonArray } from "../_core/json";
import { asMaterial } from "../_core/material";
import { llmService } from "../llm";
import type { LLMMessage } from "../llm/types";
import { resolveProviderForUser } from "../llm/user-provider";
import { copy, type Locale } from "@shared/copy";
import {
  collectLexiconCandidates,
  lexiconWho,
  normalizeLexicon,
  type LexiconCandidate,
  type LexiconEntry,
  type LexiconRow,
} from "@shared/lexicon";
import * as db from "../db";

export interface MineLexiconParams {
  personaId: number;
  userId: number;
  locale?: Locale;
  records?: LexiconRow[];
  invoke?: (messages: LLMMessage[]) => Promise<string>;
  providerName?: string;
}

function dbFn(name: string): ((...args: never[]) => unknown) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (...args: never[]) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

function idFor(term: string): string {
  let hash = 0;
  for (let i = 0; i < term.length; i++) {
    hash = (hash * 31 + term.charCodeAt(i)) | 0;
  }
  return `auto-lexicon-${Math.abs(hash).toString(36)}`;
}

async function loadRows(personaId: number, userId: number): Promise<LexiconRow[]> {
  const iterate = dbFn("iterateRecords") as
    | ((personaId: number, userId: number) => AsyncIterable<LexiconRow>)
    | undefined;
  if (iterate) {
    const rows: LexiconRow[] = [];
    try {
      for await (const row of iterate(personaId, userId)) rows.push(row);
      if (rows.length) return rows;
    } catch {
      // Fall through to the collected-message helper used by the other miners.
    }
  }
  const collected = dbFn("getCollectedMessagesForPersona") as
    | ((personaId: number, userId: number, options?: { newest?: boolean }) => Promise<LexiconRow[]>)
    | undefined;
  if (!collected) return [];
  try {
    return await collected(personaId, userId, { newest: true });
  } catch {
    return [];
  }
}

function materialFor(candidates: LexiconCandidate[]): string {
  return JSON.stringify(
    candidates.map((row) => ({
      term: row.term,
      count: row.count,
      // Two lines per word, as the manual asks; the stored entry keeps
      // three, but the material sent to the model does not need them.
      examples: row.examples.slice(0, 2).map((item) => item.snippet),
    })),
    null,
    2,
  );
}

function parseTagged(raw: string, allowed: Set<string>): Array<{ term: string; gloss: string }> {
  const parsed = extractJsonArray(raw) ?? [];
  const out: Array<{ term: string; gloss: string }> = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const term = typeof record.term === "string" ? record.term.trim() : "";
    if (!term || !allowed.has(term) || seen.has(term)) continue;
    seen.add(term);
    const gloss = typeof record.gloss === "string" ? record.gloss.trim().slice(0, 20) : "";
    out.push({ term, gloss });
  }
  return out;
}

function toEntry(candidate: LexiconCandidate, gloss: string): LexiconEntry {
  const evidence = candidate.examples.slice(0, 3);
  const entry: LexiconEntry = {
    id: idFor(candidate.term),
    term: candidate.term,
    gloss,
    who: lexiconWho(candidate),
    count: candidate.count,
    evidence,
    source: "auto",
    verified: false,
  };
  if (candidate.firstAt) entry.firstAt = candidate.firstAt;
  return entry;
}

/**
 * Count, drop everyday language, ask which of the remainder are private.
 */
export async function mineLexicon(params: MineLexiconParams): Promise<LexiconEntry[]> {
  const locale = params.locale ?? "zh";
  const rows = params.records ?? (await loadRows(params.personaId, params.userId));
  const candidates = collectLexiconCandidates(rows);
  if (!candidates.length) return [];

  let answer = "";
  const messages: LLMMessage[] = [
    { role: "system", content: copy(locale, "prompts.distill.lexiconFilter") },
    {
      role: "user",
      content: asMaterial(materialFor(candidates), locale),
    },
  ];
  try {
    if (params.invoke) {
      answer = await params.invoke(messages);
    } else {
      const provider = await resolveProviderForUser({
        userId: params.userId,
        providerName: params.providerName,
      });
      if (!provider) return [];
      answer = await llmService.invokeWithProvider(provider, {
        usage: { userId: params.userId, personaId: params.personaId ?? null },
        messages,
        options: { temperature: 0.2, maxTokens: 1500, purpose: "distill" },
      });
    }
  } catch (error) {
    console.warn("[Lexicon] The model could not be reached; no words were mined:", error);
    return [];
  }

  const allowed = new Set(candidates.map((row) => row.term));
  const tagged = parseTagged(answer ?? "", allowed);
  const byTerm = new Map(candidates.map((row) => [row.term, row]));
  const out: LexiconEntry[] = [];
  for (const item of tagged) {
    const candidate = byTerm.get(item.term);
    if (!candidate) continue;
    out.push(toEntry(candidate, item.gloss));
  }
  return normalizeLexicon(out);
}
