import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Where a memory came from.
 *
 * A fact the persona said in the conversation is reconstructed speech,
 * not a fact about them. The extractor used to store it as an anchor
 * all the same.
 */

const getLastExtractionAt = vi.fn();
const getMessagesSince = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const createMemory = vi.fn();
const markMemoryExtracted = vi.fn();
const markMemoryAttempted = vi.fn();
const claimMemoryExtraction = vi.fn();
const releaseMemoryExtraction = vi.fn();

vi.mock("../db", () => ({
  getLastExtractionAt: (...a: unknown[]) => getLastExtractionAt(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  createMemory: (...a: unknown[]) => createMemory(...a),
  markMemoryExtracted: (...a: unknown[]) => markMemoryExtracted(...a),
  markMemoryAttempted: (...a: unknown[]) => markMemoryAttempted(...a),
  claimMemoryExtraction: (...a: unknown[]) => claimMemoryExtraction(...a),
  releaseMemoryExtraction: (...a: unknown[]) => releaseMemoryExtraction(...a),
}));

const invoke = vi.fn();
vi.mock("../llm", () => ({
  llmService: { invoke: (...a: unknown[]) => invoke(...a) },
}));

import { extractMemories } from "./memory-extract";

const NOW = new Date("2026-01-15T12:00:00Z");

const persona = {
  id: 1,
  userId: 1,
  name: "小A",
  emotionalState: "warm",
} as any;

const conversation = [
  { id: 10, role: "user", content: "今天好累", createdAt: NOW },
  { id: 11, role: "assistant", content: "我周三下午有课", createdAt: NOW },
];

beforeEach(() => {
  for (const fn of [
    getLastExtractionAt,
    getMessagesSince,
    getMemoriesByPersonaId,
    createMemory,
    markMemoryExtracted,
    markMemoryAttempted,
    claimMemoryExtraction,
    releaseMemoryExtraction,
    invoke,
  ]) {
    fn.mockReset();
  }
  getLastExtractionAt.mockResolvedValue(null);
  getMessagesSince.mockResolvedValue(conversation);
  getMemoriesByPersonaId.mockResolvedValue([]);
  createMemory.mockResolvedValue(1);
  markMemoryExtracted.mockResolvedValue(undefined);
  markMemoryAttempted.mockResolvedValue(undefined);
  claimMemoryExtraction.mockResolvedValue(true);
  releaseMemoryExtraction.mockResolvedValue(undefined);
});

describe("the source of an extracted memory", () => {
  it("does not store a fact the persona said", async () => {
    invoke.mockResolvedValue(JSON.stringify([
      { title: "周三下午有课", category: "anchor", subject: "them", line: 2 },
    ]));

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(createMemory).not.toHaveBeenCalled();
    expect(result.fromPersona).toBe(1);
  });

  it("stores a fact the user said", async () => {
    invoke.mockResolvedValue(JSON.stringify([
      { title: "今天好累", category: "memory", subject: "me", line: 1 },
    ]));

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory.mock.calls[0][0].messageId).toBe(10);
    expect(result.fromPersona).toBe(0);
    expect(result.added).toHaveLength(1);
  });

  it("drops an item that has no line", async () => {
    invoke.mockResolvedValue(JSON.stringify([
      { title: "周三下午有课", category: "anchor", subject: "them" },
    ]));

    const result = await extractMemories({ persona, userId: 1, now: NOW });

    expect(createMemory).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.fromPersona).toBe(0);
  });

  it("keeps a fact the other person said in an uploaded transcript", async () => {
    invoke.mockResolvedValue(JSON.stringify([
      { title: "周三下午有课", category: "anchor", subject: "them", line: 2 },
    ]));

    const result = await extractMemories({
      persona,
      userId: 1,
      now: NOW,
      history: conversation,
    });

    expect(createMemory).toHaveBeenCalledTimes(1);
    expect(createMemory.mock.calls[0][0].messageId).toBe(11);
    expect(result.fromPersona).toBe(0);
    expect(result.added).toHaveLength(1);
  });
});
