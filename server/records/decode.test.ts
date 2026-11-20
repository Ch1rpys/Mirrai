import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * "Read this line" (C3.4).
 *
 * It gives precedents and the numbers around them, never a conclusion.
 * The two rules the test holds it to are the ones the page promises: an
 * unconfirmed guess is not shown as if the user had decided it, and
 * nothing about the line is written down or sent to a model.
 */
const getPersonaById = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const getRecordsAround = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  getRecordsAround: (...a: unknown[]) => getRecordsAround(...a),
}));

import { decodeLine, median } from "./decode";

function at(iso: string): Date {
  return new Date(iso);
}

/** The six conflict starts of the fixture: I said "嗯", they said "就嗯？". */
const conflictStarts = Array.from({ length: 6 }, (_, index) => index + 1);

function aroundFor(id: number) {
  return {
    target: {
      id,
      personaId: 5,
      role: "assistant",
      speaker: "小满",
      content: "就嗯？",
      kind: "text",
      meta: null,
      timestamp: at(`2023-0${id}-01T12:00:00.000Z`),
      createdAt: at(`2023-0${id}-01T12:00:00.000Z`),
      emotion: "distant",
    },
    before: [
      {
        id: 100 + id,
        personaId: 5,
        role: "user",
        speaker: "阿树",
        content: "嗯",
        kind: "text",
        meta: null,
        timestamp: at(`2023-0${id}-01T11:59:00.000Z`),
        createdAt: at(`2023-0${id}-01T11:59:00.000Z`),
        emotion: null,
      },
    ],
    after: [
      {
        id: 200 + id,
        personaId: 5,
        role: "assistant",
        speaker: "小满",
        content: "哦。",
        kind: "text",
        meta: null,
        timestamp: at(`2023-0${id}-01T13:00:00.000Z`),
        createdAt: at(`2023-0${id}-01T13:00:00.000Z`),
        emotion: "distant",
      },
    ],
  };
}

describe("decodeLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
            evidence: [{ recordId: 1, snippet: "就嗯？", at: "2023-01-01T12:00:00.000Z" }],
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
      conflictStarts.map((id) => ({
        id,
        content: "就嗯？",
        timestamp: at(`2023-0${id}-01T12:00:00.000Z`),
        role: "assistant",
        speaker: "小满",
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
      expect(precedent.before).toHaveLength(1);
      expect(precedent.before[0]).toMatchObject({ role: "user", content: "嗯" });
      expect(precedent.after[0]).toMatchObject({ role: "assistant", content: "哦。" });
    }
  });

  it("counts how often the conversation after was labeled 疏远", async () => {
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.after.count).toBe(5);
    const distant = result.after.states.find((state) => state.state === "distant");
    expect(distant?.n).toBe(5);
    // Each precedent's next line is an hour later.
    expect(result.after.gapMedianSec).toBe(3600);
  });

  it("says nothing was found when the record has no such line", async () => {
    candidateRecordsByOverlap.mockResolvedValue([]);
    const result = await decodeLine({ personaId: 5, userId: 1, text: "我想你" });
    expect(result.precedents).toEqual([]);
    expect(result.after).toEqual({ count: 0, gapMedianSec: null, states: [] });
  });

  it("uses the characteristic words, not just any overlap", async () => {
    candidateRecordsByOverlap.mockResolvedValue([
      { id: 9, content: "今天吃什么", timestamp: at("2023-01-01T12:00:00Z"), role: "assistant", speaker: null, coverage: 1 },
    ]);
    const result = await decodeLine({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(result.precedents).toEqual([]);
  });

  it("never calls a model and never writes", () => {
    const source = readFileSync(path.resolve(__dirname, "decode.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*llm/);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("takes the median of an even and an odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
