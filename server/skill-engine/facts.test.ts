import { describe, expect, it, vi, beforeEach } from "vitest";

const createMemory = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const createDistillationCard = vi.fn();

vi.mock("../db", () => ({
  createMemory: (...a: unknown[]) => createMemory(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  createDistillationCard: (...a: unknown[]) => createDistillationCard(...a),
}));

import { chunkRecords } from "./chunks";
import {
  chunksForFactExtraction,
  parseFactCards,
  extractFactsFromRecords,
} from "./facts";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

const TIME_ZONE = "Asia/Shanghai";

function chunkWith(rows: Array<{ id: number; role: "user" | "assistant"; content: string }>) {
  const timestamp = new Date("2023-07-12T08:16:09.000Z");
  return {
    index: 0,
    hash: "abc",
    from: timestamp,
    to: timestamp,
    periodId: "p1" as string | null,
    dayPart: "day" as const,
    chars: 10,
    rows: rows.map((row) => ({
      ...row,
      timestamp,
      kind: "text" as const,
    })),
  };
}

const BIRTHDAY_JSON = JSON.stringify({
  facts: [{
    title: "生日",
    description: "5月21号",
    category: "anchor",
    subject: "me",
    date: "05-21",
    quote: 11,
  }],
  people: [],
  stances: [],
});

describe("parseFactCards", () => {
  const chunk = chunkWith([
    { id: 11, role: "user", content: "我生日是5月21号" },
    { id: 12, role: "assistant", content: "我记得" },
  ]);

  it("keeps a fact that cites a line in its block", () => {
    const parsed = parseFactCards(BIRTHDAY_JSON, chunk);
    expect(parsed.facts).toEqual([
      expect.objectContaining({
        title: "生日",
        category: "anchor",
        date: "05-21",
        quote: 11,
      }),
    ]);
  });

  it("drops a fact that cites a line from another block", () => {
    const parsed = parseFactCards(
      JSON.stringify({
        facts: [{
          title: "生日",
          description: "5月21号",
          category: "anchor",
          subject: "me",
          date: "05-21",
          quote: 999,
        }],
      }),
      chunk,
    );
    expect(parsed.facts).toEqual([]);
  });

  it("clears a date that is not a day", () => {
    const parsed = parseFactCards(
      JSON.stringify({
        facts: [{
          title: "夏天",
          description: "sometime last summer",
          category: "memory",
          subject: "them",
          date: "last summer",
          quote: 12,
        }],
      }),
      chunk,
    );
    expect(parsed.facts[0]?.date).toBeNull();
  });
});

describe("chunksForFactExtraction", () => {
  const rows = buildXiaomanRecords();
  const chunks = chunkRecords(rows, { timeZone: TIME_ZONE });

  it("reads every block in deep mode", () => {
    expect(chunksForFactExtraction(chunks, "deep")).toHaveLength(chunks.length);
  });

  it("does not send a block without a clue in a lighter mode", () => {
    const selected = chunksForFactExtraction(chunks, "fast");
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(chunks.length);
    const hashes = new Set(selected.map((chunk) => chunk.hash));
    const skipped = chunks.filter((chunk) => !hashes.has(chunk.hash));
    expect(skipped.length).toBeGreaterThan(0);
  });
});

describe("extractFactsFromRecords", () => {
  beforeEach(() => {
    createMemory.mockReset();
    getMemoriesByPersonaId.mockReset();
    createDistillationCard.mockReset();
    createMemory.mockResolvedValue(1);
    getMemoriesByPersonaId.mockResolvedValue([]);
    createDistillationCard.mockResolvedValue(undefined);
  });

  const chunk = chunkWith([{ id: 11, role: "user", content: "我生日是5月21号" }]);
  const invoke = async () => BIRTHDAY_JSON;
  const base = {
    chunks: [chunk],
    rows: chunk.rows,
    personaId: 1,
    userId: 1,
    name: "小满",
    mode: "deep" as const,
    invoke,
  };

  it("stores a record-sourced memory with the line it cited", async () => {
    const result = await extractFactsFromRecords(base);
    expect(result.created).toBe(1);
    expect(createMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "anchor",
        date: "05-21",
        recordId: 11,
        source: "records",
        subject: "me",
        importance: 5,
      }),
    );
  });

  it("does not write the same fact twice", async () => {
    await extractFactsFromRecords(base);
    getMemoriesByPersonaId.mockResolvedValue([{
      title: "生日",
      description: "5月21号",
      factKey: "生日",
    }]);
    createMemory.mockClear();
    const second = await extractFactsFromRecords(base);
    expect(second.created).toBe(0);
    expect(createMemory).not.toHaveBeenCalled();
  });

  it("does not call the model for a block without a clue in fast mode", async () => {
    const invoke = vi.fn(async () => BIRTHDAY_JSON);
    const quiet = chunkWith([{ id: 3, role: "assistant", content: "在的呀" }]);
    await extractFactsFromRecords({
      ...base,
      chunks: [quiet],
      rows: quiet.rows,
      mode: "fast",
      invoke,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(createMemory).not.toHaveBeenCalled();
  });
});
