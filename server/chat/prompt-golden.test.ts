import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The prompt of a persona that has no sixth-stage data.
 *
 * Later work will keep changing `buildSystemPrompt` and the message
 * assembly. None of those changes may alter a single character of what
 * a pre-v6 persona is told. These snapshots are that promise.
 */

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
  getRecentCheckinAnswers: vi.fn().mockResolvedValue([]),
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
  cancelPendingReplyJobs: vi.fn().mockResolvedValue(0),
  getPendingReplyJob: vi.fn().mockResolvedValue(null),
  createReplyJob: vi.fn(),
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
  resolveProviderForPurpose: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurposeWithOwnership: async (params: unknown) => ({
    provider: await resolveProviderForUser(params as any),
    owned: false,
  }),
}));

const inferEmotionalState = vi.fn();

vi.mock("../_core/emotion", () => ({
  inferEmotionalState: (...a: unknown[]) => inferEmotionalState(...a),
}));

import { buildSystemPrompt } from "../_core/persona-utils";
import { runConversation } from "./service";

const NOW = new Date("2026-01-15T12:00:00Z");
const OPTIONS = { now: NOW, locale: "zh" as const, timeZone: "Asia/Shanghai" };

/**
 * i18n:allow-identifier — these are the persona's own words, not
 * sentences the app writes. The fixtures are Chinese because that is
 * what a typical stored persona looks like.
 */
function sevenLayerPersona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "阿树",
    relationshipDesc: "朋友",
    togetherFrom: "2021-06-15",
    togetherTo: null,
    timezone: "Asia/Shanghai",
    emotionalState: "warm",
    presence: "active",
    graduationStatus: null,
    analysisStatus: "ready",
    chatCount: 10,
    intimacyScore: 120,
    intimacyLevel: "familiar",
    llmProvider: null,
    activeSceneId: null,
    personaData: {
      personality: "温和，话不多",
      speakingStyle: "短句，很少用标点",
      catchphrases: ["嗯", "好呀"],
      attachmentStyle: "安全",
      loveLanguage: "陪伴",
      conflictStyle: "先安静一会儿",
      touchingMoments: "会记得你随口说的事",
    },
    ...overrides,
  } as any;
}

function v5Persona() {
  return sevenLayerPersona({
    emotionalState: "distant",
    personaData: {
      personality: "温和，话不多",
      speakingStyle: "短句，很少用标点",
      catchphrases: ["嗯", "好呀"],
      attachmentStyle: "安全",
      loveLanguage: "陪伴",
      conflictStyle: "先安静一会儿",
      touchingMoments: "会记得你随口说的事",
      microRules: [
        {
          id: "confirmed-1",
          trigger: ["随便你"],
          meaning: "她真的生气了",
          rendering: "更短、更冷，不解释",
          confidence: 0.8,
          source: "manual",
          verified: true,
          evidence: [{ snippet: "随便你", at: "2025-03-01" }],
        },
        {
          id: "candidate-1",
          trigger: ["算了"],
          meaning: "她放弃了",
          rendering: "只回一个嗯",
          confidence: 0.5,
          source: "auto",
          verified: false,
          evidence: [{ snippet: "算了", at: "2025-03-02" }],
        },
      ],
      imperfectionProfile: [{ state: "distant", deviations: ["只用三个字"] }],
      suppressions: [
        {
          id: "sup-1",
          pattern: "呵呵",
          kind: "no_phrase",
          confidence: 0.9,
          source: "manual",
          verified: true,
          evidence: [{ snippet: "从不说呵呵", at: "2024-11-02" }],
        },
      ],
      lifeEvents: [
        {
          id: "life-1",
          kind: "life",
          title: "换了工作",
          detail: "去了一家小公司",
          whoSaid: "them",
          closed: false,
          source: "manual",
          verified: true,
          evidence: [{ snippet: "我入职了", at: "2024-09-01" }],
        },
      ],
      periods: [
        {
          id: "p1",
          from: "2021-06-15",
          to: "2023-06-09",
        },
        {
          id: "p2",
          from: "2023-07-05",
          to: "2024-10-31",
        },
      ],
    },
  });
}

