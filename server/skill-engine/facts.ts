/**
 * The fact pass: hashed blocks become memories, people, and stances
 * that cite a line in the record.
 *
 * The old path only sent the first fifty lines of the upload. A long
 * history's birthday, the people in it, and what they liked never
 * reached the memory table.
 */
import { extractJsonObject } from "../_core/json";
import { copy, type Locale } from "@shared/copy";
import { getDistillationPreset, type DistillationMode } from "@shared/distillation-modes";
import { chunkHasFactCue } from "@shared/fact-cues";
import { isMemoryDate } from "@shared/memory-date";
import { factKeyFromTitle, normalizeMemoryTitle } from "../chat/memory-extract";
import { sanitizeEntities, type MemoryEntities } from "@shared/memory-entities";
import { keywordCoverage, tokenize } from "../chat/retrieval";
import type { LLMMessage } from "../llm/types";
import { renderChunkForModel, type RecordChunk, type RecordLine } from "./chunks";
import * as db from "../db";

export const FACT_CATEGORIES = ["anchor", "milestone", "anniversary", "memory"] as const;
export const FACT_SUBJECTS = ["them", "me"] as const;
export const PERSON_SIDES = ["them", "me", "both"] as const;
export const STANCE_POLARITIES = ["like", "dislike", "fear", "care", "opinion"] as const;

export const MAX_FACTS_PER_RUN = 1000;
const FACT_CONCURRENCY = 3;
const MENTION_COVERAGE = 0.5;

export type FactCategory = (typeof FACT_CATEGORIES)[number];
export type FactSubject = (typeof FACT_SUBJECTS)[number];
export type PersonSide = (typeof PERSON_SIDES)[number];
export type StancePolarity = (typeof STANCE_POLARITIES)[number];

export interface ParsedFact {
  title: string;
  description: string;
  category: FactCategory;
  subject: FactSubject;
  date: string | null;
  quote: number;
  chunkHash: string;
  periodId: string | null;
  entities: MemoryEntities;
}

export interface ParsedPerson {
  name: string;
  relation: string;
  side: PersonSide;
  quote: number;
  chunkHash: string;
  periodId: string | null;
}

export interface ParsedStance {
  topic: string;
  polarity: StancePolarity;
  statement: string;
  quote: number;
  chunkHash: string;
  periodId: string | null;
}

export interface ParsedFactCards {
  facts: ParsedFact[];
  people: ParsedPerson[];
  stances: ParsedStance[];
}

function dbFn(name: string): ((...args: never[]) => unknown) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (...args: never[]) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

function inSet<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function quoteId(value: unknown, inChunk: Set<number>): number | null {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(id) || !inChunk.has(id)) return null;
  return id;
}

function cleanDate(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "null") return null;
  return isMemoryDate(text) ? text : null;
}

export function parseFactCards(
  raw: string | null | undefined,
  chunk: RecordChunk,
): ParsedFactCards {
  const parsed = extractJsonObject(raw);
  const inChunk = new Set(chunk.rows.map((row) => row.id));
  const facts: ParsedFact[] = [];
  const people: ParsedPerson[] = [];
  const stances: ParsedStance[] = [];
  if (!parsed) return { facts, people, stances };

  const factRows = Array.isArray(parsed.facts) ? parsed.facts : [];
  for (const item of factRows) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? "").trim().slice(0, 200);
    if (!title) continue;
    const category = inSet(record.category, FACT_CATEGORIES);
    const subject = inSet(record.subject, FACT_SUBJECTS);
    const quote = quoteId(record.quote, inChunk);
    if (!category || !subject || quote == null) continue;
    const cited = chunk.rows.find((row) => row.id === quote);
    facts.push({
      title,
      description: String(record.description ?? "").trim(),
      category,
      subject,
      date: cleanDate(record.date),
      quote,
      chunkHash: chunk.hash,
      periodId: chunk.periodId,
      entities: sanitizeEntities(record.entities, cited?.content ?? ""),
    });
  }

  const personRows = Array.isArray(parsed.people) ? parsed.people : [];
  for (const item of personRows) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = String(record.name ?? "").trim().slice(0, 80);
    const quote = quoteId(record.quote, inChunk);
    const side = inSet(record.side, PERSON_SIDES);
    if (!name || quote == null || !side) continue;
    people.push({
      name,
      relation: String(record.relation ?? "").trim().slice(0, 80),
      side,
      quote,
      chunkHash: chunk.hash,
      periodId: chunk.periodId,
    });
  }

  const stanceRows = Array.isArray(parsed.stances) ? parsed.stances : [];
  for (const item of stanceRows) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = String(record.topic ?? "").trim().slice(0, 80);
    const statement = String(record.statement ?? "").trim().slice(0, 240);
    const polarity = inSet(record.polarity, STANCE_POLARITIES);
    const quote = quoteId(record.quote, inChunk);
    if (!topic || !statement || !polarity || quote == null) continue;
    stances.push({
      topic,
      polarity,
      statement,
      quote,
      chunkHash: chunk.hash,
      periodId: chunk.periodId,
    });
  }

  return { facts, people, stances };
}

