import { describe, expect, it, vi, beforeEach } from "vitest";

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
const getLastClosingMessageAt = vi.fn();
const getUserMessageCountSince = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();
const getDailyUserChatCounts = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
const updateMessageMetadata = vi.fn();
const searchRecordsLexical = vi.fn();
const createFidelityPair = vi.fn();
const clearMessagePendingChoice = vi.fn();
const getMessageById = vi.fn();
const updateEmotionSnapshot = vi.fn();
const purgeMessage = vi.fn();
const iterateRecords = vi.fn();
const listEnabledStickers = vi.fn();
const listMemoryMediaForMemories = vi.fn();
const listRecentlySentPhotoMediaIds = vi.fn();
const generateTTS = vi.fn();
const ttsEngineMock = vi.fn();
const getLastExtractionAttemptAt = vi.fn();
const getLastExtractionAt = vi.fn();
const getRecordsVersion = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const countRecords = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const getWindowsAroundUserRecords = vi.fn();
const createReplyJob = vi.fn();

const storageToDataUrl = vi.fn();
vi.mock("../storage", () => ({
  storageToDataUrl: (...a: unknown[]) => storageToDataUrl(...a),
}));

vi.mock("../db", () => ({
  getRecentCheckinAnswers: vi.fn().mockResolvedValue([]),
  getActiveShareForMemberPersona: (...a: unknown[]) => getActiveShareForMemberPersona(...a),
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
  getLastClosingMessageAt: (...a: unknown[]) => getLastClosingMessageAt(...a),
  getUserMessageCountSince: (...a: unknown[]) => getUserMessageCountSince(...a),
  getUserMessageCountForPersonaSince: (...a: unknown[]) => getUserMessageCountForPersonaSince(...a),
  getDailyUserChatCounts: (...a: unknown[]) => getDailyUserChatCounts(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  updateMessageMetadata: (...a: unknown[]) => updateMessageMetadata(...a),
  searchRecordsLexical: (...a: unknown[]) => searchRecordsLexical(...a),
  createFidelityPair: (...a: unknown[]) => createFidelityPair(...a),
  clearMessagePendingChoice: (...a: unknown[]) => clearMessagePendingChoice(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  updateEmotionSnapshot: (...a: unknown[]) => updateEmotionSnapshot(...a),
  purgeMessage: (...a: unknown[]) => purgeMessage(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  listEnabledStickers: (...a: unknown[]) => listEnabledStickers(...a),
  listMemoryMediaForMemories: (...a: unknown[]) => listMemoryMediaForMemories(...a),
  listRecentlySentPhotoMediaIds: (...a: unknown[]) => listRecentlySentPhotoMediaIds(...a),
  getLastExtractionAttemptAt: (...a: unknown[]) => getLastExtractionAttemptAt(...a),
  getLastExtractionAt: (...a: unknown[]) => getLastExtractionAt(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  getWindowsAroundUserRecords: (...a: unknown[]) => getWindowsAroundUserRecords(...a),
  cancelPendingReplyJobs: vi.fn().mockResolvedValue(0),
  getPendingReplyJob: vi.fn().mockResolvedValue(null),
  createReplyJob: (...a: unknown[]) => createReplyJob(...a),
  getReplyJobById: vi.fn().mockResolvedValue(null),
  listDueReplyJobs: vi.fn().mockResolvedValue([]),
  claimReplyJob: vi.fn().mockResolvedValue(false),
  finishReplyJob: vi.fn().mockResolvedValue(true),
  retryReplyJob: vi.fn().mockResolvedValue(true),
}));

vi.mock("../_core/tts", () => ({
  generateTTS: (...a: unknown[]) => generateTTS(...a),
  ttsEngine: () => ttsEngineMock(),
  DEFAULT_VOICE: "zh-CN-XiaoxiaoNeural",
}));

const invoke = vi.fn();
const invokeWithProvider = vi.fn();
const streamWithProvider = vi.fn();
const resolveProviderForUser = vi.fn();
const resolveProviderForPurpose = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...a: unknown[]) => invoke(...a),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
    streamWithProvider: (...a: unknown[]) => streamWithProvider(...a),
  },
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
  resolveProviderForPurpose: (...a: unknown[]) => resolveProviderForPurpose(...a),
  resolveProviderForPurposeWithOwnership: async (params: unknown) => ({
    provider: await resolveProviderForPurpose(params as any),
    owned: false,
  }),
}));

const inferEmotionalState = vi.fn();
const getActiveShareForMemberPersona = vi.fn();

vi.mock("../_core/emotion", () => ({
  inferEmotionalState: (...a: unknown[]) => inferEmotionalState(...a),
}));

import { copy } from "@shared/copy";
import * as behaviorProfile from "@shared/behavior-profile";
import {
  runConversation,
  commitPendingChoice,
  composeMessages,
  clampContextLimit,
  clampTemperature,
  clampMaxTokens,
} from "./service";
import { CHANNEL_READ_WINDOW_MS, READ_WINDOW_MS, resetInbox } from "./inbox";
import * as rerankModel from "./rerank-model";
import { buildRerankModel } from "./rerank-model";

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    relationshipDesc: "前任",
    togetherFrom: "2021-05",
    togetherTo: null,
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
    ...overrides,
  } as any;
}

