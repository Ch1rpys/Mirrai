import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The prompt of a scene drawn from a stretch of the record (C8.13).
 *
 * Three promises are checked here:
 *
 *   - the days are stated as an instruction, so the persona's knowledge
 *     stops at the end of the stretch;
 *   - the lines they actually said arrive as fenced material, under
 *     their own heading, with no model called to summarise them;
 *   - a scene taken from one persona's record is not used on another.
 */

const getMessagesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const retrieveMemories = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
const getRecordsByIds = vi.fn();
const iterateRecords = vi.fn(async function* () {
  /* Filled in per test. */
}) as any;

vi.mock("../db", () => ({
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  getRecordsByIds: (...a: unknown[]) => getRecordsByIds(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...(a as [])),
  getMemoriesByPersonaId: vi.fn().mockResolvedValue([]),
}));

vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

import { composeMessages } from "./service";
import { copy } from "@shared/copy";

const persona = {
  id: 5,
  userId: 1,
  name: "小A",
  relationshipDesc: "恋人",
  togetherFrom: null,
  togetherTo: null,
  personaData: null,
  analysisStatus: "ready",
  analysisProgress: 100,
  analysisMessage: null,
  emotionalState: "warm",
  chatCount: 10,
  lastChatAt: null,
  skillJobId: null,
  llmProvider: null,
  intimacyScore: 0,
  intimacyLevel: "acquainted",
  activeSceneId: 30,
  source: "upload",
  remindersEnabled: true,
  correctionLog: null,
  graduationStatus: null,
  graduatedAt: null,
  farewellLetter: null,
  graduationMode: null,
  distillationMode: null,
  timezone: "Asia/Shanghai",
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const RANGE = {
  personaId: 5,
  fromId: 100,
  toId: 107,
  from: "2026-03-01",
  to: "2026-03-02",
};

function record(id: number, at: string, content: string) {
  return {
    id,
    personaId: 5,
    userId: 1,
    role: id % 2 === 0 ? "user" : "assistant",
    speaker: null,
    kind: "text",
    content,
    timestamp: new Date(at),
    createdAt: new Date(at),
  };
}

const SEGMENT = [
  record(100, "2026-03-01T04:00:00.000Z", "今天风很大"),
  record(101, "2026-03-01T04:01:00.000Z", "我把窗户关上了"),
  record(102, "2026-03-01T04:02:00.000Z", "你那边下雨了吗"),
  record(103, "2026-03-01T04:03:00.000Z", "下了，还不小"),
  record(104, "2026-03-02T04:00:00.000Z", "雨停了"),
  record(105, "2026-03-02T04:01:00.000Z", "今天出门走走吗"),
  record(106, "2026-03-02T04:02:00.000Z", "好啊，等我一下"),
  record(107, "2026-03-02T04:03:00.000Z", "我在楼下等你"),
];

function rangeScene(overrides: Record<string, unknown> = {}) {
  return {
    id: 30,
    userId: 1,
    name: "2026-03-01–2026-03-02",
    description: null,
    icon: null,
    systemPromptOverlay: "你正处在三月初的那几天里。",
    emotionalState: null,
    starters: [],
    isBuiltin: false,
    recordRange: RANGE,
    createdAt: new Date(),
    ...overrides,
  };
}

function memory(title: string, date: string) {
  return {
    id: 1,
    title,
    description: null,
    date,
    category: "fact",
    subject: "them",
    score: 1,
  };
}

/** The prompt with every fenced region removed. */
function unfenced(prompt: string): string {
  return prompt.replace(/<persona_data>[\s\S]*?<\/persona_data>/g, "");
}

beforeEach(() => {
  for (const fn of [
    getMessagesByPersonaId,
    getSceneById,
    getLatestChatSummary,
    retrieveMemories,
    getUserTimezone,
    getUserById,
    getRecentUserMood,
    getRelationshipEvents,
    getRecordsByIds,
  ]) {
    fn.mockReset();
  }
  iterateRecords.mockReset();
  iterateRecords.mockImplementation(async function* () {
    for (const row of SEGMENT) yield row;
  });
  getMessagesByPersonaId.mockResolvedValue([]);
  getLatestChatSummary.mockResolvedValue(null);
  retrieveMemories.mockResolvedValue([]);
  getUserTimezone.mockResolvedValue(null);
  getUserById.mockResolvedValue(null);
  getRecentUserMood.mockResolvedValue(null);
  getRelationshipEvents.mockResolvedValue([]);
  getRecordsByIds.mockImplementation(async (ids: number[]) =>
    SEGMENT.filter((row) => ids.includes(row.id)),
  );
  getSceneById.mockResolvedValue(rangeScene());
});

async function promptFor(userMessage = "在吗"): Promise<string> {
  const { messages } = await composeMessages({
    persona,
    userId: 1,
    userMessage,
    contextLimit: 20,
  });
  return messages[0]!.content as string;
}

describe("a scene drawn from a stretch of the record", () => {
  it("states the days as an instruction, so the persona knows where its knowledge stops", async () => {
    const prompt = await promptFor();

    const boundary = copy("zh", "prompt.sceneRangeBoundary", {
      from: "2026-03-01",
      to: "2026-03-02",
    });
    expect(prompt).toContain(boundary);
    // An instruction, not material: it survives the fence being removed.
    expect(unfenced(prompt)).toContain(boundary);
  });

  it("carries the lines they said, as fenced material under their own heading", async () => {
    const prompt = await promptFor();

    const heading = copy("zh", "prompt.sceneRangeHeading");
    expect(prompt).toContain(heading);
    expect(prompt).toContain("今天风很大");
    expect(prompt).toContain("我在楼下等你");
    // The lines are material: remove the fence and they are gone. The
    // heading names the block from outside it, the way the scene heading
    // names the scene, so it is allowed to stay.
    const outside = unfenced(prompt);
    expect(outside).not.toContain("今天风很大");
    expect(outside).not.toContain("我在楼下等你");
  });

  it("does not inject a memory or an event dated after the stretch", async () => {
    retrieveMemories.mockResolvedValue([
      memory("范围之前的事", "2026-02-20"),
      memory("范围之后的事", "2026-03-10"),
    ]);
    getRelationshipEvents.mockResolvedValue([
      { kind: "trip", title: "范围之前的一次旅行", happenedAt: "2026-02-20T04:00:00.000Z" },
      { kind: "trip", title: "范围之后的一次旅行", happenedAt: "2026-03-10T04:00:00.000Z" },
    ]);
    const prompt = await promptFor();

    expect(prompt).toContain("范围之前的事");
    expect(prompt).not.toContain("范围之后的事");
    // The events layer uses the same boundary; a fact that came later is
    // not in the prompt either.
    expect(prompt).toContain("范围之前的一次旅行");
    expect(prompt).not.toContain("范围之后的一次旅行");
  });

  it("treats a date-only memory as a local day for a timezone behind UTC", async () => {
    // The cut is 2026-03-02 in New York = 2026-03-03T04:59Z; a memory
    // dated 03-03 (UTC midnight) used to compare as "before the cut".
    retrieveMemories.mockResolvedValue([
      memory("范围前一天的事", "2026-03-01"),
      memory("范围次日的事", "2026-03-03"),
    ]);
    const { messages } = await composeMessages({
      persona: { ...persona, timezone: "America/New_York" },
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });
    const prompt = messages[0]!.content as string;
    expect(prompt).toContain("范围前一天的事");
    expect(prompt).not.toContain("范围次日的事");
  });

  it("keeps the boundary when the records behind it are gone", async () => {
    getRecordsByIds.mockResolvedValue([]);
    const prompt = await promptFor();

    expect(prompt).toContain(
      copy("zh", "prompt.sceneRangeBoundary", { from: "2026-03-01", to: "2026-03-02" }),
    );
    expect(prompt).not.toContain("今天风很大");
  });

  it("is refused on a persona it was not taken from", async () => {
    getSceneById.mockResolvedValue(
      rangeScene({
        systemPromptOverlay: "不该出现的场景叠加",
        recordRange: { ...RANGE, personaId: 6 },
      }),
    );
    const prompt = await promptFor();

    // The whole scene is refused, not only its lines: neither the
    // overlay, nor the days, nor the lines from the other persona reach
    // this prompt.
    expect(prompt).not.toContain("不该出现的场景叠加");
    expect(prompt).not.toContain("【当前场景】");
    expect(prompt).not.toContain("今天风很大");
    expect(prompt).not.toContain(
      copy("zh", "prompt.sceneRangeBoundary", { from: "2026-03-01", to: "2026-03-02" }),
    );
  });

  it("leaves the prompt unchanged when no scene is active", async () => {
    getSceneById.mockResolvedValue(null);
    const { messages } = await composeMessages({
      persona: { ...persona, activeSceneId: null },
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });
    const prompt = messages[0]!.content as string;

    expect(prompt).not.toContain("【当前场景】");
    expect(prompt).not.toContain(copy("zh", "prompt.sceneRangeHeading"));
    expect(getRecordsByIds).not.toHaveBeenCalled();
  });
});