/**
 * Which blocks the fact pass will actually send.
 *
 * Deep mode reads them all. Every other preset — including the public
 * figure flow, whose map stage reads every block — only sends a block
 * that already looks like it holds a date, a person, a like or a place.
 */
export function chunksForFactExtraction(
  chunks: RecordChunk[],
  mode?: DistillationMode | null,
): RecordChunk[] {
  if (getDistillationPreset(mode).id === "deep") return chunks;
  return chunks.filter(chunkHasFactCue);
}

function importanceFor(category: FactCategory): number {
  if (category === "anchor") return 5;
  if (category === "milestone") return 3;
  return 1;
}

function sameContent(
  a: { title: string; description?: string | null },
  b: { title: string; description?: string | null },
): boolean {
  return (
    normalizeMemoryTitle(a.title) === normalizeMemoryTitle(b.title)
    && (a.description ?? "").trim() === (b.description ?? "").trim()
  );
}

/**
 * A stable identity for a card, so a re-run does not write it again.
 *
 * Observation cards are reused by block hash; the people and stance
 * cards are written by the fact pass, which runs every time. Without
 * this key the same person gained one more card per re-run, and the
 * stance evidence count grew with it.
 */
function cardKey(row: {
  kind?: string | null;
  chunkHash?: string | null;
  claim?: string | null;
  payload?: unknown;
}): string {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const quote = payload.quote ?? payload.quotes ?? "";
  return [row.kind ?? "", row.chunkHash ?? "", row.claim ?? "", JSON.stringify(quote)].join("|");
}

function mentionCountFor(title: string, rows: RecordLine[]): number {
  const titleTokens = tokenize(title);
  let count = 0;
  for (const row of rows) {
    /**
     * `keywordCoverage(memoryText, messageTokens)` divides by the
     * message's tokens. The "memory" here is the title and the
     * "message" is the line, so the arguments go line-first —
     * the other order divides by the line's length and a normal
     * sentence almost never reaches 0.5.
     */
    if (keywordCoverage(row.content, titleTokens) >= MENTION_COVERAGE) count += 1;
  }
  return count;
}

