import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const createMessage = vi.fn();
const getDefaultLlmConfig = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const updatePersona = vi.fn();
const incrementChatCount = vi.fn();
const getPersonaById = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getFilesByPersonaId = vi.fn();
const getSceneById = vi.fn();
const getLatestChatSummary = vi.fn();
const createChatSummary = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const setGraduationStatus = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const createGraduationAssessment = vi.fn();
const getMessagesSince = vi.fn();
const getRecentMessages = vi.fn();
const touchMemoryRecalled = vi.fn();
const createSafetyEvent = vi.fn();
const hasSafetyEventSince = vi.fn();
const getLastMessageAt = vi.fn();
const getMessageCountSince = vi.fn();
const getDailyChatCounts = vi.fn();
const getSessionStartAt = vi.fn();
const getUserMessageCountSince = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();
const getDailyUserChatCounts = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const getLastExtractionAttemptAt = vi.fn();
const getLastExtractionAt = vi.fn();
const getMessageById = vi.fn();
const updateEmotionSnapshot = vi.fn();

vi.mock("../storage", () => ({
  storageToDataUrl: vi.fn(),
}));

vi.mock("../db", () => ({
  createMessage: (...a: unknown[]) => createMessage(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  createChatSummary: (...a: unknown[]) => createChatSummary(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
  getMessagesSince: (...a: unknown[]) => getMessagesSince(...a),
  getRecentMessages: (...a: unknown[]) => getRecentMessages(...a),
  touchMemoryRecalled: (...a: unknown[]) => touchMemoryRecalled(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
  hasSafetyEventSince: (...a: unknown[]) => hasSafetyEventSince(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  getMessageCountSince: (...a: unknown[]) => getMessageCountSince(...a),
  getDailyChatCounts: (...a: unknown[]) => getDailyChatCounts(...a),
  getSessionStartAt: (...a: unknown[]) => getSessionStartAt(...a),
  getUserMessageCountSince: (...a: unknown[]) => getUserMessageCountSince(...a),
  getUserMessageCountForPersonaSince: (...a: unknown[]) =>
    getUserMessageCountForPersonaSince(...a),
  getDailyUserChatCounts: (...a: unknown[]) => getDailyUserChatCounts(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  getLastExtractionAttemptAt: (...a: unknown[]) => getLastExtractionAttemptAt(...a),
  getLastExtractionAt: (...a: unknown[]) => getLastExtractionAt(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  updateEmotionSnapshot: (...a: unknown[]) => updateEmotionSnapshot(...a),
  updateMessageMetadata: vi.fn().mockResolvedValue(true),
  createFidelityPair: vi.fn(),
  clearMessagePendingChoice: vi.fn().mockResolvedValue(true),
}));

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const streamWithProvider = vi.fn();
const resolveProviderForUser = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: (...a: unknown[]) => streamWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

vi.mock("../_core/emotion", () => ({
  inferEmotionalState: vi.fn(async () => ({ state: "warm", source: "heuristic" })),
}));

import { copy } from "@shared/copy";
import { runConversation } from "./service";
import { planTurn } from "./generate";
import { layerOverridesForEval, runEval } from "../eval/run";

const NOW = new Date("2026-01-15T12:00:00Z");

/**
 * i18n:allow-identifier — fixture words, not copy the app writes.
 */
function persona() {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前任",
    togetherFrom: "2021-05",
    togetherTo: null,
    timezone: "Asia/Shanghai",
    personaData: { personality: "温柔" },
    analysisStatus: "ready",
    emotionalState: "warm",
    chatCount: 10,
    intimacyScore: 120,
    intimacyLevel: "familiar",
    graduationStatus: null,
    llmProvider: null,
    activeSceneId: null,
    presence: "active",
    rerankEnabled: false,
  } as any;
}

const HELD_OUT = "这是一句留出的话";
const CONTEXT = [
  { role: "user" as const, content: "在吗", timestamp: null },
  { role: "assistant" as const, content: "在的", timestamp: null },
  { role: "user" as const, content: "吃饭了吗", timestamp: null },
];

beforeEach(() => {
  for (const fn of [
    createMessage, getDefaultLlmConfig, getTodaySnapshot, createEmotionSnapshot,
    getIntimacyData, updateIntimacy, updatePersona, incrementChatCount, getPersonaById,
    getMessagesByPersonaId, getMemoriesByPersonaId, getFilesByPersonaId, getSceneById,
    getLatestChatSummary, createChatSummary, getRecentEmotionTrend,
    getMessageCountInRange, setGraduationStatus, getLatestGraduationAssessment,
    createGraduationAssessment, getMessagesSince, getRecentMessages, touchMemoryRecalled,
    createSafetyEvent, hasSafetyEventSince, getLastMessageAt, getMessageCountSince,
    getDailyChatCounts, getSessionStartAt, getUserMessageCountSince, getDailyUserChatCounts,
    getUserMessageCountForPersonaSince, getCollectedMessagesForPersona,
    getLastExtractionAttemptAt, getLastExtractionAt, getMessageById, updateEmotionSnapshot,
    getUserTimezone, getUserById, getRecentUserMood, getRelationshipEvents,
    invoke, invokeWithProvider, streamWithProvider, resolveProviderForUser,
  ]) {
    fn.mockReset();
  }

  getMessagesByPersonaId.mockResolvedValue(
    CONTEXT.map((row, i) => ({ id: i + 1, origin: "web", ...row })),
  );
  getDefaultLlmConfig.mockResolvedValue(null);
  getTodaySnapshot.mockResolvedValue(undefined);
  getIntimacyData.mockResolvedValue({
    chatCount: 10, totalMessages: 20, memoryCount: 3,
    emotionVariety: 3, daysSinceCreation: 100, consecutiveDays: 2,
  });
  getMemoriesByPersonaId.mockResolvedValue([]);
  getFilesByPersonaId.mockResolvedValue([]);
  getSceneById.mockResolvedValue(null);
  getLatestChatSummary.mockResolvedValue(undefined);
  getRecentEmotionTrend.mockResolvedValue([]);
  getMessageCountInRange.mockResolvedValue(0);
  getLatestGraduationAssessment.mockResolvedValue(undefined);
  createGraduationAssessment.mockResolvedValue(1);
  getMessagesSince.mockResolvedValue([]);
  getRecentMessages.mockResolvedValue([]);
  getLastMessageAt.mockResolvedValue(NOW);
  getMessageCountSince.mockResolvedValue(1);
  getDailyChatCounts.mockResolvedValue([]);
  getSessionStartAt.mockResolvedValue(NOW);
  getUserTimezone.mockResolvedValue("Asia/Shanghai");
  getUserById.mockResolvedValue({ id: 1, trajectoryAssessment: "auto" });
  getRecentUserMood.mockResolvedValue(null);
  getRelationshipEvents.mockResolvedValue([]);
  getUserMessageCountSince.mockResolvedValue(1);
  getUserMessageCountForPersonaSince.mockResolvedValue(1);
  getDailyUserChatCounts.mockResolvedValue([]);
  createMessage.mockResolvedValue(99);
  createSafetyEvent.mockResolvedValue(1);
  hasSafetyEventSince.mockResolvedValue(false);
  touchMemoryRecalled.mockResolvedValue(undefined);
  getCollectedMessagesForPersona.mockResolvedValue([]);
  getLastExtractionAttemptAt.mockResolvedValue(NOW);
  getLastExtractionAt.mockResolvedValue(NOW);
  incrementChatCount.mockResolvedValue(11);
  updatePersona.mockResolvedValue(undefined);
  resolveProviderForUser.mockResolvedValue({
    name: "Test",
    isConfigured: () => true,
    capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
    invoke,
    stream: async function* () {
      yield { text: "" };
    },
  });
  invokeWithProvider.mockResolvedValue("嗯。");
});

function withoutHeldOutExemplar(messages: Array<{ role: string; content: string }>) {
  const heading = copy("zh", "prompt.exemplarsHeading");
  return messages.map((message) => {
    const headingAt = message.content.indexOf(heading);
    const heldAt = message.content.indexOf(HELD_OUT);
    if (headingAt === -1 || heldAt === -1) return message;
    const openAt = message.content.lastIndexOf("<persona_data>", headingAt);
    const closeAt = message.content.indexOf("</persona_data>", heldAt);
    if (openAt === -1 || closeAt === -1) return message;
    const before = message.content.slice(0, openAt).replace(/\n+$/, "");
    const after = message.content.slice(closeAt + "</persona_data>".length).replace(/^\n+/, "");
    return { ...message, content: [before, after].filter(Boolean).join("\n\n") };
  });
}

describe("the shared generation path", () => {
  it("sends the same messages from a conversation and from evaluation, except the held-out line", async () => {
    getCollectedMessagesForPersona.mockResolvedValue([
      { id: 1, role: "user", content: "吃饭了吗", timestamp: NOW },
      { id: 2, role: "assistant", content: HELD_OUT, timestamp: NOW },
    ]);

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "吃饭了吗",
      mode: "once",
      now: NOW,
      alreadyPersisted: true,
    })) {
      // drain
    }
    const chatMessages = (invokeWithProvider.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> }).messages;

    invokeWithProvider.mockClear();
    await runEval({
      persona: persona(),
      userId: 1,
      cases: [
        {
          context: CONTEXT,
          expected: { role: "assistant", content: HELD_OUT, timestamp: null },
          expectedState: null,
        },
      ],
      trainingTexts: ["在的"],
      now: NOW,
    });
    const evalMessages = (invokeWithProvider.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> }).messages;

    expect(JSON.stringify(chatMessages)).toContain(HELD_OUT);
    expect(JSON.stringify(evalMessages)).not.toContain(HELD_OUT);
    expect(withoutHeldOutExemplar(chatMessages)).toEqual(evalMessages);
  });

  it("turns action sampling off with --without act", async () => {
    const withActs = persona();
    withActs.personaData = {
      personality: "温柔",
      actProfile: { samples: 80, unconditional: { tease: 80 }, buckets: [] },
    };
    const input = {
      persona: withActs,
      userId: 1,
      userMessage: "吃饭了吗",
      history: CONTEXT,
      now: NOW,
      locale: "zh" as const,
      seed: "eval:1:0:held",
      exclude: { texts: [HELD_OUT] },
    };
    const sampled = await planTurn(input);
    const suppressed = await planTurn({
      ...input,
      layerOverrides: layerOverridesForEval({ without: ["act"] }),
    });
    expect(sampled.sampledAct).toBe("tease");
    expect(sampled.layersUsed).toContain("act");
    expect(suppressed.sampledAct).toBeNull();
    expect(suppressed.layersUsed).not.toContain("act");
  });

  it("does not put the user's sample lines into the prompt", async () => {
    /**
     * i18n:allow-input — a distinctive quote used only to prove it
     * stays out of the generation path.
     */
    const sample = "user-side-sample-line-that-must-not-enter-the-prompt";
    const withUserSide = persona();
    withUserSide.styleProfile = {
      version: 1,
      measuredAt: NOW.toISOString(),
      recordsVersion: "80:80",
      userSide: { samples: 80, sampleLines: [sample] },
    };
    const planned = await planTurn({
      persona: withUserSide,
      userId: 1,
      userMessage: "吃饭了吗",
      history: CONTEXT,
      now: NOW,
      locale: "zh",
      seed: "user-side:1",
    });
    const packed = JSON.stringify(planned.messages);
    expect(packed).not.toContain(sample);
    expect(CONTEXT.some((row) => row.content.includes(sample))).toBe(false);
  });
});

describe("pnpm eval --without", () => {
  it("is wired on the command line", () => {
    const src = readFileSync(join(__dirname, "../../scripts/eval-run.ts"), "utf8");
    expect(src).toContain('--without');
    expect(src).toContain("without,");
  });
});