describe("runConversation", () => {
  beforeEach(() => {
    resetInbox();
    for (const fn of [
      createMessage, getDefaultLlmConfig, getTodaySnapshot, createEmotionSnapshot,
      getIntimacyData, updateIntimacy, updatePersona, getPersonaById,
      getMessagesByPersonaId, getMemoriesByPersonaId, getFilesByPersonaId, getSceneById,
      getLatestChatSummary, createChatSummary, getRecentEmotionTrend,
      getMessageCountInRange, setGraduationStatus, getLatestGraduationAssessment,
      createGraduationAssessment, getMessagesSince, getRecentMessages, touchMemoryRecalled, createSafetyEvent,
      getLastMessageAt, getMessageCountSince, getDailyChatCounts,
      getSessionStartAt, getUserMessageCountSince, getDailyUserChatCounts, hasSafetyEventSince,
      incrementChatCount, updateMessageMetadata, createFidelityPair, clearMessagePendingChoice,
      getMessageById, updateEmotionSnapshot, searchRecordsLexical, purgeMessage,
      iterateRecords, getRecordsVersion, getCollectedMessagesForPersona, listEnabledStickers,
      countRecords, candidateRecordsByOverlap, getWindowsAroundUserRecords,
      listMemoryMediaForMemories, listRecentlySentPhotoMediaIds,
      getLastExtractionAttemptAt, getLastExtractionAt, generateTTS, ttsEngineMock,
      invoke, invokeWithProvider,
      streamWithProvider, resolveProviderForUser, resolveProviderForPurpose, inferEmotionalState,
    ]) {
      fn.mockReset();
    }

    getDefaultLlmConfig.mockResolvedValue(null);
    getTodaySnapshot.mockResolvedValue(undefined);
    getIntimacyData.mockResolvedValue({
      chatCount: 10, totalMessages: 20, memoryCount: 3,
      emotionVariety: 3, daysSinceCreation: 100, consecutiveDays: 2,
    });
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    listMemoryMediaForMemories.mockResolvedValue([]);
    listRecentlySentPhotoMediaIds.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getLatestChatSummary.mockResolvedValue(undefined);
    getRecentEmotionTrend.mockResolvedValue([]);
    getMessageCountInRange.mockResolvedValue(0);
    getLatestGraduationAssessment.mockResolvedValue(undefined);
    createGraduationAssessment.mockResolvedValue(1);
    getMessagesSince.mockResolvedValue([]);
    getRecentMessages.mockResolvedValue([]);
    getLastMessageAt.mockResolvedValue(new Date());
    getMessageCountSince.mockResolvedValue(1);
    getDailyChatCounts.mockResolvedValue([]);
    getSessionStartAt.mockResolvedValue(new Date());
    getLastClosingMessageAt.mockResolvedValue(null);
    getUserTimezone.mockResolvedValue(null);
    /**
     * The user, with the trajectory assessment on "auto".
     *
     * The read used to answer "nothing" here — and "nothing" used to
     * mean "allowed", so the gate that decides whether a month of the
     * user's private conversation may go to the model was open in every
     * test that used it.
     */
    getUserById.mockResolvedValue({ id: 1, trajectoryAssessment: "auto" });
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    getUserMessageCountSince.mockResolvedValue(1);
    getUserMessageCountForPersonaSince.mockResolvedValue(1);
    getDailyUserChatCounts.mockResolvedValue([]);
    createMessage.mockResolvedValue(99);
    createSafetyEvent.mockResolvedValue(1);
    // Nothing has been said yet today.
    hasSafetyEventSince.mockResolvedValue(false);
    touchMemoryRecalled.mockResolvedValue(undefined);
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke: invoke,
      stream: async function* () {
        yield { text: "" };
      },
    });
    resolveProviderForPurpose.mockImplementation((...a: unknown[]) => resolveProviderForUser(...a));
    invokeWithProvider.mockResolvedValue("在的。");
    updateMessageMetadata.mockResolvedValue(true);
    searchRecordsLexical.mockResolvedValue([]);
    createFidelityPair.mockResolvedValue({ id: 1 });
    clearMessagePendingChoice.mockResolvedValue(true);
    incrementChatCount.mockResolvedValue(11);
    getMessageById.mockResolvedValue(null);
    updateEmotionSnapshot.mockResolvedValue(undefined);
    purgeMessage.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* (): AsyncGenerator<unknown> {});
    getRecordsVersion.mockResolvedValue("0:0");
    getCollectedMessagesForPersona.mockResolvedValue([]);
    countRecords.mockResolvedValue(0);
    candidateRecordsByOverlap.mockResolvedValue([]);
    getWindowsAroundUserRecords.mockResolvedValue(new Map());
    listEnabledStickers.mockResolvedValue([]);
    getLastExtractionAttemptAt.mockResolvedValue(null);
    getLastExtractionAt.mockResolvedValue(null);
    generateTTS.mockResolvedValue("/uploads/tts/1/voice.mp3");
    ttsEngineMock.mockReturnValue("edge");
  });

  it("stores the user's turn and the persona's reply", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(createMessage).toHaveBeenCalledTimes(2);
    const [userCall, assistantCall] = createMessage.mock.calls;
    expect(userCall[0].role).toBe("user");
    expect(userCall[0].content).toBe("在吗");
    expect(assistantCall[0].role).toBe("assistant");
    expect(assistantCall[0].content).toContain("在的。");

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
  });

  it("reads no whole history on a turn once every row is indexed (C8.7)", async () => {
    const at = new Date("2022-03-01T12:00:00.000Z");
    countRecords.mockImplementation(async (_personaId: number, _userId: number, options: { tokensMissing?: boolean } = {}) =>
      options.tokensMissing ? 0 : 10,
    );
    candidateRecordsByOverlap.mockResolvedValue([
      { id: 11, content: "在吗", timestamp: at, coverage: 1 },
    ]);
    const candidate = {
      id: 11,
      userId: 1,
      personaId: 1,
      source: "generic",
      role: "user",
      content: "在吗",
      timestamp: at,
      createdAt: at,
      kind: "text",
      speaker: "阿树",
      meta: null,
    };
    const reply = {
      ...candidate,
      id: 12,
      role: "assistant",
      content: "在的呀",
      speaker: "小A",
    };
    getWindowsAroundUserRecords.mockResolvedValue(
      new Map([[11, { candidate, before: [], after: [reply] }]]),
    );

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === "done")).toBe(true);
    expect(getCollectedMessagesForPersona).toHaveBeenCalledTimes(0);
    expect(iterateRecords).toHaveBeenCalledTimes(0);
    expect(candidateRecordsByOverlap).toHaveBeenCalled();
  });

  it("checks on the person once, not once per message", async () => {
    /**
     * The record was made once a day — but the check-in was appended to
     * the reply every time, so a person who said "我好累" in three
     * messages in a row was checked on three times in a row, in the
     * same words. It reads as a script the app is reading out, and it
     * is the exact opposite of what it means to be checked on.
     */
    hasSafetyEventSince.mockResolvedValue(true);

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我好累",
      mode: "once",
    })) {
      events.push(event);
    }

    const text = events
      .filter((e) => e.type === "delta")
      .map((e: any) => e.text)
      .join("");
    expect(text).not.toContain("我在这儿");
    // The persona still answers.
    expect(text).toContain("在的。");
  });

  it("checks on the person the first time they say it today", async () => {
    hasSafetyEventSince.mockResolvedValue(false);

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我好累",
      mode: "once",
    })) {
      events.push(event);
    }

    const text = events
      .filter((e) => e.type === "delta")
      .map((e: any) => e.text)
      .join("");
    expect(text).toContain("我在这儿");
  });

  it("does not count a turn that failed as a conversation", async () => {
    // A provider that is having a bad day must not walk the user towards
    // the graduation ritual: the message count is one of its gates.
    invokeWithProvider.mockRejectedValue(new Error("the provider is down"));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    // The error is reported.
    expect(events.some((e) => e.type === "error")).toBe(true);
    // The user's turn is still stored — they did send it.
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createMessage.mock.calls[0][0].role).toBe("user");
    // Nothing was counted.
    expect(updatePersona).not.toHaveBeenCalled();
    expect(updateIntimacy).not.toHaveBeenCalled();
    expect(createEmotionSnapshot).not.toHaveBeenCalled();
  });

  it("keeps the half of a reply that arrived before the failure", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在的" };
      throw new Error("the connection dropped");
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    // The user saw the half, so the transcript has to have it — or the
    // next poll would wipe it off the screen.
    const assistantCall = createMessage.mock.calls.find(
      (call: any[]) => call[0].role === "assistant",
    );
    expect(assistantCall?.[0].content).toContain("在的");
    // But it is still not a counted conversation.
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("never calls the model when the message is a crisis", async () => {    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(invokeWithProvider).not.toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(true);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("12356");
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("answers a crisis on the API channel and records it (C9.2)", async () => {
    let reply = "";
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我不想活了",
      mode: "once",
      channel: "api",
    })) {
      if (event.type === "delta") reply += event.text;
    }
    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(reply).toContain("12356");
    const assistantCall = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content?: string; channel?: string };
    expect(assistantCall.channel).toBe("api");
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("stops a shared persona whose invitation was revoked (C7.2)", async () => {
    getActiveShareForMemberPersona.mockResolvedValue(undefined);
    let message = "";
    try {
      for await (const _event of runConversation({
        persona: persona({ sharedFromPersonaId: 5, sharedFromUserId: 1 }),
        userId: 1,
        message: "在吗",
        mode: "once",
      })) {
        // no events: the turn is refused before anything is stored
      }
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(copy("zh", "chat.revoked"));
    expect(getActiveShareForMemberPersona).toHaveBeenCalledWith(expect.any(Number), 1);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("keeps the crisis path for a memorial persona, in its own words (C7.1)", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona({ settings: { mode: "memorial" } }),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(events.find((event) => event.type === "done")?.crisis).toBe(true);
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content?: string };
    expect(assistant.content).toContain(copy("zh", "safety.crisisStop.memorial"));
    expect(assistant.content).not.toContain(copy("zh", "safety.crisisStop"));
    expect(assistant.content).toContain("12356");
  });

  it("answers a ritual without judging emotion, and counts the turn", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          rituals: [
            {
              trigger: "晚安",
              variants: ["晚安"],
              n: 100,
              coverage: 1,
              replies: [
                { text: "晚安", n: 60, recordId: 11 },
                { text: "安", n: 25, recordId: 12 },
                { text: "睡啦", n: 15, recordId: 13 },
              ],
            },
          ],
        },
      }),
      userId: 1,
      message: "晚安",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(inferEmotionalState).not.toHaveBeenCalled();
    expect(incrementChatCount).toHaveBeenCalled();
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content: string; metadata?: { ritual?: string; verbatim?: unknown } };
    expect(["晚安", "安", "睡啦"]).toContain(assistant.content);
    expect(assistant.metadata?.ritual).toBe("晚安");
    expect(assistant.metadata?.verbatim).toEqual({
      type: "ritual",
      recordId: expect.any(Number),
    });
    expect(events.some((event) => event.type === "emotion" && event.state === "warm")).toBe(true);
  });

  it("marks a fixed reply as the record's own words (C10.7)", async () => {
    candidateRecordsByOverlap.mockImplementation(async (
      _personaId: number,
      _userId: number,
      params: { text: string },
    ) => [{
      id: 11,
      content: params.text,
      timestamp: new Date("2023-03-04T12:00:00.000Z"),
      role: "assistant",
      speaker: "小满",
      coverage: 1,
    }]);
    for await (const _ of runConversation({
      persona: persona({
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          rituals: [
            {
              trigger: "晚安",
              variants: ["晚安"],
              n: 100,
              coverage: 1,
              replies: [
                { text: "晚安", n: 60, recordId: 11 },
                { text: "安", n: 25, recordId: 12 },
                { text: "睡啦", n: 15, recordId: 13 },
              ],
            },
          ],
        },
      }),
      userId: 1,
      message: "晚安",
      mode: "once",
    })) {
      // Drain the generator.
    }
    const marked = updateMessageMetadata.mock.calls.find(
      (call: unknown[]) => (call[3] as { provenance?: unknown[] } | undefined)?.provenance,
    );
    expect(marked).toBeTruthy();
    const provenance = (marked![3] as { provenance: Array<{ start: number; end: number; recordId: number }> }).provenance;
    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.start).toBe(0);
    expect(provenance[0]!.recordId).toBe(11);
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content: string };
    expect(provenance[0]!.end).toBe(assistant.content.length);
    // The check is literal: it never calls the model.
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("marks only the sentence a model reply really repeated (C10.7)", async () => {
    invokeWithProvider.mockResolvedValue("今天下雨了。我想你了。晚安");
    candidateRecordsByOverlap.mockImplementation(async (
      _personaId: number,
      _userId: number,
      params: { text: string },
    ) => (params.text.replace(/。$/, "") === "我想你了"
      ? [{ id: 12, content: "我想你了", timestamp: new Date("2023-03-04T12:00:00.000Z"), role: "assistant", speaker: "小满", coverage: 1 }]
      : []));
    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // Drain the generator.
    }
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content: string };
    expect(assistant.content).toBe("今天下雨了。我想你了。晚安");
    const marked = updateMessageMetadata.mock.calls.find(
      (call: unknown[]) => (call[3] as { provenance?: unknown[] } | undefined)?.provenance,
    );
    const provenance = (marked![3] as { provenance: Array<{ start: number; end: number; recordId: number }> }).provenance;
    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.start).toBe(assistant.content.indexOf("我想你了"));
    expect(provenance[0]!.recordId).toBe(12);
    // One model call for the reply, none for the provenance check.
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("stores the reply normally when the provenance check fails (C10.7)", async () => {
    invokeWithProvider.mockResolvedValue("在的呀");
    candidateRecordsByOverlap.mockRejectedValue(new Error("the records table is down"));
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === "done")).toBe(true);
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { content: string };
    expect(assistant.content).toBe("在的呀");
    // A failed check marks nothing; it does not fail the message.
    expect(
      updateMessageMetadata.mock.calls.some(
        (call: unknown[]) => (call[3] as { provenance?: unknown[] } | undefined)?.provenance,
      ),
    ).toBe(false);
  });

  it("keeps a distant stretch that has only lasted 30 minutes", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        emotionalState: "distant",
        emotionalStateSince: new Date(now.getTime() - 30 * 60_000),
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          emotionDynamics: {
            transitions: { distant: { distant: 20, happy: 1, warm: 1 } },
            dwell: { distant: { medianMin: 300, p75Min: 360, episodes: 6 } },
            modal: "warm",
            samples: 40,
          },
        },
      }),
      userId: 1,
      message: "吃饭了吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as {
      emotionalState?: string;
      metadata?: { emotion?: { proposed?: string; kept?: boolean } };
    };
    expect(assistant.emotionalState).toBe("distant");
    expect(assistant.metadata?.emotion).toEqual({
      proposed: "happy",
      kept: true,
      reason: "inertia",
    });
    expect(events.some((event) => event.type === "emotion" && event.state === "distant")).toBe(true);
  });

  /**
   * The sticker, after the words (B7.1).
   *
   * The mood is known before the sticker is chosen, and the rate comes
   * from the measured profile. These tests set the rate to 1 so the
   * draw always lands, and to 0 where the state must not send one.
   */
  const STICKER_PROFILE = {
    version: 1,
    measuredAt: "2026-01-15T12:00:00.000Z",
    recordsVersion: "100:100",
    stickers: {
      samples: 20,
      rate: 1,
      soloRate: 0,
      byState: {
        happy: { rate: 1, turns: 40, top: [{ key: "狗狗探头", n: 12 }] },
        distant: { rate: 0, turns: 40, top: [] },
      },
      runs: { one: 20, two: 0, threePlus: 0 },
    },
  };

  /**
   * The voice note (B7.4).
   *
   * The frequency is the measured one; the length bound is the
   * measured p90. These tests set the rate to 1 so the draw lands.
   */
  const VOICE_PROFILE = {
    version: 1,
    measuredAt: "2026-01-15T12:00:00.000Z",
    recordsVersion: "100:100",
    voice: {
      samples: 20,
      rate: 1,
      durationSec: { median: 12, p90: 20 },
      byState: { warm: { rate: 1, turns: 80 } },
      afterMyVoiceRate: 0.4,
    },
  };

  it("sends a short reply as a voice note when the record says they do", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        emotionalState: "warm",
        styleProfile: VOICE_PROFILE,
        settings: { layers: { voiceNotes: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      events.push(event);
    }

    const assistant = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      content: "在的。",
      messageType: "voice",
      mediaUrl: "/uploads/tts/1/voice.mp3",
      mediaDuration: 1,
      metadata: { kind: "voice-note" },
    });
    expect(generateTTS).toHaveBeenCalledTimes(1);
    // The words are not streamed first and turned into audio later.
    expect(events.filter((event) => event.type === "delta")).toHaveLength(0);
    const done = events.find((event) => event.type === "done") as any;
    expect(done.voice).toEqual({
      url: "/uploads/tts/1/voice.mp3",
      durationSec: 1,
      content: "在的。",
    });
  });

  it("does not send a text delta for a voice note when timing is on", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    const events = [];
    for await (const event of runConversation({
      persona: timedPersona({
        styleProfile: VOICE_PROFILE,
        settings: { layers: { voiceNotes: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      events.push(event);
    }
    expect(events.filter((event) => event.type === "delta")).toHaveLength(0);
    expect(events.filter((event) => event.type === "burst")).toHaveLength(0);
    const done = events.find((event) => event.type === "done") as any;
    expect(done.voice.content).toBe("在的。");
  });

  it("falls back to a text delta when the voice note cannot be synthesized", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    generateTTS.mockRejectedValueOnce(new Error("the speech engine is offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        emotionalState: "warm",
        styleProfile: VOICE_PROFILE,
        settings: { layers: { voiceNotes: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      events.push(event);
    }
    const done = events.find((event) => event.type === "done") as any;
    expect(done.voice).toBeUndefined();
    expect(events.filter((event) => event.type === "delta").map((event: any) => event.text).join(""))
      .toBe("在的。");
    const assistant = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.role === "assistant");
    expect(assistant[0]?.messageType).toBeUndefined();
    expect(assistant[0]?.content).toBe("在的。");
    warn.mockRestore();
  });

  it("keeps a long reply as text, and does not synthesise it", async () => {
    invokeWithProvider.mockResolvedValue("好".repeat(200));
    for await (const _event of runConversation({
      persona: persona({
        emotionalState: "warm",
        styleProfile: VOICE_PROFILE,
        settings: { layers: { voiceNotes: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(generateTTS).not.toHaveBeenCalled();
    const assistant = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.role === "assistant");
    expect(assistant[0]?.messageType).toBeUndefined();
  });

  it("does not make a voice note when the switch is off or playback is off", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    for await (const _event of runConversation({
      persona: persona({ emotionalState: "warm", styleProfile: VOICE_PROFILE }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(generateTTS).not.toHaveBeenCalled();

    ttsEngineMock.mockReturnValue("off");
    for await (const _event of runConversation({
      persona: persona({
        emotionalState: "warm",
        styleProfile: VOICE_PROFILE,
        settings: { layers: { voiceNotes: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(generateTTS).not.toHaveBeenCalled();
  });

  it("sends the sticker the record says they send, after the words", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    listEnabledStickers.mockResolvedValue([
      { id: 41, key: "label:狗狗探头", label: "狗狗探头", fileKey: null, enabled: true },
    ]);
    const events = [];
    for await (const event of runConversation({
      persona: persona({ styleProfile: STICKER_PROFILE }),
      userId: 1,
      message: "今天好开心",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      events.push(event);
    }

    const stored = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.metadata?.kind === "sticker");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      content: "[sticker:狗狗探头]",
      role: "assistant",
      emotionalState: "happy",
      metadata: { kind: "sticker", stickerId: 41 },
    });
    // The sticker is a separate message after the reply, not a field on
    // it: it has to be the last message written in this turn.
    const lastWrite = createMessage.mock.calls[createMessage.mock.calls.length - 1]?.[0] as
      | Record<string, any>
      | undefined;
    expect(lastWrite?.metadata?.kind).toBe("sticker");
    const done = events.find((event) => event.type === "done") as any;
    expect(done.extra).toEqual([
      { messageId: 99, kind: "sticker", content: "狗狗探头" },
    ]);
  });

  /**
   * The photo, after the words (B7.9).
   *
   * It is only the real picture attached to a memory the reply
   * recalled, never a generated image, and never the same one twice
   * within a month.
   */
  const PHOTO_PROFILE = {
    version: 1,
    measuredAt: "2026-01-15T12:00:00.000Z",
    recordsVersion: "100:100",
    photos: {
      samples: 20,
      rate: 1,
      byState: {
        happy: { rate: 1, turns: 40 },
        distant: { rate: 0, turns: 40 },
      },
    },
  };

  const RECALLED_MEMORY = {
    id: 42,
    personaId: 1,
    userId: 1,
    title: "第一次见面",
    description: "在拾光咖啡",
    category: "memory",
    date: "2022-04-02",
    messageId: null,
    importance: 1,
    isPinned: false,
    lastRecalledAt: null,
    factKey: null,
    createdAt: new Date(),
  };

  function recalledPhoto() {
    return [
      {
        memoryId: 42,
        mediaId: 11,
        kind: "photo",
        fileKey: "personas/1/1/imports/1/a.jpg",
        at: new Date("2022-04-02T04:00:00.000Z"),
        width: 4,
        height: 4,
      },
    ];
  }

  it("sends the real photo attached to a recalled memory", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    invokeWithProvider.mockResolvedValue("在的。");
    getMemoriesByPersonaId.mockResolvedValue([RECALLED_MEMORY]);
    listMemoryMediaForMemories.mockResolvedValue(recalledPhoto());
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        styleProfile: PHOTO_PROFILE,
        settings: { layers: { photos: true } },
      }),
      userId: 1,
      message: "还记得我们第一次见面吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      events.push(event);
    }

    const stored = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.metadata?.kind === "photo");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      content: "[image]",
      role: "assistant",
      messageType: "image",
      mediaUrl: "/uploads/personas/1/1/imports/1/a.jpg",
      metadata: {
        kind: "photo",
        mediaId: 11,
        photoAt: "2022-04-02T04:00:00.000Z",
      },
    });
    const done = events.find((event) => event.type === "done") as any;
    expect(done.extra).toContainEqual({
      messageId: 99,
      kind: "photo",
      content: "[image]",
      mediaUrl: "/uploads/personas/1/1/imports/1/a.jpg",
      photoAt: "2022-04-02T04:00:00.000Z",
    });
  });

  it("does not send a photo when nothing is attached to the recalled memories", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    invokeWithProvider.mockResolvedValue("在的。");
    getMemoriesByPersonaId.mockResolvedValue([RECALLED_MEMORY]);
    for await (const _event of runConversation({
      persona: persona({
        styleProfile: PHOTO_PROFILE,
        settings: { layers: { photos: true } },
      }),
      userId: 1,
      message: "还记得我们第一次见面吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "photo"),
    ).toHaveLength(0);
  });

  it("does not send the same photo twice within thirty days", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    invokeWithProvider.mockResolvedValue("在的。");
    getMemoriesByPersonaId.mockResolvedValue([RECALLED_MEMORY]);
    listMemoryMediaForMemories.mockResolvedValue(recalledPhoto());
    listRecentlySentPhotoMediaIds.mockResolvedValue([11]);
    for await (const _event of runConversation({
      persona: persona({
        styleProfile: PHOTO_PROFILE,
        settings: { layers: { photos: true } },
      }),
      userId: 1,
      message: "还记得我们第一次见面吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(listRecentlySentPhotoMediaIds).toHaveBeenCalledWith(
      1,
      1,
      new Date("2025-12-16T12:00:00.000Z"),
    );
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "photo"),
    ).toHaveLength(0);
  });

  it("does not send a photo when the switch is off or on a channel", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    invokeWithProvider.mockResolvedValue("在的。");
    getMemoriesByPersonaId.mockResolvedValue([RECALLED_MEMORY]);
    listMemoryMediaForMemories.mockResolvedValue(recalledPhoto());
    for await (const _event of runConversation({
      persona: persona({ styleProfile: PHOTO_PROFILE }),
      userId: 1,
      message: "还记得我们第一次见面吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    for await (const _event of runConversation({
      persona: persona({
        styleProfile: PHOTO_PROFILE,
        settings: { layers: { photos: true } },
      }),
      userId: 1,
      message: "还记得我们第一次见面吗",
      mode: "once",
      channel: "wechat",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "photo"),
    ).toHaveLength(0);
  });

  it("does not put the photo itself into the next model request", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        role: "user",
        content: "还记得我们第一次见面吗",
        messageType: "text",
        createdAt: new Date(),
      },
      {
        id: 2,
        personaId: 1,
        userId: 1,
        role: "assistant",
        content: "[image]",
        messageType: "image",
        mediaUrl: "/uploads/personas/1/1/imports/1/a.jpg",
        metadata: { kind: "photo", mediaId: 11 },
        createdAt: new Date(),
      },
    ]);
    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });
    const sent = JSON.stringify(messages);
    expect(sent).not.toContain("image_url");
    expect(sent).not.toContain("/imports/1/a.jpg");
    expect(sent).toContain("［图片］");
  });

  it("shows a sticker to the model as words, not as the token or a picture", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        role: "assistant",
        content: "[sticker:狗狗探头]",
        messageType: "text",
        mediaUrl: "/uploads/personas/1/1/stickers/abc.png",
        metadata: { kind: "sticker", stickerId: 41 },
        createdAt: new Date("2026-01-15T11:59:00.000Z"),
        origin: null,
      },
    ]);
    for await (const _event of runConversation({
      persona: persona({ styleProfile: STICKER_PROFILE }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    const sent = JSON.stringify(invokeWithProvider.mock.calls[0]![1]);
    expect(sent).toContain("［表情：狗狗探头］");
    expect(sent).not.toContain("[sticker:");
    expect(sent).not.toContain("/stickers/abc.png");
  });

  it("does not send a sticker in a mood that never has one", async () => {
    inferEmotionalState.mockResolvedValue({ state: "distant", source: "heuristic" });
    listEnabledStickers.mockResolvedValue([
      { id: 41, key: "label:狗狗探头", label: "狗狗探头", fileKey: null, enabled: true },
    ]);
    for await (const _event of runConversation({
      persona: persona({ styleProfile: STICKER_PROFILE }),
      userId: 1,
      message: "嗯",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    const stored = createMessage.mock.calls
      .map((call: unknown[]) => call[0] as Record<string, any>)
      .filter((data) => data?.metadata?.kind === "sticker");
    expect(stored).toHaveLength(0);
  });

  it("does not send a sticker when every one is turned off or the switch is off", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    listEnabledStickers.mockResolvedValue([]);
    for await (const _event of runConversation({
      persona: persona({ styleProfile: STICKER_PROFILE }),
      userId: 1,
      message: "今天好开心",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "sticker"),
    ).toHaveLength(0);

    listEnabledStickers.mockResolvedValue([
      { id: 41, key: "label:狗狗探头", label: "狗狗探头", fileKey: null, enabled: true },
    ]);
    for await (const _event of runConversation({
      persona: persona({
        styleProfile: STICKER_PROFILE,
        settings: { layers: { stickers: false } },
      }),
      userId: 1,
      message: "今天好开心",
      mode: "once",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "sticker"),
    ).toHaveLength(0);
  });

  it("does not send a sticker on a channel", async () => {
    inferEmotionalState.mockResolvedValue({ state: "happy", source: "heuristic" });
    listEnabledStickers.mockResolvedValue([
      { id: 41, key: "label:狗狗探头", label: "狗狗探头", fileKey: null, enabled: true },
    ]);
    for await (const _event of runConversation({
      persona: persona({ styleProfile: STICKER_PROFILE }),
      userId: 1,
      message: "今天好开心",
      mode: "once",
      channel: "wechat",
      now: new Date("2026-01-15T12:00:00.000Z"),
    })) {
      // drained
    }
    expect(
      createMessage.mock.calls
        .map((call: unknown[]) => call[0] as Record<string, any>)
        .filter((data) => data?.metadata?.kind === "sticker"),
    ).toHaveLength(0);
  });

  it("writes a decayed mood back before the reply is planned", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    for await (const _event of runConversation({
      persona: persona({
        emotionalState: "distant",
        emotionalStateSince: new Date(now.getTime() - 400 * 60_000),
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          emotionDynamics: {
            transitions: { distant: { distant: 20, warm: 4 } },
            dwell: { distant: { medianMin: 300, p75Min: 360, episodes: 6 } },
            modal: "warm",
            samples: 40,
          },
        },
      }),
      userId: 1,
      message: "吃饭了吗",
      mode: "once",
      now,
    })) {
      // drain
    }
    expect(updatePersona).toHaveBeenCalledWith(
      1,
      1,
      expect.objectContaining({
        emotionalState: "warm",
        emotionalStateSince: now,
      }),
    );
  });

  it("keeps the crisis path even when a ritual table is present", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          rituals: [
            {
              trigger: "晚安",
              variants: ["晚安"],
              n: 100,
              coverage: 1,
              replies: [{ text: "晚安", n: 100, recordId: 11 }],
            },
          ],
        },
      }),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "done")?.crisis).toBe(true);
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { metadata?: { ritual?: string } };
    expect(assistant.metadata?.ritual).toBeUndefined();
  });

  it("keeps the crisis path when the message also contains a ritual trigger", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        styleProfile: {
          version: 1,
          measuredAt: "2026-01-15T12:00:00.000Z",
          recordsVersion: "100:100",
          rituals: [
            {
              trigger: "晚安",
              variants: ["晚安"],
              n: 100,
              coverage: 1,
              replies: [{ text: "晚安", n: 100, recordId: 11 }],
            },
          ],
        },
      }),
      userId: 1,
      message: "晚安 我不想活了",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "done")?.crisis).toBe(true);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    )?.[0] as { metadata?: { ritual?: string } };
    expect(assistant.metadata?.ritual).toBeUndefined();
  });

  it("streams the reply, then writes claim metadata", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "上次去拾光咖啡那天你迟到了" };
    });
    searchRecordsLexical.mockResolvedValue([
      {
        id: 12,
        content: "拾光咖啡第一次见面",
        timestamp: new Date("2022-03-12T04:00:00Z"),
        coverage: 1,
      },
    ]);

    const deltas: string[] = [];
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).toBe("上次去拾光咖啡那天你迟到了");
    expect(events.find((event) => event.type === "done")).toBeTruthy();
    expect(updateMessageMetadata).toHaveBeenCalledWith(
      99,
      1,
      1,
      expect.objectContaining({
        claims: expect.arrayContaining([
          expect.objectContaining({ text: "拾光咖啡", supported: true, source: expect.objectContaining({ type: "record", id: 12 }) }),
        ]),
      }),
    );
  });

  it("supports a place that is only in the recalled memory's description", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 9,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在拾光咖啡",
        category: "memory",
        date: "2022-03-12",
        subject: "them",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        mentionCount: 1,
        createdAt: new Date("2022-03-12T04:00:00Z"),
      },
    ]);
    searchRecordsLexical.mockResolvedValue([]);
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "我们去了拾光咖啡" };
    });
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "第一次见面",
      mode: "stream",
    })) {
      events.push(event);
    }
    expect(events.find((event) => event.type === "done")).toBeTruthy();
    expect(updateMessageMetadata).toHaveBeenCalledWith(
      99,
      1,
      1,
      expect.objectContaining({
        claims: expect.arrayContaining([
          expect.objectContaining({
            text: "拾光咖啡",
            supported: true,
            /**
             * The day the memory happened, not only its id.
             *
             * The bubble writes 「「拾光咖啡」— 记录里有（{{date}}）」, and
             * the memory was assembled for the fact check with its
             * title and description only — so the source arrived
             * without a day and the bubble showed an empty pair of
             * brackets.
             */
            source: expect.objectContaining({
              type: "memory",
              id: 9,
              at: "2022-03-12",
            }),
          }),
        ]),
      }),
    );
    // The live stream hands the same claim to the bubble it renders.
    const done = events.find((event) => event.type === "done") as
      | { claims?: Array<{ text: string; source?: { at?: string } }> }
      | undefined;
    expect(done?.claims?.find((row) => row.text === "拾光咖啡")?.source).toEqual({
      type: "memory",
      id: 9,
      at: "2022-03-12",
    });
  });

  it("still replies when the fact check throws", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "上次去拾光咖啡那天你迟到了" };
    });
    searchRecordsLexical.mockRejectedValue(new Error("the table is gone"));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "error")).toBeUndefined();
    expect(events.find((event) => event.type === "done")).toBeTruthy();
    const assistant = createMessage.mock.calls.find(
      (call: unknown[]) => (call[0] as { role?: string }).role === "assistant",
    );
    expect(assistant).toBeTruthy();
  });

  it("streams the reply in pieces", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      yield { text: "的" };
    });

    const deltas: string[] = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).toBe("在的");
  });

  it("keeps a partial answer when the model fails mid-stream", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      throw new Error("upstream exploded");
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }

    const error = events.find((e) => e.type === "error");
    expect(error?.partial).toBe(true);
    // The partial reply is still stored.
    expect(createMessage.mock.calls[1][0].content).toContain("在");
  });

  it("updates the intimacy score and the persona's state", async () => {
    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(updateIntimacy).toHaveBeenCalled();
    expect(updatePersona).toHaveBeenCalled();
  });

  it("hands the classify provider to the emotion classifier", async () => {
    // Cheap work uses the classify role. A user who configured their
    // own key still never falls back to the environment one — that
    // rule lives in the resolver.
    const classifyProvider = {
      name: "ClassifyProvider",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
    };
    resolveProviderForPurpose.mockResolvedValue(classifyProvider);

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      // drain
    }

    expect(inferEmotionalState).toHaveBeenCalled();
    expect(inferEmotionalState.mock.calls[0][0].providerInstance).toBe(classifyProvider);
    expect(resolveProviderForPurpose).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, purpose: "classify" }),
    );
  });

  it("measures the conversation length from the start of the session", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    // The conversation began three hours ago and has not paused. The old
    // measurement was the gap before the newest message, so it fired for a
    // user who came back after a break and stayed quiet for a five-hour
    // conversation.
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.kind).toBe("long_session");
  });

  it("lets them close a long session themselves instead of appending the care note", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        timezone: "Asia/Shanghai",
        styleProfile: {
          version: 1,
          measuredAt: now.toISOString(),
          recordsVersion: "80:80",
          sessions: {
            scenes: 30,
            lengthMin: { median: 15, p90: 40 },
            closeByThemRate: 0.8,
            closers: [{ text: "晚安", n: 20 }],
          },
        },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }
    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.kind).toBe("long_session");
    expect(done?.careNote?.text).toBe("");
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].content).not.toContain(copy("zh", "labels.care.longSession"));
    expect(stored?.[0].metadata?.closing).toBe(true);
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("closes the night before the measured hour, and keeps the system line out (C10.5)", async () => {
    // 02:30 in Shanghai; the persona's measured p90 is four hours, so
    // nothing but the hour itself would have closed this session.
    const now = new Date("2026-01-14T18:30:00Z");
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));
    const events = [];
    for await (const event of runConversation({
      persona: persona({
        timezone: "Asia/Shanghai",
        styleProfile: {
          version: 1,
          measuredAt: now.toISOString(),
          recordsVersion: "80:80",
          sessions: {
            scenes: 30,
            lengthMin: { median: 120, p90: 240 },
            closeByThemRate: 0.8,
            closers: [{ text: "晚安", n: 20 }],
          },
        },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }
    const done = events.find((e) => e.type === "done");
    // The turn is a closing, so the system's long-session line is not
    // spoken — but the event is still recorded.
    expect(done?.careNote?.kind).toBe("long_session");
    expect(done?.careNote?.text).toBe("");
    expect((done as { lateNight?: boolean } | undefined)?.lateNight).toBe(true);
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].metadata?.closing).toBe(true);
    expect(stored?.[0].content).not.toContain(copy("zh", "labels.care.longSession"));
    expect(createSafetyEvent).toHaveBeenCalled();
  });

  it("leaves the system line in when there is no closing habit to fall back on (C10.5)", async () => {
    const now = new Date("2026-01-14T18:30:00Z");
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));
    const events = [];
    for await (const event of runConversation({
      persona: persona({ timezone: "Asia/Shanghai" }),
      userId: 1,
      message: "在吗",
      mode: "once",
      now,
    })) {
      events.push(event);
    }
    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.kind).toBe("long_session");
    expect(done?.careNote?.text).toBeTruthy();
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].metadata?.closing).toBeUndefined();
    expect(stored?.[0].content).toContain(copy("zh", "labels.care.longSession"));
  });

  it("says the system line once when the night carries on after the closing (C10.5)", async () => {
    const closingAt = new Date("2026-01-14T18:20:00Z"); // 02:20 Shanghai
    const sessionStart = new Date(closingAt.getTime() - 60 * 60 * 1000);
    const closingHabit = {
      timezone: "Asia/Shanghai",
      styleProfile: {
        version: 1,
        measuredAt: closingAt.toISOString(),
        recordsVersion: "80:80",
        sessions: {
          scenes: 30,
          lengthMin: { median: 30, p90: 240 },
          closeByThemRate: 0.8,
          closers: [{ text: "晚安", n: 20 }],
        },
      },
    };
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getSessionStartAt.mockResolvedValue(sessionStart);

    // The turn that closes: an hour in, and it is past two in the morning.
    getMessagesSince.mockResolvedValue([]);
    getLastClosingMessageAt.mockResolvedValue(null);
    const first = [];
    for await (const event of runConversation({
      persona: persona(closingHabit),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: closingAt,
    })) {
      first.push(event);
    }
    const storedClosing = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(storedClosing?.[0].metadata?.closing).toBe(true);

    // Half an hour later the user is still there. The closing is already
    // in this session and the system says its own line once.
    const later = new Date(closingAt.getTime() + 35 * 60 * 1000);
    getMessagesSince.mockResolvedValue([
      {
        id: 1,
        role: "assistant",
        content: "晚安",
        createdAt: closingAt,
        metadata: { closing: true },
        origin: null,
      },
    ]);
    getLastClosingMessageAt.mockResolvedValue(closingAt);
    createMessage.mockClear();
    const second = [];
    for await (const event of runConversation({
      persona: persona(closingHabit),
      userId: 1,
      message: "再聊会儿",
      mode: "once",
      now: later,
    })) {
      second.push(event);
    }
    const doneSecond = second.find((e) => e.type === "done");
    expect(doneSecond?.careNote?.kind).toBe("long_session");
    expect(doneSecond?.careNote?.text).toBeTruthy();
    const storedSecond = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(storedSecond?.[0].metadata?.systemContinuation).toBe(true);

    // And a third turn does not repeat it.
    const thirdAt = new Date(later.getTime() + 15 * 60 * 1000);
    getMessagesSince.mockResolvedValue([
      {
        id: 1,
        role: "assistant",
        content: "晚安",
        createdAt: closingAt,
        metadata: { closing: true },
        origin: null,
      },
      {
        id: 2,
        role: "assistant",
        content: "夜深了，早点睡。",
        createdAt: later,
        metadata: { systemContinuation: true },
        origin: null,
      },
    ]);
    createMessage.mockClear();
    const third = [];
    for await (const event of runConversation({
      persona: persona(closingHabit),
      userId: 1,
      message: "嗯",
      mode: "once",
      now: thirdAt,
    })) {
      third.push(event);
    }
    const doneThird = third.find((e) => e.type === "done");
    expect(doneThird?.careNote?.text ?? "").toBe("");
    expect(doneThird?.careNote?.kind ?? null).toBeNull();
  });

  it("says the system line after the closing even when the session is already long (C10.5)", async () => {
    /**
     * The natural case the earlier test left out: the conversation is
     * already over two hours old when the persona says goodnight. The
     * closing turn records the usage event but suppresses the system's
     * line (the persona said it in its own words), and the ordinary
     * note is "once a day" — so without an exception for the
     * continuation, the system's line never appears at all.
     */
    const closingAt = new Date("2026-01-14T18:20:00Z"); // 02:20 Shanghai
    const sessionStart = new Date(closingAt.getTime() - 3 * 60 * 60 * 1000);
    const closingHabit = {
      timezone: "Asia/Shanghai",
      styleProfile: {
        version: 1,
        measuredAt: closingAt.toISOString(),
        recordsVersion: "80:80",
        sessions: {
          scenes: 30,
          lengthMin: { median: 30, p90: 240 },
          closeByThemRate: 0.8,
          closers: [{ text: "晚安", n: 20 }],
        },
      },
    };
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getSessionStartAt.mockResolvedValue(sessionStart);
    getMessagesSince.mockResolvedValue([]);
    getLastClosingMessageAt.mockResolvedValue(null);
    const first = [];
    for await (const event of runConversation({
      persona: persona(closingHabit),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: closingAt,
    })) {
      first.push(event);
    }
    const storedClosing = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(storedClosing?.[0].metadata?.closing).toBe(true);
    expect(storedClosing?.[0].content).not.toContain(copy("zh", "labels.care.longSession"));

    // The closing turn recorded today's usage event. The database now
    // says so, which is what used to swallow the continuation note.
    hasSafetyEventSince.mockResolvedValue(true);

    const later = new Date(closingAt.getTime() + 35 * 60 * 1000);
    getMessagesSince.mockResolvedValue([
      {
        id: 1,
        role: "assistant",
        content: "晚安",
        createdAt: closingAt,
        metadata: { closing: true },
        origin: null,
      },
    ]);
    getLastClosingMessageAt.mockResolvedValue(closingAt);
    createMessage.mockClear();
    const second = [];
    for await (const event of runConversation({
      persona: persona(closingHabit),
      userId: 1,
      message: "再聊会儿",
      mode: "once",
      now: later,
    })) {
      second.push(event);
    }
    const doneSecond = second.find((e) => e.type === "done");
    expect(doneSecond?.careNote?.kind).toBe("long_session");
    expect(doneSecond?.careNote?.text).toBeTruthy();
    const storedSecond = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(storedSecond?.[0].metadata?.systemContinuation).toBe(true);
  });

  it("refuses to talk to a persona that has graduated", async () => {
    // The graduation used to be a badge: the app announced the anniversary
    // of a relationship the user had ended and still let them talk to it.
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ graduationStatus: "graduated" }),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/毕业/);
  });

  it("refuses a weekday when the user kept the chat to weekends (C6.1)", async () => {
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ settings: { taper: { stage: 2 } } }),
          userId: 1,
          message: "在吗",
          mode: "once",
          // A Wednesday in the user's zone.
          now: new Date("2026-03-04T12:00:00Z"),
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/只在周末/);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    // The closed day does not leave the user's message in the transcript.
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("refuses the chat when the other person said no (C10.3)", async () => {
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ settings: { consent: "asked_no" } }),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/说了不可以/);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    // The closed door does not leave the user's message in the transcript.
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("does not let the consent gate be overridden by a taper exception (C10.3)", async () => {
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ settings: { consent: "asked_no", taper: { stage: 2, overrideDay: "2026-03-04" } } }),
          userId: 1,
          message: "在吗",
          mode: "once",
          now: new Date("2026-03-04T12:00:00Z"),
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/说了不可以/);
  });

  it("refuses the chat on the letters-only step (C6.1)", async () => {
    await expect(
      (async () => {
        for await (const _ of runConversation({
          persona: persona({ settings: { taper: { stage: 3 } } }),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          // Drain the generator.
        }
      })(),
    ).rejects.toThrow(/只写信/);
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("still talks to a persona the user asked to be left alone", async () => {
    // "Quiet" silences the app, it does not lock the user out.
    const events = [];
    for await (const event of runConversation({
      persona: persona({ presence: "quiet" }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("mentions a worsening trajectory once, in the persona's own voice", async () => {
    // The trajectory used to be assessed, stored, and then ignored — only
    // its "improving" half was ever read.
    getLatestGraduationAssessment.mockResolvedValue({
      createdAt: new Date(),
      trajectory: "worsening",
    });

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我最近不太好",
      mode: "once",
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    const stored = createMessage.mock.calls.find((c) => c[0].role === "assistant");
    expect(stored?.[0].content).toContain("我确实看见了");
  });

  it("gives the care note a translation key and the client's language", async () => {
    const now = new Date("2026-01-15T12:00:00Z");
    getSessionStartAt.mockResolvedValue(new Date(now.getTime() - 3 * 60 * 60 * 1000));

    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      locale: "en",
      now,
    })) {
      events.push(event);
    }

    const done = events.find((e) => e.type === "done");
    expect(done?.careNote?.textKey).toBe("safety.care.longSession");
    expect(done?.careNote?.text).toContain("We've been talking");
  });

  it("does not send empty lines when the care note was already said today", async () => {
    // The words are said once a day — and a note that was already said
    // has no text. The stream used to send two newlines anyway, while
    // the stored message left them out: so the bubble had two blank
    // lines at the end and the record did not.
    hasSafetyEventSince.mockResolvedValue(true);
    // A long session — so a note is picked, and it has already been
    // said today.
    getSessionStartAt.mockResolvedValue(new Date(Date.now() - 3 * 60 * 60 * 1000));
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      yield { text: "的" };
    });

    const deltas: string[] = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).not.toContain("\n\n");
    // And the stored message is the same as what was streamed.
    const stored = createMessage.mock.calls[1][0].content as string;
    expect(deltas.join("")).toBe(stored);
  });

  it("adds a gentle check-in when the user sounds exhausted", async () => {
    const events = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "今天好累",
      mode: "once",
    })) {
      events.push(event);
    }

    // The model still answers — a weak signal is not a crisis.
    expect(invokeWithProvider).toHaveBeenCalled();
    const done = events.find((e) => e.type === "done");
    expect(done?.crisis).toBe(false);

    const assistantCall = createMessage.mock.calls[1][0];
    expect(assistantCall.content).toContain("在的。");
    expect(assistantCall.content).toContain("你刚刚那句话我听见了");
    // No crisis resources.
    expect(assistantCall.content).not.toContain("12356");
  });

  it("answers a burst of three as one turn", async () => {
    /**
     * A later message used to wait for the earlier reply. Three quick
     * lines then got three answers, and the first two never saw the
     * rest. They are now one turn: the earlier generations are taken
     * away, and the model is asked once, with all three lines.
     */
    const store: Array<{
      id: number;
      role: string;
      content: string;
      origin?: string | null;
    }> = [];
    let nextId = 1;
    createMessage.mockImplementation(async (row: { role: string; content: string; origin?: string }) => {
      const id = nextId++;
      store.push({ id, role: row.role, content: row.content, origin: row.origin ?? null });
      return id;
    });
    getMessagesByPersonaId.mockImplementation(async () => [...store]);

    const live = new Set<() => void>();
    const firstStarted = new Promise<void>((resolve) => {
      invokeWithProvider.mockImplementation(async (
        _provider: unknown,
        params: { options?: { signal?: AbortSignal } },
      ) => {
        const signal = params.options?.signal;
        if (signal?.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return await new Promise<string>((wait, reject) => {
          const finish = () => {
            live.delete(finish);
            wait("在的。");
          };
          const fail = () => {
            live.delete(finish);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          signal?.addEventListener("abort", fail, { once: true });
          live.add(finish);
          resolve();
        });
      });
    });

    const events1: Array<{ type: string }> = [];
    const events2: Array<{ type: string }> = [];
    const events3: Array<{ type: string }> = [];
    const first = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "一",
        mode: "once",
      })) {
        events1.push(event);
      }
    })();
    await firstStarted;
    const second = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "二",
        mode: "once",
      })) {
        events2.push(event);
      }
    })();
    await vi.waitFor(() => {
      expect(store.some((row) => row.content === "二")).toBe(true);
    });
    const third = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "三",
        mode: "once",
      })) {
        events3.push(event);
      }
    })();
    await vi.waitFor(() => {
      expect(store.some((row) => row.content === "三")).toBe(true);
    });
    await vi.waitFor(() => {
      const dropped = [events1, events2, events3].filter((events) =>
        events.some((event) => event.type === "superseded"),
      );
      expect(dropped).toHaveLength(2);
      expect(live.size).toBe(1);
    });
    for (const finish of live) finish();
    await Promise.all([first, second, third]);

    expect(events1.at(-1)?.type).toBe("superseded");
    expect(events2.at(-1)?.type).toBe("superseded");
    expect(events3.some((event) => event.type === "done")).toBe(true);
    const settled = await Promise.allSettled(
      invokeWithProvider.mock.results.map((row) => row.value as Promise<unknown>),
    );
    expect(settled.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const lastCall = invokeWithProvider.mock.calls.at(-1)?.[1] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const messages = lastCall.messages;
    const userLines = messages
      .filter((row) => row.role === "user")
      .map((row) => String(row.content));
    expect(userLines).toEqual(["一", "二", "三"]);
    const assistant = store.filter((row) => row.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(incrementChatCount).toHaveBeenCalledTimes(1);
  });

  it("does not store a half reply when a later message takes the turn away", async () => {
    let streams = 0;
    let firstChunk = false;
    streamWithProvider.mockImplementation(async function* (
      _provider: unknown,
      params: { options?: { signal?: AbortSignal } },
    ) {
      streams += 1;
      if (streams === 1) {
        firstChunk = true;
        yield { text: "在" };
        const signal = params.options?.signal;
        await new Promise<void>((_, reject) => {
          const fail = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail, { once: true });
        });
        return;
      }
      yield { text: "在的。" };
    });

    const firstEvents: Array<{ type: string }> = [];
    const first = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "一",
        mode: "stream",
      })) {
        firstEvents.push(event);
      }
    })();
    await vi.waitFor(() => {
      expect(firstChunk).toBe(true);
    });
    const secondEvents: Array<{ type: string }> = [];
    const second = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "二",
        mode: "stream",
      })) {
        secondEvents.push(event);
      }
    })();
    await Promise.all([first, second]);

    expect(firstEvents.some((event) => event.type === "superseded")).toBe(true);
    const assistant = createMessage.mock.calls.filter(
      (call) => (call[0] as { role?: string }).role === "assistant",
    );
    expect(assistant).toHaveLength(1);
    expect((assistant[0][0] as { content: string }).content).toContain("在的。");
  });

  it("keeps a half reply when the user stops the turn", async () => {
    const controller = new AbortController();
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "在" };
      controller.abort();
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "superseded")).toBe(false);
    const assistant = createMessage.mock.calls.find(
      (call) => (call[0] as { role?: string }).role === "assistant",
    );
    expect(assistant?.[0].content).toContain("在");
  });

  it("answers a crisis immediately and drops the ordinary reply", async () => {
    let releaseFirst = () => {};
    let hanging = true;
    const firstStarted = new Promise<void>((resolve) => {
      invokeWithProvider.mockImplementation(async (
        _provider: unknown,
        params: { options?: { signal?: AbortSignal } },
      ) => {
        const signal = params.options?.signal;
        if (signal?.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        if (!hanging) return "在的。";
        return await new Promise<string>((wait, reject) => {
          const fail = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          signal?.addEventListener("abort", fail, { once: true });
          releaseFirst = () => {
            hanging = false;
            wait("在的。");
          };
          resolve();
        });
      });
    });

    const firstEvents: Array<{ type: string }> = [];
    const first = (async () => {
      for await (const event of runConversation({
        persona: persona(),
        userId: 1,
        message: "在吗",
        mode: "once",
      })) {
        firstEvents.push(event);
      }
    })();
    await firstStarted;
    const crisisEvents: Array<{ type: string; crisis?: boolean }> = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "我不想活了",
      mode: "once",
    })) {
      crisisEvents.push(event);
    }
    releaseFirst();
    await first;

    expect(firstEvents.some((event) => event.type === "superseded")).toBe(true);
    expect(crisisEvents.some((event) => event.type === "done" && event.crisis)).toBe(true);
    const assistant = createMessage.mock.calls.filter(
      (call) => (call[0] as { role?: string }).role === "assistant",
    );
    expect(assistant).toHaveLength(1);
    expect((assistant[0][0] as { content: string }).content).toContain("12356");
  });

  it("does not wait for a read window when timing is off", async () => {
    vi.useFakeTimers();
    try {
      const running = (async () => {
        for await (const _ of runConversation({
          persona: persona(),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          /* drain */
        }
      })();
      await vi.advanceTimersByTimeAsync(0);
      await running;
      expect(invokeWithProvider).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits the channel read window even when timing is off", async () => {
    vi.useFakeTimers();
    try {
      let called = false;
      invokeWithProvider.mockImplementation(async () => {
        called = true;
        return "在的。";
      });
      const running = (async () => {
        for await (const _ of runConversation({
          persona: persona(),
          userId: 1,
          message: "在吗",
          mode: "once",
          channel: "wechat",
        })) {
          /* drain */
        }
      })();
      await vi.advanceTimersByTimeAsync(CHANNEL_READ_WINDOW_MS - 1);
      expect(called).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(called).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers three channel messages two seconds apart as one turn", async () => {
    vi.useFakeTimers();
    try {
      const store: Array<{ id: number; role: string; content: string }> = [];
      let nextId = 1;
      createMessage.mockImplementation(async (row: { role: string; content: string }) => {
        const id = nextId++;
        store.push({ id, role: row.role, content: row.content });
        return id;
      });
      getMessagesByPersonaId.mockImplementation(async () => [...store]);

      const events1: Array<{ type: string }> = [];
      const events2: Array<{ type: string }> = [];
      const events3: Array<{ type: string }> = [];
      const first = (async () => {
        for await (const event of runConversation({
          persona: persona(),
          userId: 1,
          message: "一",
          mode: "once",
          channel: "wechat",
        })) {
          events1.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(2_000);
      const second = (async () => {
        for await (const event of runConversation({
          persona: persona(),
          userId: 1,
          message: "二",
          mode: "once",
          channel: "wechat",
        })) {
          events2.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(2_000);
      const third = (async () => {
        for await (const event of runConversation({
          persona: persona(),
          userId: 1,
          message: "三",
          mode: "once",
          channel: "wechat",
        })) {
          events3.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(CHANNEL_READ_WINDOW_MS);
      await Promise.all([first, second, third]);
      expect(events1.some((event) => event.type === "superseded")).toBe(true);
      expect(events2.some((event) => event.type === "superseded")).toBe(true);
      expect(events3.some((event) => event.type === "done")).toBe(true);
      expect(invokeWithProvider).toHaveBeenCalledTimes(1);
      const assistant = store.filter((row) => row.role === "assistant");
      expect(assistant).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits the read window when timing is on", async () => {
    vi.useFakeTimers();
    try {
      let called = false;
      invokeWithProvider.mockImplementation(async () => {
        called = true;
        return "在的。";
      });
      const running = (async () => {
        for await (const _ of runConversation({
          persona: timedPersona(),
          userId: 1,
          message: "在吗",
          mode: "once",
        })) {
          /* drain */
        }
      })();
      await vi.advanceTimersByTimeAsync(READ_WINDOW_MS - 1);
      expect(called).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(called).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("assesses the emotional trajectory and lets it suggest graduation earlier", async () => {
    getRecentMessages.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );
    invoke.mockResolvedValue(
      JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
    );
    // The reply comes first, the trajectory assessment second — both on the
    // provider that was resolved for the user.
    invokeWithProvider
      .mockResolvedValueOnce("在的。")
      .mockResolvedValue(
        JSON.stringify({ trajectory: "improving", regretRatio: 10, gratitudeRatio: 80 }),
      );
    // Nothing stored yet (the throttle check), then the fresh assessment the
    // graduation check reads.
    getLatestGraduationAssessment
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({
        id: 1,
        userId: 1,
        personaId: 1,
        trajectory: "improving",
        regretRatio: 10,
        gratitudeRatio: 80,
        assessment: null,
        windowStart: new Date("2025-12-18T12:00:00Z"),
        windowEnd: new Date("2026-01-15T12:00:00Z"),
        createdAt: new Date("2026-01-15T12:00:00Z"),
      });

    // The count is now read back from the database after the
    // increment, so it is the mock that says what it is.
    incrementChatCount.mockResolvedValue(26);

    const events = [];
    for await (const event of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }

    expect(createGraduationAssessment).toHaveBeenCalledTimes(1);
    expect(createGraduationAssessment.mock.calls[0][0].trajectory).toBe("improving");

    const done = events.find((e) => e.type === "done");
    expect(done?.graduationSuggested).toBe(true);
  });

  it("does not assess the trajectory when the user turned it off", async () => {
    /**
     * The trajectory is the one place where a month of raw private
     * conversation goes to the model.
     */
    getUserById.mockResolvedValue({ id: 1, trajectoryAssessment: "off" });
    getMessagesSince.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );

    for await (const _ of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) { /* drain */ }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("does not assess the trajectory when the setting cannot be read", async () => {
    /**
     * The gate failed open.
     *
     * The catch did not return, so when the setting could not be read
     * the code went on to the assessment anyway — and the assessment
     * sends a month of the user's private conversation to the model.
     */
    getUserById.mockRejectedValue(new Error("the database is not there"));
    getMessagesSince.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );

    for await (const _ of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) { /* drain */ }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("does not assess the trajectory when there is no user to ask", async () => {
    // The read answers nothing when the database is not there — and the
    // answer used to be "allowed".
    getUserById.mockResolvedValue(undefined);
    getMessagesSince.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        role: "user",
        content: "今天天气不错",
        createdAt: new Date("2026-01-10T12:00:00Z"),
      })),
    );

    for await (const _ of runConversation({
      persona: persona({ chatCount: 25 }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) { /* drain */ }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("does not assess the trajectory again within a day", async () => {
    getLatestGraduationAssessment.mockResolvedValue({
      id: 1,
      userId: 1,
      personaId: 1,
      trajectory: "stable",
      regretRatio: 10,
      gratitudeRatio: 10,
      assessment: null,
      windowStart: new Date("2025-12-18T12:00:00Z"),
      windowEnd: new Date("2026-01-15T12:00:00Z"),
      createdAt: new Date("2026-01-15T11:00:00Z"),
    });

    for await (const _ of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      now: new Date("2026-01-15T12:00:00Z"),
    })) {
      // drain
    }

    expect(createGraduationAssessment).not.toHaveBeenCalled();
  });

  it("offers two unreplied lines on the eighth web turn when the switch is on", async () => {
    invokeWithProvider
      .mockResolvedValueOnce("好的呀")
      .mockResolvedValueOnce("好的。");
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: persona({ chatCount: 8, settings: { layers: { abPairs: true } } }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(invokeWithProvider).toHaveBeenCalledTimes(2);
    const choice = events.find((event) => event.type === "choice") as
      | { type: "choice"; options: [string, string]; replyToMessageId: number }
      | undefined;
    expect(choice?.options).toEqual(["好的呀", "好的。"]);
    expect(choice?.replyToMessageId).toBe(99);
    expect(createMessage.mock.calls.filter((call) => call[0].role === "assistant")).toHaveLength(0);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(updateMessageMetadata).toHaveBeenCalled();
  });

  it("still offers the pair when both lines are the same", async () => {
    invokeWithProvider.mockResolvedValue("好的呀");
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: persona({ chatCount: 8, settings: { layers: { abPairs: true } } }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(invokeWithProvider).toHaveBeenCalledTimes(2);
    const choice = events.find((event) => event.type === "choice") as
      | { type: "choice"; options: [string, string] }
      | undefined;
    expect(choice?.options).toEqual(["好的呀", "好的呀"]);
    expect(createMessage.mock.calls.filter((call) => call[0].role === "assistant")).toHaveLength(0);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("does not offer a choice on a channel even when the switch is on", async () => {
    vi.useFakeTimers();
    try {
      const running = (async () => {
        for await (const _ of runConversation({
          persona: persona({ chatCount: 8, settings: { layers: { abPairs: true } } }),
          userId: 1,
          message: "在吗",
          mode: "once",
          channel: "wechat",
        })) {
          // drain
        }
      })();
      await vi.advanceTimersByTimeAsync(CHANNEL_READ_WINDOW_MS);
      await running;
      expect(invokeWithProvider).toHaveBeenCalledTimes(1);
      expect(createMessage.mock.calls.filter((call) => call[0].role === "assistant")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores the chosen line and a pair when the user picks", async () => {
    getMessageById.mockResolvedValue({
      id: 7,
      role: "user",
      content: "在吗",
      metadata: {
        pendingChoice: {
          options: ["好的呀", "好的。"],
          features: [
            { ll: 0, length: 3, surprise: 0, residue: 0, act: 0, real: 0.5 },
            { ll: 0, length: 3, surprise: 0, residue: 0, act: 0, real: 0.5 },
          ],
        },
      },
    });
    const result = await commitPendingChoice({
      persona: persona(),
      userId: 1,
      userMessageId: 7,
      chosen: "好的呀",
      rejected: "好的。",
      writePair: true,
      locale: "zh",
    });
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: "好的呀",
    }));
    expect(createFidelityPair).toHaveBeenCalledWith(expect.objectContaining({
      chosenText: "好的呀",
      rejectedText: "好的。",
      messageId: result.messageId,
    }));
    expect(clearMessagePendingChoice).toHaveBeenCalledWith(7, 1, 1);
  });

  function timedPersona(extra: Record<string, unknown> = {}) {
    return persona({
      timingEnabled: true,
      timezone: "Asia/Shanghai",
      behaviorProfile: {
        samples: 20,
        replyGapMedianSec: 90,
        replyGapLogSigma: 0.8,
        burstSizes: [1],
        measuredAt: "2026-01-01T00:00:00.000Z",
      },
      ...extra,
    });
  }

  const eveningDelay = {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "40:40",
    replyDelay: {
      samples: 40,
      resolution: "second",
      buckets: {
        evening: { n: 20, mu: Math.log(40), sigma: 0 },
        all: { n: 40, mu: Math.log(40), sigma: 0 },
      },
    },
  };

  it("draws the delay from the measured bucket", async () => {
    vi.useFakeTimers();
    try {
      const events: Array<{ type: string; ms?: number }> = [];
      const running = (async () => {
        for await (const event of runConversation({
          persona: timedPersona({ styleProfile: eveningDelay }),
          userId: 1,
          message: "在吗",
          mode: "once",
          now: new Date("2024-06-01T12:00:00.000Z"),
        })) {
          events.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(READ_WINDOW_MS);
      await running;
      const delay = events.find((event) => event.type === "delay");
      expect(delay).toEqual({ type: "delay", ms: 40_000 });
      const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
      expect(stored?.[0].metadata.delay).toEqual({ ms: 40_000, via: "band" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delay or split the API channel even when the persona has its own timing", async () => {
    invokeWithProvider.mockResolvedValue("嗯\n好\n在");
    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of runConversation({
      persona: timedWithTyping(),
      userId: 1,
      message: "在吗",
      mode: "once",
      channel: "api",
      now: new Date("2024-06-01T12:00:00.000Z"),
    })) {
      events.push(event as never);
    }
    expect(events.some((event) => event.type === "delay")).toBe(false);
    expect(events.some((event) => event.type === "burst")).toBe(false);
    expect(events.some((event) => event.type === "deferred")).toBe(false);
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].content).toBe("嗯\n好\n在");
  });

  it("does not turn the API channel's answer into a deferred reply job", async () => {
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: timedPersona({
        behaviorProfile: {
          samples: 20,
          replyGapMedianSec: 600,
          replyGapLogSigma: 0.1,
          burstSizes: [1],
          measuredAt: "2026-01-01T00:00:00.000Z",
        },
        settings: { timing: { asyncDelivery: true } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
      channel: "api",
      now: new Date("2024-06-01T12:00:00.000Z"),
    })) {
      events.push(event as never);
    }
    expect(events.some((event) => event.type === "deferred")).toBe(false);
    expect(createReplyJob).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "done")).toBe(true);
  });

  it("keeps the old delay when nothing has been measured", async () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(behaviorProfile, "sampleReplyDelayMs");
      const events: Array<{ type: string; ms?: number }> = [];
      const running = (async () => {
        for await (const event of runConversation({
          persona: timedPersona(),
          userId: 1,
          message: "在吗",
          mode: "once",
          now: new Date("2024-06-01T12:00:00.000Z"),
        })) {
          events.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(READ_WINDOW_MS);
      await running;
      const delay = events.find((event) => event.type === "delay");
      expect(spy).toHaveBeenCalled();
      expect(delay?.ms).toBe(spy.mock.results.at(-1)?.value);
      const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
      expect(stored?.[0].metadata.delay).toBeUndefined();
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delay a crisis, a weak signal, or someone saying they are sad", async () => {
    vi.useFakeTimers();
    try {
      for (const message of ["我想死", "我好累", "我很难过"]) {
        createMessage.mockClear();
        const events: Array<{ type: string }> = [];
        const running = (async () => {
          for await (const event of runConversation({
            persona: timedPersona({ styleProfile: eveningDelay }),
            userId: 1,
            message,
            mode: "once",
            now: new Date("2024-06-01T12:00:00.000Z"),
          })) {
            events.push(event);
          }
        })();
        await vi.advanceTimersByTimeAsync(READ_WINDOW_MS);
        await running;
        expect(events.some((event) => event.type === "delay"), message).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  const typingProfile = {
    msPerChar: 200,
    burstGapMs: { p10: 400, p25: 600, p50: 800, p75: 1_200, p90: 2_000 },
    pairs: 40,
  };

  const timedWithTyping = (extra: Record<string, unknown> = {}) =>
    timedPersona({
      behaviorProfile: {
        samples: 20,
        replyGapMedianSec: 90,
        replyGapLogSigma: 0.8,
        burstSizes: [3],
        measuredAt: "2026-01-01T00:00:00.000Z",
      },
      styleProfile: {
        ...eveningDelay,
        typing: typingProfile,
      },
      ...extra,
    });

  async function collectTimedEvents(personaArg: ReturnType<typeof timedPersona>, message = "在吗") {
    const events: Array<{
      type: string;
      ms?: number;
      typingMs?: number | number[];
      texts?: string[];
      gapsMs?: number[];
    }> = [];
    const running = (async () => {
      for await (const event of runConversation({
        persona: personaArg,
        userId: 1,
        message,
        mode: "once",
        now: new Date("2024-06-01T12:00:00.000Z"),
      })) {
        events.push(event);
      }
    })();
    await vi.advanceTimersByTimeAsync(READ_WINDOW_MS);
    await running;
    return events;
  }

  it("carries the provenance of every bubble in a burst, not only the last (C10.7)", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockResolvedValue("我想你了\n晚安\n在的");
      candidateRecordsByOverlap.mockImplementation(async (
        _personaId: number,
        _userId: number,
        params: { text: string },
      ) => (["我想你了", "晚安", "在的"].includes(params.text.replace(/。$/, ""))
        ? [{
            id: params.text.startsWith("我想") ? 12 : params.text === "晚安。" || params.text === "晚安" ? 13 : 14,
            content: params.text.replace(/。$/, ""),
            timestamp: new Date("2023-03-04T12:00:00.000Z"),
            role: "assistant",
            speaker: "小满",
            coverage: 1,
          }]
        : []));
      const events = await collectTimedEvents(timedWithTyping());
      const done = events.find((event) => event.type === "done") as {
        provenances?: Array<{ messageId: number; spans: Array<{ start: number; end: number; recordId: number }> }>;
        provenance?: Array<{ recordId: number }>;
      };
      expect(done.provenances).toHaveLength(3);
      // Each bubble keeps its own line's record, so the underline is
      // there the moment the bubbles arrive instead of after a reload.
      expect(done.provenances!.map((row) => row.spans.map((span) => span.recordId))).toEqual([
        [12],
        [13],
        [14],
      ]);
      expect(done.provenance?.map((span) => span.recordId)).toEqual([14]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a typing duration on the delay and burst when the three conditions hold", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockResolvedValue("嗯\n好\n在");
      const events = await collectTimedEvents(timedWithTyping());
      const delay = events.find((event) => event.type === "delay");
      expect(delay?.ms).toBe(40_000);
      expect(typeof delay?.typingMs).toBe("number");
      expect(delay!.typingMs as number).toBeGreaterThan(0);
      expect(delay!.typingMs as number).toBeLessThanOrEqual(delay!.ms!);
      const burst = events.find((event) => event.type === "burst");
      expect(burst?.texts).toEqual(["嗯", "好", "在"]);
      expect(burst?.gapsMs).toHaveLength(2);
      expect(burst?.typingMs).toHaveLength(2);
      (burst!.typingMs as number[]).forEach((ms, i) => {
        expect(ms).toBeLessThanOrEqual(burst!.gapsMs![i]!);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits the same delay and burst events when typing is switched off", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockResolvedValue("嗯\n好\n在");
      const withoutProfile = await collectTimedEvents(timedPersona({
        behaviorProfile: {
          samples: 20,
          replyGapMedianSec: 90,
          replyGapLogSigma: 0.8,
          burstSizes: [3],
          measuredAt: "2026-01-01T00:00:00.000Z",
        },
        styleProfile: eveningDelay,
      }));
      const switchedOff = await collectTimedEvents(timedWithTyping({
        settings: { timing: { typing: false } },
      }));
      expect(switchedOff).toEqual(withoutProfile);
      expect(withoutProfile.find((event) => event.type === "delay")).toEqual({ type: "delay", ms: 40_000 });
      expect(withoutProfile.find((event) => event.type === "burst")).toEqual({
        type: "burst",
        texts: ["嗯", "好", "在"],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  const quirksPersona = (quirks: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    persona({
      settings: { timing: { recall: true } },
      styleProfile: {
        version: 1,
        measuredAt: "2026-01-01T00:00:00.000Z",
        recordsVersion: "40:40",
        quirks,
      },
      ...extra,
    });

  it("stores a typo and the starred fix when the reply contains a word they used to mistype", async () => {
    invokeWithProvider.mockResolvedValue("今天好累");
    for await (const _event of runConversation({
      persona: quirksPersona({
        typoFixes: [{ wrong: "雷", right: "累", n: 6 }],
        typoRate: 1,
        recallRate: 0,
        patAfter: {},
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      /* drain */
    }
    const stored = createMessage.mock.calls
      .filter((call) => call[0].role === "assistant")
      .map((call) => call[0].content);
    expect(stored).toEqual(["今天好雷", "*累"]);
  });

  it("does not invent a typo when the reply has none of their rights", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    for await (const _event of runConversation({
      persona: quirksPersona({
        typoFixes: [{ wrong: "雷", right: "累", n: 6 }],
        typoRate: 1,
        recallRate: 0,
        patAfter: {},
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      /* drain */
    }
    const stored = createMessage.mock.calls
      .filter((call) => call[0].role === "assistant")
      .map((call) => call[0].content);
    expect(stored).toEqual(["在的。"]);
  });

  it("does not recall when rerank is off, and does not call the model extra times", async () => {
    invokeWithProvider.mockResolvedValue("在的呀");
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: quirksPersona({
        typoFixes: [],
        typoRate: 0,
        recallRate: 1,
        patAfter: {},
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === "recall")).toBe(false);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("recalls a rejected candidate then stores only a placeholder", async () => {
    const corpus = Array.from({ length: 40 }, () => "在的呀");
    iterateRecords.mockImplementation(async function* () {
      for (const text of corpus) {
        yield { role: "assistant", content: text, kind: "text" };
      }
    });
    const spy = vi.spyOn(rerankModel, "getRerankModel").mockResolvedValue(buildRerankModel(corpus));
    invokeWithProvider
      .mockResolvedValueOnce("落选候选原文")
      .mockResolvedValueOnce("在的呀")
      .mockResolvedValueOnce("嗯嗯")
      .mockResolvedValueOnce("好的呀");
    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of runConversation({
      persona: quirksPersona({
        typoFixes: [],
        typoRate: 0,
        recallRate: 1,
        patAfter: {},
      }, { rerankEnabled: true }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    spy.mockRestore();
    const types = events.map((event) => event.type);
    const recallIndex = types.indexOf("recall");
    expect(recallIndex).toBeGreaterThanOrEqual(0);
    const replyIndex = types.findIndex(
      (type, index) => index > recallIndex
        && (type === "delta" || type === "burst" || type === "replace"),
    );
    expect(replyIndex).toBeGreaterThan(recallIndex);
    const recall = events.find((event) => event.type === "recall");
    expect(typeof recall?.text).toBe("string");
    expect(recall?.text).toBeTruthy();
    // The spoken line is only in the event; the stored row is the
    // marker, with its own metadata (B5.6).
    const storedRows = createMessage.mock.calls.map(
      (call) => call[0] as { role?: string; content?: string; metadata?: { kind?: string } },
    );
    const storedRecall = storedRows.find(
      (row) => row.role === "assistant" && row.content === "[recall]",
    );
    expect(storedRecall?.metadata?.kind).toBe("recall");
    expect(storedRows.some((row) => String(row.content ?? "").includes(String(recall?.text)))).toBe(false);
  });

  it("pats before the reply when that user act used to be tapped", async () => {
    invokeWithProvider.mockResolvedValue("在的。");
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: quirksPersona({
        typoFixes: [],
        typoRate: 0,
        recallRate: 0,
        patAfter: { ask: { pats: 5, turns: 5 } },
      }),
      userId: 1,
      message: "在吗",
      mode: "once",
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === "pat")).toBe(true);
    const stored = createMessage.mock.calls
      .filter((call) => call[0].role === "assistant")
      .map((call) => call[0].content);
    expect(stored[0]).toBe("[pat]");
    expect(stored.at(-1)).toBe("在的。");
  });

  it("does not run quirks on a channel", async () => {
    vi.useFakeTimers();
    try {
      invokeWithProvider.mockResolvedValue("今天好累");
      const events: Array<{ type: string }> = [];
      const running = (async () => {
        for await (const event of runConversation({
          persona: quirksPersona({
            typoFixes: [{ wrong: "雷", right: "累", n: 6 }],
            typoRate: 1,
            recallRate: 1,
            patAfter: { ask: { pats: 5, turns: 5 } },
          }, { rerankEnabled: true }),
          userId: 1,
          message: "在吗",
          mode: "once",
          channel: "wechat",
        })) {
          events.push(event);
        }
      })();
      await vi.advanceTimersByTimeAsync(CHANNEL_READ_WINDOW_MS);
      await running;
      expect(events.some((event) => event.type === "recall" || event.type === "pat")).toBe(false);
      const stored = createMessage.mock.calls
        .filter((call) => call[0].role === "assistant")
        .map((call) => call[0].content);
      expect(stored).toEqual(["今天好累"]);
    } finally {
      vi.useRealTimers();
    }
  });

describe("the persona's tools (C9.4)", () => {
  // The generator below runs inside the same `runConversation` describe,
  // so the mocks are already wired; the call history is per test.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function toolProvider() {
    return {
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: true, jsonMode: false },
      invoke,
      lastToolCalls: null,
      stream: async function* () {
        yield { text: "" };
      },
    };
  }

  async function collect(options: Record<string, unknown> = {}) {
    const events: any[] = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "once",
      ...options,
    } as any)) {
      events.push(event);
    }
    return events;
  }

  it("sends no tools at all when the switch is off", async () => {
    // The provider can do tools; the layer is what keeps them off. The
    // default test provider cannot do tools, which would make this pass
    // even if the layer check disappeared.
    resolveProviderForUser.mockResolvedValue(toolProvider());
    await collect();
    const options = (invokeWithProvider.mock.calls[0]?.[1] as any)?.options;
    expect(options?.tools).toBeUndefined();
    expect(options?.toolChoice).toBeUndefined();
  });

  it("offers the tools and stops streaming when the switch is on", async () => {
    resolveProviderForUser.mockResolvedValue(toolProvider());
    const events = await collect({
      persona: persona({ settings: { layers: { tools: true } } }),
      mode: "stream",
    });
    expect(streamWithProvider).not.toHaveBeenCalled();
    const options = (invokeWithProvider.mock.calls[0]?.[1] as any)?.options;
    expect(Array.isArray(options?.tools)).toBe(true);
    expect(options.tools.map((tool: any) => tool.name)).toEqual([
      "set_reminder",
      "send_photo",
    ]);
    expect(options.toolChoice).toBe("auto");
    expect(events.some((event: any) => event.type === "done")).toBe(true);
  });

  it("keeps the ordinary reply when the provider cannot call tools", async () => {
    // The switch is on but the provider has no tools channel: the turn
    // has to fall back to a plain reply instead of asking for tools the
    // endpoint cannot take.
    resolveProviderForUser.mockResolvedValue({
      ...toolProvider(),
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
    });
    await collect({
      persona: persona({ settings: { layers: { tools: true } } }),
    });
    const options = (invokeWithProvider.mock.calls[0]?.[1] as any)?.options;
    expect(options?.tools).toBeUndefined();
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("has no tools for a memorial persona", async () => {
    resolveProviderForUser.mockResolvedValue(toolProvider());
    await collect({
      persona: persona({ settings: { mode: "memorial", layers: { tools: true } } }),
    });
    const options = (invokeWithProvider.mock.calls[0]?.[1] as any)?.options;
    expect(options?.tools).toBeUndefined();
  });

  it("has no tools on a channel", async () => {
    resolveProviderForUser.mockResolvedValue(toolProvider());
    await collect({
      persona: persona({ settings: { layers: { tools: true } } }),
      channel: "wechat",
    });
    const options = (invokeWithProvider.mock.calls[0]?.[1] as any)?.options;
    expect(options?.tools).toBeUndefined();
  });
});
});

describe("composeMessages", () => {
  beforeEach(() => {
    getDefaultLlmConfig.mockResolvedValue(null);
    getMessagesByPersonaId.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    listMemoryMediaForMemories.mockResolvedValue([]);
    listRecentlySentPhotoMediaIds.mockResolvedValue([]);
    getFilesByPersonaId.mockResolvedValue([]);
    getSceneById.mockResolvedValue(null);
    getLatestChatSummary.mockResolvedValue(undefined);
    touchMemoryRecalled.mockResolvedValue(undefined);
    // The real helper leaves an absolute URL alone and cannot read a
    // path that is not there.
    storageToDataUrl.mockImplementation(async (url: string) =>
      /^https?:\/\//i.test(url) ? url : null);
  });

  it("hands the picture to the model as bytes, not as a path", async () => {
    /**
     * The picture has to reach the model.
     *
     * The stored URL is `/uploads/chat/1/2/x.png` — a path, with no
     * host — and the API answered "Invalid image URL" and the turn
     * failed. Against a local model the picture was dropped and the
     * persona answered as if it had seen nothing.
     */
    storageToDataUrl.mockResolvedValue("data:image/png;base64,AAAA");
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "[图片]",
        messageType: "image",
        mediaUrl: "/uploads/chat/1/2/x.png",
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "[图片]",
      contextLimit: 20,
    });

    const turn = messages[messages.length - 1];
    expect(Array.isArray(turn.content)).toBe(true);
    const parts = turn.content as any[];
    expect(parts[1].url).toBe("data:image/png;base64,AAAA");
    expect(parts[1].url).not.toContain("/uploads/");
  });

  it("puts the system prompt first", async () => {
    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain("小A");
  });

  it("does not hand a system notice back to the model as something they said", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      { id: 1, role: "user", content: "在吗", origin: null },
      { id: 2, role: "assistant", content: "TA 这会儿没回", origin: "system-notice" },
    ]);
    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "那你呢",
      contextLimit: 20,
    });
    const spoken = messages.filter((row) => row.role !== "system").map((row) => String(row.content)).join("\n");
    expect(spoken).not.toContain("TA 这会儿没回");
  });

  it("does not hand a recalled placeholder back to the model", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      { id: 1, role: "user", content: "在吗", origin: null },
      { id: 2, role: "assistant", content: "[recall]", metadata: { kind: "recall" } },
      { id: 3, role: "assistant", content: "在的呀" },
    ]);
    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "那你呢",
      contextLimit: 20,
    });
    const spoken = messages.filter((row) => row.role !== "system").map((row) => String(row.content)).join("\n");
    expect(spoken).not.toContain("[recall]");
    expect(spoken).toContain("在的呀");
  });

  it("includes the retrieved memories", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 1,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(String(messages[0].content)).toContain("第一次见面");
  });

  it("marks a recalled memory as recalled", async () => {
    // The recall time is what damps a memory that keeps coming up, so a
    // recall has to be recorded — not just scored.
    getMemoriesByPersonaId.mockResolvedValue([
      {
        id: 42,
        personaId: 1,
        userId: 1,
        title: "第一次见面",
        description: "在图书馆门口",
        category: "memory",
        date: "2019-05-20",
        messageId: null,
        importance: 1,
        isPinned: false,
        lastRecalledAt: null,
        factKey: null,
        createdAt: new Date(),
      },
    ]);

    await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "你还记得图书馆吗",
      contextLimit: 20,
    });

    expect(touchMemoryRecalled).toHaveBeenCalledWith(
      42,
      1,
      expect.any(Date),
    );
  });

  it("sends an image message as a multi-part content array", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "[图片]",
        messageType: "image",
        mediaUrl: "https://cdn.example.com/photo.png",
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "看这个",
      contextLimit: 20,
    });

    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "text", text: "[图片]" },
      { type: "image_url", url: "https://cdn.example.com/photo.png" },
    ]);
  });

  it("keeps a text message as a plain string", async () => {
    getMessagesByPersonaId.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "在吗",
        messageType: "text",
        mediaUrl: null,
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
    ]);

    const { messages } = await composeMessages({
      persona: persona(),
      userId: 1,
      userMessage: "在吗",
      contextLimit: 20,
    });

    expect(messages[messages.length - 1].content).toBe("在吗");
  });
});

/**
 * The settings that are read as numbers.
 *
 * They were stored as they arrived, so a value that was not a number
 * made the context limit NaN — and `slice(NaN)` is the whole history.
 * Every turn then sent two hundred messages to the provider, the
 * provider answered "context length exceeded", and the bill went up on
 * every turn.
 */
describe("the settings that are read as numbers", () => {
  it("falls back to the default when the value is not a number", () => {
    expect(clampContextLimit(undefined)).toBe(20);
    expect(clampContextLimit("many")).toBe(20);
    expect(clampContextLimit({})).toBe(20);
    expect(clampContextLimit(Number.NaN)).toBe(20);
    expect(clampContextLimit(Number.POSITIVE_INFINITY)).toBe(20);
  });

  it("keeps the context limit within its bounds", () => {
    expect(clampContextLimit(1)).toBe(4);
    expect(clampContextLimit(50)).toBe(50);
    expect(clampContextLimit(100000)).toBe(200);
  });

  it("keeps the temperature within its bounds", () => {
    expect(clampTemperature("warm")).toBe(0.8);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTemperature(1.2)).toBe(1.2);
    expect(clampTemperature(9)).toBe(2);
  });

  it("keeps the answer length within its bounds", () => {
    expect(clampMaxTokens("long")).toBe(2000);
    expect(clampMaxTokens(0)).toBe(16);
    expect(clampMaxTokens(800)).toBe(800);
    expect(clampMaxTokens(999999)).toBe(128_000);
  });
});

function stripPeriodProfile() {
  return {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "100:100",
    fingerprint: {
      samples: 100,
      length: { median: 10, p90: 12, p95: 24, histogram: [] },
      turnChars: { median: 10, p95: 24 },
      endings: {
        period: 0,
        ellipsis: 0,
        question: 0,
        exclaim: 0,
        tilde: 0.5,
        emoji: 0,
        particle: 0,
        other: 1,
      },
      particles: {},
      punctuation: {
        commaPerChar: 0.01,
        spaceAsComma: 0,
        ellipsisForms: { unicode: 0, dots: 0, cjkDots: 0 },
        exclaimRuns: [],
        questionRuns: [],
        halfWidthRate: 0.5,
        markCount: 0,
      },
      laugh: { rate: 0, forms: {}, haRuns: [] },
      reduplication: {},
      emoji: { rate: 0.2, perLine: 0, top: [] },
      kaomoji: { rate: 0 },
      latin: { rate: 0, abbreviations: {} },
      typoFix: { starRate: 0 },
      script: { traditionalRate: 0 },
      address: {},
    },
  };
}

describe("style projection on the stream", () => {
  it("streams the raw text, then replaces it with the projected line, and stores that", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "好的。" };
    });
    const events: Array<{ type: string; text?: string }> = [];
    for await (const event of runConversation({
      persona: persona({ styleProfile: stripPeriodProfile() }),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }
    const types = events.map((event) => event.type);
    expect(types).toContain("delta");
    expect(types).toContain("replace");
    expect(types.indexOf("delta")).toBeLessThan(types.indexOf("replace"));
    expect(types.indexOf("replace")).toBeLessThan(types.indexOf("done"));
    expect(events.find((event) => event.type === "replace")?.text).toBe("好的");
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].content).toBe("好的");
    expect(stored?.[0].metadata.projection).toContain("strip_period");
  });

  it("does not replace or rewrite when there is no fingerprint", async () => {
    streamWithProvider.mockImplementation(async function* () {
      yield { text: "好的。" };
    });
    const events: Array<{ type: string }> = [];
    for await (const event of runConversation({
      persona: persona(),
      userId: 1,
      message: "在吗",
      mode: "stream",
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.type === "replace")).toBe(false);
    const stored = createMessage.mock.calls.find((call) => call[0].role === "assistant");
    expect(stored?.[0].content).toBe("好的。");
  });
});