async function invokeOnce(
  invoke: (messages: LLMMessage[]) => Promise<string>,
  messages: LLMMessage[],
): Promise<string> {
  try {
    return await invoke(messages);
  } catch {
    return invoke(messages);
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface ExtractFactsInput {
  chunks: RecordChunk[];
  rows: RecordLine[];
  personaId: number;
  userId: number;
  name: string;
  locale?: Locale;
  timeZone?: string | null;
  themName?: string;
  mode?: DistillationMode | null;
  invoke: (messages: LLMMessage[]) => Promise<string>;
  onProgress?: (message: string) => void;
}

export interface ExtractFactsResult {
  created: number;
  truncated: boolean;
  facts: ParsedFact[];
  people: ParsedPerson[];
  stances: ParsedStance[];
}

/**
 * Reads the selected blocks, stores the facts that cite them, and
 * writes people and stances as cards for later aggregation.
 */
export async function extractFactsFromRecords(
  input: ExtractFactsInput,
): Promise<ExtractFactsResult> {
  const locale = input.locale ?? "zh";
  const selected = chunksForFactExtraction(input.chunks, input.mode);
  const empty: ExtractFactsResult = {
    created: 0,
    truncated: false,
    facts: [],
    people: [],
    stances: [],
  };
  if (selected.length === 0) return empty;

  let completed = 0;
  const collected: ParsedFactCards = { facts: [], people: [], stances: [] };
  await mapPool(selected, FACT_CONCURRENCY, async (chunk) => {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: copy(locale, "prompts.distill.factCard", { name: input.name }),
      },
      {
        role: "user",
        content: renderChunkForModel(chunk, {
          locale,
          timeZone: input.timeZone,
          themName: input.themName ?? input.name,
        }),
      },
    ];
    try {
      const raw = await invokeOnce(input.invoke, messages);
      const parsed = parseFactCards(raw, chunk);
      collected.facts.push(...parsed.facts);
      collected.people.push(...parsed.people);
      collected.stances.push(...parsed.stances);
    } catch {
      // A block that still fails after a retry is skipped. The rest of
      // the facts are still worth keeping.
    } finally {
      completed += 1;
      input.onProgress?.(
        copy(locale, "distill.readingFacts", { done: completed, total: selected.length }),
      );
    }
  });

  const ranked = [...collected.facts].sort((a, b) => {
    const importance = importanceFor(b.category) - importanceFor(a.category);
    if (importance !== 0) return importance;
    return b.quote - a.quote;
  });
  const truncated = ranked.length > MAX_FACTS_PER_RUN;
  const kept = ranked.slice(0, MAX_FACTS_PER_RUN);
  if (truncated) {
    input.onProgress?.(
      copy(locale, "distill.factsTruncated", { kept: kept.length }),
    );
  }

  const listExisting = dbFn("getMemoriesByPersonaId");
  let existing: Array<{ title: string; description?: string | null; factKey?: string | null }> = [];
  if (typeof listExisting === "function") {
    try {
      const rows = await listExisting(input.personaId as never, input.userId as never);
      if (Array.isArray(rows)) existing = rows as typeof existing;
    } catch {
      existing = [];
    }
  }

  const createMemory = dbFn("createMemory");
  let created = 0;
  const seen = [...existing];
  for (const fact of kept) {
    const factKey = factKeyFromTitle(fact.title);
    const duplicate = seen.some(
      (row) => (row.factKey ?? factKeyFromTitle(row.title)) === factKey && sameContent(row, fact),
    );
    if (duplicate) continue;
    if (typeof createMemory === "function") {
      try {
        await createMemory({
          personaId: input.personaId,
          userId: input.userId,
          title: fact.title,
          description: fact.description || fact.title,
          category: fact.category,
          subject: fact.subject,
          date: fact.date,
          importance: importanceFor(fact.category),
          recordId: fact.quote,
          source: "records",
          mentionCount: mentionCountFor(fact.title, input.rows),
          factKey,
          status: "active",
          entities: fact.entities,
        } as never);
        created += 1;
        seen.push({ title: fact.title, description: fact.description, factKey });
      } catch {
        // A single write must not stop the rest of the facts.
      }
    }
  }

  const saveCard = dbFn("createDistillationCard");
  if (typeof saveCard === "function") {
    const listCards = dbFn("listDistillationCards") as
      | ((
          personaId: number,
          userId: number,
          options?: { kind?: string },
        ) => Promise<Array<{
          kind?: string | null;
          chunkHash?: string | null;
          claim?: string | null;
          payload?: unknown;
        }>>)
      | undefined;
    const existingCards = new Set<string>();
    if (typeof listCards === "function") {
      try {
        const rows = await listCards(input.personaId, input.userId);
        for (const row of rows) existingCards.add(cardKey(row));
      } catch {
        // A read that fails only means the dedupe is not available.
      }
    }
    for (const person of collected.people) {
      const row = {
        userId: input.userId,
        personaId: input.personaId,
        chunkHash: person.chunkHash,
        periodId: person.periodId,
        kind: "person",
        dimension: person.side,
        claim: person.name,
        payload: {
          relation: person.relation,
          side: person.side,
          quote: person.quote,
        },
      };
      const key = cardKey(row);
      if (existingCards.has(key)) continue;
      try {
        await saveCard(row as never);
        existingCards.add(key);
      } catch {
        // skip
      }
    }
    for (const stance of collected.stances) {
      const row = {
        userId: input.userId,
        personaId: input.personaId,
        chunkHash: stance.chunkHash,
        periodId: stance.periodId,
        kind: "stance",
        dimension: stance.polarity,
        claim: stance.statement,
        payload: {
          topic: stance.topic,
          polarity: stance.polarity,
          quote: stance.quote,
        },
      };
      const key = cardKey(row);
      if (existingCards.has(key)) continue;
      try {
        await saveCard(row as never);
        existingCards.add(key);
      } catch {
        // skip
      }
    }
  }

  return {
    created,
    truncated,
    facts: kept,
    people: collected.people,
    stances: collected.stances,
  };
}