describe("the prompt of a persona with no sixth-stage data", () => {
  const previousTransparency = process.env.PERSONA_AI_TRANSPARENCY;

  beforeEach(() => {
    delete process.env.PERSONA_AI_TRANSPARENCY;
  });

  afterEach(() => {
    if (previousTransparency === undefined) delete process.env.PERSONA_AI_TRANSPARENCY;
    else process.env.PERSONA_AI_TRANSPARENCY = previousTransparency;
  });

  it("old seven-layer persona", () => {
    expect(buildSystemPrompt(sevenLayerPersona(), OPTIONS)).toMatchSnapshot();
  });

  it("v5 complete persona", () => {
    expect(buildSystemPrompt(v5Persona(), OPTIONS)).toMatchSnapshot();
  });

  it("v5 persona with a sampled tease", () => {
    expect(
      buildSystemPrompt(v5Persona(), { ...OPTIONS, sampledAct: "tease" }),
    ).toMatchSnapshot();
  });

  it("v5 persona with exemplars", () => {
    expect(
      buildSystemPrompt(v5Persona(), {
        ...OPTIONS,
        exemplarSection: "她上次说：明天再聊。",
      }),
    ).toMatchSnapshot();
  });

  it("v5 persona with memories", () => {
    expect(
      buildSystemPrompt(v5Persona(), {
        ...OPTIONS,
        memorySection: "2022 年在拾光咖啡第一次见面。",
      }),
    ).toMatchSnapshot();
  });

  it("v5 persona with tease, exemplars and memories together", () => {
    expect(
      buildSystemPrompt(v5Persona(), {
        ...OPTIONS,
        sampledAct: "tease",
        exemplarSection: "她上次说：明天再聊。",
        memorySection: "2022 年在拾光咖啡第一次见面。",
      }),
    ).toMatchSnapshot();
  });

  it("relationship that has ended", () => {
    expect(
      buildSystemPrompt(sevenLayerPersona({ togetherTo: "2024-03-01" }), OPTIONS),
    ).toMatchSnapshot();
  });

  it("english persona", () => {
    expect(
      buildSystemPrompt(sevenLayerPersona(), { ...OPTIONS, locale: "en" }),
    ).toMatchSnapshot();
  });
});

describe("the messages a full turn sends the provider", () => {
  const previousTransparency = process.env.PERSONA_AI_TRANSPARENCY;

  beforeEach(() => {
    delete process.env.PERSONA_AI_TRANSPARENCY;
    for (const fn of [
      createMessage,
      getDefaultLlmConfig,
      getTodaySnapshot,
      createEmotionSnapshot,
      getIntimacyData,
      updateIntimacy,
      updatePersona,
      incrementChatCount,
      getPersonaById,
      getMessagesByPersonaId,
      getMemoriesByPersonaId,
      getFilesByPersonaId,
      getSceneById,
      getLatestChatSummary,
      createChatSummary,
      getRecentEmotionTrend,
      getMessageCountInRange,
      setGraduationStatus,
      getLatestGraduationAssessment,
      createGraduationAssessment,
      getMessagesSince,
      getRecentMessages,
      touchMemoryRecalled,
      createSafetyEvent,
      hasSafetyEventSince,
      getLastMessageAt,
      getMessageCountSince,
      getDailyChatCounts,
      getSessionStartAt,
      getUserMessageCountSince,
      getDailyUserChatCounts,
      getUserMessageCountForPersonaSince,
      getCollectedMessagesForPersona,
      getLastExtractionAttemptAt,
      getLastExtractionAt,
      getMessageById,
      updateEmotionSnapshot,
      invoke,
      invokeWithProvider,
      streamWithProvider,
      resolveProviderForUser,
      inferEmotionalState,
    ]) {
      fn.mockReset();
    }

    const stored: Array<Record<string, unknown>> = [];
    createMessage.mockImplementation(async (row: Record<string, unknown>) => {
      const id = stored.length + 1;
      stored.push({
        id,
        origin: "web",
        createdAt: NOW,
        ...row,
      });
      return id;
    });
    getMessagesByPersonaId.mockImplementation(async () => stored);

    getDefaultLlmConfig.mockResolvedValue(null);
    getTodaySnapshot.mockResolvedValue(undefined);
    getIntimacyData.mockResolvedValue({
      chatCount: 10,
      totalMessages: 20,
      memoryCount: 3,
      emotionVariety: 3,
      daysSinceCreation: 100,
      consecutiveDays: 2,
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
    createSafetyEvent.mockResolvedValue(1);
    hasSafetyEventSince.mockResolvedValue(false);
    touchMemoryRecalled.mockResolvedValue(undefined);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    getLastExtractionAttemptAt.mockResolvedValue(NOW);
    getLastExtractionAt.mockResolvedValue(NOW);
    incrementChatCount.mockResolvedValue(11);
    updatePersona.mockResolvedValue(undefined);
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
      stream: async function* () {
        yield { text: "" };
      },
    });
    invokeWithProvider.mockResolvedValue("在的。");
  });

  afterEach(() => {
    if (previousTransparency === undefined) delete process.env.PERSONA_AI_TRANSPARENCY;
    else process.env.PERSONA_AI_TRANSPARENCY = previousTransparency;
  });

  it("is a snapshot of the assembled messages", async () => {
    for await (const _ of runConversation({
      persona: sevenLayerPersona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: NOW,
    })) {
      // drain
    }

    expect(invokeWithProvider).toHaveBeenCalled();
    const request = invokeWithProvider.mock.calls[0][1] as {
      messages: unknown;
    };
    expect(request.messages).toMatchSnapshot();
  });
});

describe("the golden snapshot file", () => {
  it("holds at least nine prompts", () => {
    const snap = readFileSync(
      path.join(__dirname, "__snapshots__", "prompt-golden.test.ts.snap"),
      "utf-8",
    );
    const count = [...snap.matchAll(/^exports\[/gm)].length;
    expect(count).toBeGreaterThanOrEqual(9);
  });
});
