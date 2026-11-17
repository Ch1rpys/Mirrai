/**
 * The reduce stage: observation cards of one period become the
 * four-section analysis the builder already knows how to read.
 */
import { asMaterial } from "./material";
import { copy, type Locale } from "@shared/copy";
import { zonedDateKey } from "@shared/timezone";
import type { LLMMessage } from "../llm/types";
import type { ObservationCard } from "./observations";
import type { RecordChunk, RecordLine } from "./chunks";

export const CARDS_PER_CALL = 60;

export interface ReduceObservationsInput {
  cards: ObservationCard[];
  chunks: RecordChunk[];
  name: string;
  locale?: Locale;
  timeZone?: string | null;
  invoke: (messages: LLMMessage[]) => Promise<string>;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowById(chunks: RecordChunk[], hash: string, id: number): RecordLine | undefined {
  const chunk = chunks.find((item) => item.hash === hash);
  return chunk?.rows.find((row) => row.id === id);
}

function cardBlock(
  card: ObservationCard,
  chunks: RecordChunk[],
  timeZone: string | null | undefined,
): string {
  const quotes = card.quotes
    .map((id) => {
      const row = rowById(chunks, card.chunkHash, id);
      if (!row) return "";
      const date = asDate(row.timestamp);
      const day = date ? zonedDateKey(date, timeZone) : "";
      const snippet = row.content.slice(0, 60);
      return day ? `${day} ${snippet}` : snippet;
    })
    .filter(Boolean);
  return [`${card.dimension}: ${card.claim}`, ...quotes].join("\n");
}

async function mergeBatch(
  input: ReduceObservationsInput,
  payload: string,
): Promise<string> {
  const locale = input.locale ?? "zh";
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: copy(locale, "prompts.distill.mergeCards", { name: input.name }),
    },
    {
      role: "user",
      content: asMaterial(payload, locale),
    },
  ];
  return (await input.invoke(messages)).trim();
}

async function mergeCardsInPeriod(
  input: ReduceObservationsInput,
  cards: ObservationCard[],
): Promise<string> {
  if (cards.length === 0) return "";
  const blocks = cards.map((card) => cardBlock(card, input.chunks, input.timeZone));
  const batches: string[][] = [];
  for (let i = 0; i < blocks.length; i += CARDS_PER_CALL) {
    batches.push(blocks.slice(i, i + CARDS_PER_CALL));
  }
  const merged: string[] = [];
  for (const batch of batches) {
    merged.push(await mergeBatch(input, batch.join("\n\n")));
  }
  if (merged.length === 1) return merged[0];
  return mergeBatch(input, merged.join("\n\n"));
}

function periodOrder(cards: ObservationCard[], chunks: RecordChunk[]): string[] {
  const ids = [...new Set(cards.map((card) => card.periodId ?? ""))];
  const startOf = (periodId: string): number => {
    const hash = cards.find((card) => (card.periodId ?? "") === periodId)?.chunkHash;
    const chunk = chunks.find((item) => item.hash === hash);
    return chunk?.from?.getTime() ?? 0;
  };
  return ids.sort((a, b) => startOf(a) - startOf(b));
}

function periodLabel(
  periodId: string,
  cards: ObservationCard[],
  chunks: RecordChunk[],
  latest: boolean,
  locale: Locale,
  timeZone?: string | null,
): string {
  const hashes = new Set(
    cards.filter((card) => (card.periodId ?? "") === periodId).map((card) => card.chunkHash),
  );
  const owned = chunks.filter((chunk) => hashes.has(chunk.hash));
  const from = owned[0]?.from ?? owned[0]?.rows[0]?.timestamp ?? null;
  const to = owned[owned.length - 1]?.to ?? from;
  const fromKey = from ? zonedDateKey(from, timeZone) : "";
  const toKey = to ? zonedDateKey(to, timeZone) : fromKey;
  return copy(locale, latest ? "distill.periodNow" : "distill.periodPast", {
    from: fromKey,
    to: toKey,
  });
}

/**
 * Reduces the cards into one analysis text.
 *
 * Periods are newest first. The most recent stretch is marked as now.
 * The model only sees the cards, never the original block.
 */
export async function reduceObservationCards(
  input: ReduceObservationsInput,
): Promise<string> {
  const locale = input.locale ?? "zh";
  if (input.cards.length === 0) return "";
  const order = periodOrder(input.cards, input.chunks);
  const sections: string[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const periodId = order[i];
    const group = input.cards.filter((card) => (card.periodId ?? "") === periodId);
    const text = await mergeCardsInPeriod(input, group);
    if (!text) continue;
    const latest = i === order.length - 1;
    sections.push(
      `${periodLabel(periodId, group, input.chunks, latest, locale, input.timeZone)}\n${text}`,
    );
  }
  return sections.join("\n\n");
}
