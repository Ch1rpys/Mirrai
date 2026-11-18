import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getMessageById = vi.fn();
const createMessage = vi.fn();
const createFidelityPair = vi.fn();
const clearMessagePendingChoice = vi.fn();
const incrementChatCount = vi.fn();
const updatePersona = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const updateEmotionSnapshot = vi.fn();
const getUserTimezone = vi.fn();
const getUserMessageCountForPersonaSince = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const getLatestGraduationAssessment = vi.fn();
const getUserById = vi.fn();
const getLastExtractionAttemptAt = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getMessageCountInRange = vi.fn();
const getLatestGraduationAssessments = vi.fn();
const setGraduationStatus = vi.fn();
const createGraduationAssessment = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  createMessage: (...a: unknown[]) => createMessage(...a),
  createFidelityPair: (...a: unknown[]) => createFidelityPair(...a),
  clearMessagePendingChoice: (...a: unknown[]) => clearMessagePendingChoice(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  updateEmotionSnapshot: (...a: unknown[]) => updateEmotionSnapshot(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserMessageCountForPersonaSince: (...a: unknown[]) =>
    getUserMessageCountForPersonaSince(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
  getLatestGraduationAssessments: (...a: unknown[]) => getLatestGraduationAssessments(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getLastExtractionAttemptAt: (...a: unknown[]) => getLastExtractionAttemptAt(...a),
  getLastExtractionAt: vi.fn().mockResolvedValue(null),
  getLatestChatSummary: vi.fn().mockResolvedValue(null),
  getDefaultLlmConfig: vi.fn().mockResolvedValue(null),
  getRecentUserMood: vi.fn().mockResolvedValue(null),
  getRelationshipEvents: vi.fn().mockResolvedValue([]),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getMessageCountInRange: (...a: unknown[]) => getMessageCountInRange(...a),
  setGraduationStatus: (...a: unknown[]) => setGraduationStatus(...a),
  createGraduationAssessment: (...a: unknown[]) => createGraduationAssessment(...a),
}));

vi.mock("./llm/user-provider", () => ({
  resolveProviderForUser: async () => undefined,
  resolveProviderForUserWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
  resolveProviderForPurpose: async () => undefined,
  resolveProviderForPurposeWithOwnership: async () => ({
    provider: undefined,
    owned: false,
  }),
}));

vi.mock("./_core/emotion", () => ({
  inferEmotionalState: async () => ({ state: "warm", source: "heuristic" }),
  isEmotionalState: (value: string) => typeof value === "string",
}));

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    locale: "zh",
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("fidelity.choose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小A",
      emotionalState: "warm",
      presence: "active",
      graduationStatus: null,
    });
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
    createMessage.mockResolvedValue(42);
    createFidelityPair.mockResolvedValue({ id: 1 });
    clearMessagePendingChoice.mockResolvedValue(true);
    incrementChatCount.mockResolvedValue(9);
    getTodaySnapshot.mockResolvedValue(undefined);
    getUserTimezone.mockResolvedValue(null);
    getUserMessageCountForPersonaSince.mockResolvedValue(1);
    getIntimacyData.mockResolvedValue({
      chatCount: 8,
      totalMessages: 16,
      memoryCount: 0,
      emotionVariety: 1,
      daysSinceCreation: 10,
      consecutiveDays: 1,
    });
    getLatestGraduationAssessment.mockResolvedValue(undefined);
    getUserById.mockResolvedValue({ id: 1, trajectoryAssessment: "auto" });
    getLastExtractionAttemptAt.mockResolvedValue(null);
    getRecentEmotionTrend.mockResolvedValue([]);
    getMessageCountInRange.mockResolvedValue(0);
    getLatestGraduationAssessments.mockResolvedValue([]);
  });

  it("stores the chosen line and a pair", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).fidelity.choose({
      personaId: 5,
      replyToMessageId: 7,
      chosen: "好的呀",
      rejected: "好的。",
    });
    expect(result.messageId).toBe(42);
    expect(createMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: "好的呀",
    }));
    expect(createFidelityPair).toHaveBeenCalledWith(expect.objectContaining({
      chosenText: "好的呀",
      rejectedText: "好的。",
      personaId: 5,
      userId: 1,
      messageId: 42,
    }));
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).fidelity.choose({
        personaId: 99,
        replyToMessageId: 7,
        chosen: "好的呀",
        rejected: "好的。",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createFidelityPair).not.toHaveBeenCalled();
  });
});
