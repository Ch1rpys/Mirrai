import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";

/**
 * "Read this line" (C3.4).
 *
 * The rows come from the Xiaoman fixture, so the precedents and the
 * state of their conversations are the designed ones — not rows the
 * test invented. An unconfirmed guess is not shown as if the user had
 * decided it, and nothing about the line is written down or sent to a
 * model.
 */
const getPersonaById = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const getRecordsAround = vi.fn();
const accessed = vi.hoisted(() => new Set<string>());

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked = {
    ...actual,
    getPersonaById: (...a: unknown[]) => getPersonaById(...a),
    candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
    getRecordsAround: (...a: unknown[]) => getRecordsAround(...a),
  };
  return new Proxy(mocked, {
    get(target, property) {
      if (typeof property === "string") accessed.add(property);
      return (target as Record<string | symbol, unknown>)[property];
    },
  });
});

import { decodeLine, median } from "./decode";

const fixture = buildXiaomanRecords();
const conflictStarts = fixture.filter(
  (row) => row.role === "assistant" && row.content === "就嗯？",
);
const position = new Map(fixture.map((row, index) => [row.id, index]));

function decodeRow(row: (typeof fixture)[number]) {
  return {
    id: row.id,
    personaId: 5,
    role: row.role,
    speaker: row.speaker,
    content: row.content,
    kind: row.kind,
    meta: (row.meta ?? null) as Record<string, unknown> | null,
    timestamp: row.timestamp,
    createdAt: row.timestamp,
    emotion: row.role === "assistant" ? row.truth.state : null,
  };
}

function aroundFor(id: number) {
  const index = position.get(id);
  if (index === undefined) return { target: undefined, before: [], after: [] };
  const target = fixture[index];
  return {
    target: decodeRow(target),
    // `getRecordsAround` returns the earlier rows newest-first.
    before: fixture.slice(Math.max(0, index - 3), index).reverse().map(decodeRow),
    after: fixture.slice(index + 1, index + 6).map(decodeRow),
  };
}

describe("decodeLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessed.clear();
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      personaData: {
        microRules: [
          {
            id: "r1",
            trigger: ["就嗯？"],
            meaning: "她生气了",
            rendering: "更短、更冷",
            confidence: 1,
            source: "manual",
            verified: true,
            evidence: [{ recordId: 552, snippet: "就嗯？", at: "2022-03-17T04:54:38.000Z" }],
          },
          {
            id: "r2",
            trigger: ["就嗯？"],
            meaning: "也许只是没睡醒",
            rendering: "照常",
            confidence: 0.6,
            source: "auto",
            verified: false,
            evidence: [],
          },
        ],
      },
    });
    candidateRecordsByOverlap.mockResolvedValue(
      conflictStarts.map((row) => ({
        id: row.id,
        content: row.content,
        timestamp: row.timestamp,
        role: row.role,
        speaker: row.speaker,
        coverage: 1,
      })),
    );
    getRecordsAround.mockImplementation((id: number) => Promise.resolve(aroundFor(id)));
  });

  it("shows the confirmed rule, not the unconfirmed one", async () => {
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.rules.map((rule) => rule.id)).toEqual(["r1"]);
    expect(result.rules[0].meaning).toBe("她生气了");
  });

  it("finds the recent five precedents, each with my 嗯 before it", async () => {
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.precedents).toHaveLength(5);
    for (const precedent of result.precedents) {
      const mine = precedent.before.filter((row) => row.role === "user");
      expect(mine[mine.length - 1]).toMatchObject({ content: "嗯" });
      expect(precedent.after).toHaveLength(5);
    }
  });

  it("counts the conversation's state, once per precedent", async () => {
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.after.count).toBe(5);
    const distant = result.after.states.find((state) => state.state === "distant");
    expect(distant?.n).toBe(5);
    // The fixture's conflict durations are 3/4/5/5/6/8 hours; the
    // median of the five gaps the decoder counts is five hours.
    expect(result.after.gapMedianSec).toBe(18_000);
  });

  it("says nothing was found when the record has no such line", async () => {
    candidateRecordsByOverlap.mockResolvedValue([]);
    const result = await decodeLine({ personaId: 5, userId: 1, text: "我想你" });
    expect(result.precedents).toEqual([]);
    expect(result.after).toEqual({ count: 0, gapMedianSec: null, states: [] });
  });

  it("uses the characteristic words, not just any overlap", async () => {
    candidateRecordsByOverlap.mockResolvedValue([
      {
        id: 9,
        content: "今天吃什么",
        timestamp: new Date("2023-01-01T12:00:00Z"),
        role: "assistant",
        speaker: null,
        coverage: 1,
      },
    ]);
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.precedents).toEqual([]);
  });

  it("touches no database function except the three reads", async () => {
    await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect([...accessed].sort()).toEqual([
      "candidateRecordsByOverlap",
      "getPersonaById",
      "getRecordsAround",
    ]);
  });

  it("never calls a model", () => {
    const source = readFileSync(path.resolve(__dirname, "decode.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*llm/);
  });

  it("takes the median of an even and an odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
