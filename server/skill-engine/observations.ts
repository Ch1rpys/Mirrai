/**
 * The map stage: one model call per hashed block, producing observation
 * cards that cite lines from that block and nothing else.
 */
import { extractJsonObject } from "../_core/json";
import { copy, type Locale } from "@shared/copy";
import { getDistillationPreset, type DistillationMode } from "@shared/distillation-modes";
import type { LLMMessage } from "../llm/types";
import {
  distillChunkSeed,
  renderChunkForModel,
  takeChunkBudget,
  type RecordChunk,
  type RecordLine,
} from "./chunks";
import * as db from "../db";

export const OBSERVATION_DIMENSIONS = [
  "expression",
  "trigger",
  "conflict",
  "care",
  "memory",
  "habit",
] as const;

export type ObservationDimension = (typeof OBSERVATION_DIMENSIONS)[number];

const DIMENSION_SET = new Set<string>(OBSERVATION_DIMENSIONS);
const MAX_OBSERVATIONS = 8;
const MAX_CLAIM_CHARS = 120;
const MAP_CONCURRENCY = 3;
const FAIL_RATIO = 0.3;

export interface ObservationCard {
  dimension: ObservationDimension;
  claim: string;
  quotes: number[];
  chunkHash: string;
  periodId: string | null;
}

export class DistillationMapFailed extends Error {
  readonly failed: number;
  readonly total: number;

  constructor(failed: number, total: number, message: string) {
    super(message);
    this.name = "DistillationMapFailed";
    this.failed = failed;
    this.total = total;
  }
}

export interface ObservationStore {
  saveChunk: (row: {
    userId: number;
    personaId: number;
    chunkHash: string;
    phase: string;
    cardCount: number;
  }) => Promise<unknown>;
  saveCard: (row: {
    userId: number;
    personaId: number;
    chunkHash: string;
    periodId: string | null;
    kind: string;
    dimension: string;
    claim: string;
    payload: { quotes: number[] };
  }) => Promise<unknown>;
}

function dbFn(name: string): ((row: never) => Promise<unknown>) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (row: never) => Promise<unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const defaultStore: ObservationStore = {
  saveChunk: async (row) => {
    await dbFn("createDistillationChunk")?.(row as never);
  },
  saveCard: async (row) => {
    await dbFn("createDistillationCard")?.(row as never);
  },
};

function isDimension(value: unknown): value is ObservationDimension {
  return typeof value === "string" && DIMENSION_SET.has(value);
}

function quoteIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    const id = typeof item === "number" ? item : Number(item);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

/**
 * Keeps only the observations that cite lines in this block.
 *
 * The model is not trusted: a quote that is not in the block, a
 * dimension outside the closed set, or an expression/habit card that
 * only cites the user, is dropped.
 */
export function parseObservationCards(
  raw: string | null | undefined,
  chunk: RecordChunk,
): ObservationCard[] {
  const parsed = extractJsonObject(raw);
  const rows = parsed && Array.isArray(parsed.observations) ? parsed.observations : [];
  const inChunk = new Map<number, RecordLine>();
  for (const row of chunk.rows) inChunk.set(row.id, row);
  const out: ObservationCard[] = [];
  for (const item of rows) {
    if (out.length >= MAX_OBSERVATIONS) break;
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (!isDimension(record.dimension)) continue;
    const quotes = quoteIds(record.quotes).filter((id) => inChunk.has(id));
    if (quotes.length === 0) continue;
    if (record.dimension === "expression" || record.dimension === "habit") {
      const citesThem = quotes.some((id) => inChunk.get(id)?.role === "assistant");
      if (!citesThem) continue;
    }
    const claim = String(record.claim ?? "").trim().slice(0, MAX_CLAIM_CHARS);
    if (!claim) continue;
    out.push({
      dimension: record.dimension,
      claim,
      quotes,
      chunkHash: chunk.hash,
      periodId: chunk.periodId,
    });
  }
  return out;
}

export interface MapObservationsInput {
  chunks: RecordChunk[];
  personaId: number;
  userId: number;
  name: string;
  locale?: Locale;
  timeZone?: string | null;
  meName?: string;
  themName?: string;
  mode?: DistillationMode | null;
  invoke: (messages: LLMMessage[]) => Promise<string>;
  onProgress?: (message: string, done: number, total: number) => void;
  store?: ObservationStore;
  concurrency?: number;
}

async function invokeOnce(
  invoke: MapObservationsInput["invoke"],
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

/**
 * Runs the map stage: one call per selected block, then stores every
 * block (even those that produced no card).
 */
export async function mapObservationCards(
  input: MapObservationsInput,
): Promise<ObservationCard[]> {
  const locale = input.locale ?? "zh";
  const preset = getDistillationPreset(input.mode);
  const selected = takeChunkBudget(
    input.chunks,
    preset.chunkBudget,
    distillChunkSeed(input.personaId, input.chunks.length),
  );
  const store = input.store ?? defaultStore;
  const total = selected.length;
  if (total === 0) return [];

  let completed = 0;
  let failed = 0;
  const cards: ObservationCard[] = [];

  const results = await mapPool(
    selected,
    input.concurrency ?? MAP_CONCURRENCY,
    async (chunk) => {
      const messages: LLMMessage[] = [
        {
          role: "system",
          content: copy(locale, "prompts.distill.observationCard", { name: input.name }),
        },
        {
          role: "user",
          content: renderChunkForModel(chunk, {
            locale,
            timeZone: input.timeZone,
            meName: input.meName,
            themName: input.themName ?? input.name,
          }),
        },
      ];
      try {
        const raw = await invokeOnce(input.invoke, messages);
        return { chunk, cards: parseObservationCards(raw, chunk), ok: true as const };
      } catch {
        return { chunk, cards: [] as ObservationCard[], ok: false as const };
      } finally {
        completed += 1;
        input.onProgress?.(
          copy(locale, "distill.readingChunk", { done: completed, total }),
          completed,
          total,
        );
      }
    },
  );

  for (const result of results) {
    if (!result.ok) failed += 1;
    else cards.push(...result.cards);
  }

  if (total > 0 && failed / total > FAIL_RATIO) {
    throw new DistillationMapFailed(
      failed,
      total,
      copy(locale, "distill.tooManyChunkFailures", { failed, total }),
    );
  }

  for (const result of results) {
    if (!result.ok) continue;
    await store.saveChunk({
      userId: input.userId,
      personaId: input.personaId,
      chunkHash: result.chunk.hash,
      phase: "observation",
      cardCount: result.cards.length,
    });
    for (const card of result.cards) {
      await store.saveCard({
        userId: input.userId,
        personaId: input.personaId,
        chunkHash: card.chunkHash,
        periodId: card.periodId,
        kind: "observation",
        dimension: card.dimension,
        claim: card.claim,
        payload: { quotes: card.quotes },
      });
    }
  }

  return cards;
}
