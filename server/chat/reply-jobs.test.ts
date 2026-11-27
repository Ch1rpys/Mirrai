import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseZoneless } from "@shared/timezone";
import { CHANNEL_READ_WINDOW_MS, READ_WINDOW_MS, resetInbox } from "./inbox";

const stored: Array<Record<string, unknown>> = [];
let nextMessageId = 1;

type Job = {
  id: number;
  userId: number;
  personaId: number;
  kind: string;
  status: string;
  reason: string;
  dueAt: Date;
  channel: string;
  targetId: string | null;
  locale: string;
  periodId: string | null;
  attempts: number;
  claimedAt: Date | null;
  payload: unknown;
  createdAt: Date;
  finishedAt: Date | null;
};

let jobs: Job[] = [];
let nextJobId = 1;

const createMessage = vi.fn(async (row: Record<string, unknown>) => {
  const id = nextMessageId++;
  stored.push({ createdAt: new Date(), ...row, id });
  return id;
});
const getMessagesByPersonaId = vi.fn(async () => stored.slice());
const getDefaultLlmConfig = vi.fn();
const getTodaySnapshot = vi.fn();
const createEmotionSnapshot = vi.fn();
const getIntimacyData = vi.fn();
const updateIntimacy = vi.fn();
const updatePersona = vi.fn();
const incrementChatCount = vi.fn();
const getPersonaById = vi.fn();
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
const updateMessageMetadata = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const searchRecordsLexical = vi.fn();
const createFidelityPair = vi.fn();
const clearMessagePendingChoice = vi.fn();
const getMessageById = vi.fn();
const updateEmotionSnapshot = vi.fn();
const deleteMessage = vi.fn();

const createReplyJob = vi.fn(async (data: Omit<Job, "id" | "createdAt" | "finishedAt" | "claimedAt"> & Partial<Job>) => {
  const existing = jobs.find((job) =>
    job.userId === data.userId
    && job.personaId === data.personaId
    && job.kind === "reply"
    && (job.status === "pending" || job.status === "running"),
  );
  if (existing) return existing;
  const row: Job = {
    id: nextJobId++,
    userId: data.userId,
    personaId: data.personaId,
    kind: data.kind ?? "reply",
    status: data.status ?? "pending",
    reason: data.reason ?? "delay",
    dueAt: data.dueAt,
    channel: data.channel ?? "web",
    targetId: data.targetId ?? null,
    locale: data.locale ?? "zh",
    periodId: data.periodId ?? null,
    attempts: data.attempts ?? 0,
    claimedAt: null,
    payload: data.payload ?? {},
    createdAt: new Date(),
    finishedAt: null,
  };
  jobs.push(row);
  return row;
});
const getReplyJobById = vi.fn(async (id: number, userId: number) =>
  jobs.find((job) => job.id === id && job.userId === userId) ?? null,
);
const getPendingReplyJob = vi.fn(async (personaId: number, userId: number, kind = "reply") =>
  jobs.find((job) =>
    job.personaId === personaId
    && job.userId === userId
    && job.kind === kind
    && (job.status === "pending" || job.status === "running"),
  ) ?? null,
);
const listDueReplyJobs = vi.fn(async (now: Date) =>
  jobs.filter((job) => job.status === "pending" && job.dueAt.getTime() <= now.getTime()),
);
const claimReplyJob = vi.fn(async (id: number, userId: number) => {
  const job = jobs.find((row) => row.id === id && row.userId === userId);
  if (!job || job.status !== "pending") return false;
  job.status = "running";
  job.claimedAt = new Date();
  return true;
});
const finishReplyJob = vi.fn(async (id: number, userId: number, status: string) => {
  const job = jobs.find((row) => row.id === id && row.userId === userId);
  if (!job) return false;
  job.status = status;
  job.finishedAt = new Date();
  job.claimedAt = null;
  return true;
});
const retryReplyJob = vi.fn(async (id: number, userId: number, dueAt: Date, attempts: number) => {
  const job = jobs.find((row) => row.id === id && row.userId === userId);
  if (!job) return false;
  job.status = "pending";
  job.dueAt = dueAt;
  job.attempts = attempts;
  job.claimedAt = null;
  return true;
});
const cancelPendingReplyJobs = vi.fn(async (personaId: number, userId: number) => {
  let n = 0;
  for (const job of jobs) {
    if (job.personaId === personaId && job.userId === userId
      && (job.status === "pending" || job.status === "running")) {
      job.status = "cancelled";
      job.finishedAt = new Date();
      n += 1;
    }
  }
  return n;
});

vi.mock("../storage", () => ({
  storageToDataUrl: vi.fn(),
}));

vi.mock("../db", () => ({
  getRecentCheckinAnswers: vi.fn().mockResolvedValue([]),
  createMessage: (...a: unknown[]) => (createMessage as (...args: unknown[]) => unknown)(...a),
  getDefaultLlmConfig: (...a: unknown[]) => getDefaultLlmConfig(...a),
  getTodaySnapshot: (...a: unknown[]) => getTodaySnapshot(...a),
  createEmotionSnapshot: (...a: unknown[]) => createEmotionSnapshot(...a),
  getIntimacyData: (...a: unknown[]) => getIntimacyData(...a),
  updateIntimacy: (...a: unknown[]) => updateIntimacy(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessagesByPersonaId: (...a: unknown[]) => (getMessagesByPersonaId as (...args: unknown[]) => unknown)(...a),
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
  getUserMessageCountForPersonaSince: (...a: unknown[]) => getUserMessageCountForPersonaSince(...a),
  getDailyUserChatCounts: (...a: unknown[]) => getDailyUserChatCounts(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  updateMessageMetadata: (...a: unknown[]) => updateMessageMetadata(...a),
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  searchRecordsLexical: (...a: unknown[]) => searchRecordsLexical(...a),
  createFidelityPair: (...a: unknown[]) => createFidelityPair(...a),
  clearMessagePendingChoice: (...a: unknown[]) => clearMessagePendingChoice(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  updateEmotionSnapshot: (...a: unknown[]) => updateEmotionSnapshot(...a),
  deleteMessage: (...a: unknown[]) => deleteMessage(...a),
  createReplyJob: (...a: unknown[]) => (createReplyJob as (...args: unknown[]) => unknown)(...a),
  getReplyJobById: (...a: unknown[]) => (getReplyJobById as (...args: unknown[]) => unknown)(...a),
  getPendingReplyJob: (...a: unknown[]) => (getPendingReplyJob as (...args: unknown[]) => unknown)(...a),
  listDueReplyJobs: (...a: unknown[]) => (listDueReplyJobs as (...args: unknown[]) => unknown)(...a),
  claimReplyJob: (...a: unknown[]) => (claimReplyJob as (...args: unknown[]) => unknown)(...a),
  finishReplyJob: (...a: unknown[]) => (finishReplyJob as (...args: unknown[]) => unknown)(...a),
  retryReplyJob: (...a: unknown[]) => (retryReplyJob as (...args: unknown[]) => unknown)(...a),
  cancelPendingReplyJobs: (...a: unknown[]) => (cancelPendingReplyJobs as (...args: unknown[]) => unknown)(...a),
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
vi.mock("../_core/emotion", () => ({
  inferEmotionalState: (...a: unknown[]) => inferEmotionalState(...a),
}));

const pushToUser = vi.fn();
vi.mock("../_core/push", () => ({
  pushToUser: (...a: unknown[]) => pushToUser(...a),
}));

const send = vi.fn();
vi.mock("../channels", () => ({
  getChannelAdapter: (id: string) => (
    ["feishu", "wechat", "telegram", "discord", "matrix"].includes(id)
      ? { send: (userId: number, targetId: string, text: string, locale?: string) =>
          send(userId, targetId, text, locale) }
      : undefined
  ),
}));

import { ENV } from "../_core/env";
import { runConversation } from "./service";
import {
  clearReplyJobTimers,
  computeReplyDue,
  replyNow,
  runReplyJob,
  sweepReplyJobs,
} from "./reply-jobs";

const NOW = new Date("2024-06-01T12:00:00.000Z");

function persona(extra: Record<string, unknown> = {}) {
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
    timingEnabled: true,
    timezone: "Asia/Shanghai",
    behaviorProfile: {
      samples: 20,
      replyGapMedianSec: 90,
      replyGapLogSigma: 0.8,
      burstSizes: [1],
      measuredAt: "2026-01-01T00:00:00.000Z",
    },
    settings: { timing: { asyncDelivery: true, maxDelayMinutes: 30, sleep: false } },
    styleProfile: {
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "40:40",
      replyDelay: {
        samples: 40,
        resolution: "second",
        buckets: {
          all: { n: 40, mu: Math.log(1200), sigma: 0 },
        },
      },
    },
    ...extra,
  } as any;
}

function delayProfile(seconds: number) {
  return {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "40:40",
    replyDelay: {
      samples: 40,
      resolution: "second",
      buckets: { all: { n: 40, mu: Math.log(seconds), sigma: 0 } },
    },
  };
}

async function drain(
  personaRow: unknown,
  message: string,
  now = NOW,
  extra: { channel?: string; conversationKey?: string } = {},
) {
  const events: Array<Record<string, unknown>> = [];
  const running = (async () => {
    for await (const event of runConversation({
      persona: personaRow as any,
      userId: 1,
      message,
      mode: "once",
      now,
      channel: extra.channel as any,
      conversationKey: extra.conversationKey,
    })) {
      events.push(event as Record<string, unknown>);
    }
  })();
  const wait = extra.channel === "wechat" || extra.channel === "feishu"
    ? CHANNEL_READ_WINDOW_MS
    : READ_WINDOW_MS;
  await vi.advanceTimersByTimeAsync(wait);
  await running;
  return events;
}

describe("queued replies", () => {
  beforeEach(() => {
    resetInbox();
    clearReplyJobTimers();
    stored.length = 0;
    nextMessageId = 1;
    jobs = [];
    nextJobId = 1;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

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
    getLastMessageAt.mockResolvedValue(new Date());
    getMessageCountSince.mockResolvedValue(1);
    getDailyChatCounts.mockResolvedValue([]);
    getSessionStartAt.mockResolvedValue(new Date());
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
    inferEmotionalState.mockResolvedValue({ state: "warm", source: "heuristic" });
    resolveProviderForUser.mockResolvedValue({
      name: "Test",
      isConfigured: () => true,
      capabilities: { streaming: true, vision: true, tools: false, jsonMode: false },
      invoke,
      stream: async function* () { yield { text: "" }; },
    });
    resolveProviderForPurpose.mockImplementation((...a: unknown[]) => resolveProviderForUser(...a));
    invokeWithProvider.mockResolvedValue("在的。");
    updateMessageMetadata.mockResolvedValue(true);
    candidateRecordsByOverlap.mockResolvedValue([]);
    searchRecordsLexical.mockResolvedValue([]);
    createFidelityPair.mockResolvedValue({ id: 1 });
    clearMessagePendingChoice.mockResolvedValue(true);
    incrementChatCount.mockResolvedValue(11);
    getMessageById.mockResolvedValue(null);
    updateEmotionSnapshot.mockResolvedValue(undefined);
    deleteMessage.mockResolvedValue(true);
    getPersonaById.mockImplementation(async () => persona());
    pushToUser.mockResolvedValue(1);
    send.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearReplyJobTimers();
    vi.useRealTimers();
  });

  it("queues a twenty-minute delay instead of calling the model", async () => {
    const events = await drain(persona(), "在吗");
    expect(events.map((event) => event.type)).toEqual(["deferred"]);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("pending");
    expect(jobs[0]?.dueAt.getTime()).toBe(NOW.getTime() + 1_200_000);
  });

  it("writes the reply, marks the job done, and pushes when the wait is over", async () => {
    const events = await drain(persona(), "在吗");
    const deferred = events[0] as { jobId: number; dueAt: string };
    vi.setSystemTime(new Date(deferred.dueAt));
    await runReplyJob(deferred.jobId, 1);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    const assistant = stored.filter((row) => row.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.metadata).toMatchObject({
      deferred: { jobId: deferred.jobId, reason: "delay" },
    });
    expect(pushToUser).toHaveBeenCalledWith(1, expect.objectContaining({
      kind: "reply",
      personaId: 1,
      personaName: "小A",
    }));
    expect(jobs[0]?.status).toBe("done");
  });

  it("keeps one job when more messages arrive while waiting, and answers all of them", async () => {
    await drain(persona(), "一");
    await drain(persona(), "二");
    await drain(persona(), "三");
    expect(jobs).toHaveLength(1);
    expect(invokeWithProvider).not.toHaveBeenCalled();
    vi.setSystemTime(jobs[0]!.dueAt);
    await runReplyJob(jobs[0]!.id, 1);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    const call = invokeWithProvider.mock.calls[0]?.[1] as {
      messages?: Array<{ role: string; content: string }>;
    };
    const userLines = (call?.messages ?? [])
      .filter((row) => row.role === "user")
      .map((row) => row.content);
    expect(userLines).toEqual(["一", "二", "三"]);
  });

  it("does not queue a forty-second delay", async () => {
    const events = await drain(persona({ styleProfile: delayProfile(40) }), "在吗");
    expect(events.some((event) => event.type === "deferred")).toBe(false);
    expect(events.some((event) => event.type === "delay" && event.ms === 40_000)).toBe(true);
    expect(jobs).toHaveLength(0);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("caps an ordinary delay at maxDelayMinutes", async () => {
    const events = await drain(persona({
      settings: { timing: { asyncDelivery: true, maxDelayMinutes: 5, sleep: false } },
      styleProfile: delayProfile(3 * 3600),
    }), "在吗");
    expect(events[0]?.type).toBe("deferred");
    expect(jobs[0]?.dueAt.getTime()).toBe(NOW.getTime() + 5 * 60_000);
  });

  it("does not cap sleep, and does cap when sleep is off", async () => {
    const night = parseZoneless("2024-06-02 00:30", "Asia/Shanghai")!;
    vi.setSystemTime(night);
    const asleep = persona({
      settings: { timing: { asyncDelivery: true, maxDelayMinutes: 5, sleep: true } },
      styleProfile: {
        ...delayProfile(1200),
        routine: { days: 80, sleep: { startMin: 0, endMin: 450 } },
      },
    });
    const slept = await drain(asleep, "在吗", night);
    const wake = parseZoneless("2024-06-02 07:30", "Asia/Shanghai")!;
    expect(slept[0]?.type).toBe("deferred");
    expect(jobs[0]?.reason).toBe("asleep");
    expect(jobs[0]?.dueAt.getTime()).toBe(wake.getTime() + 1_200_000);

    jobs = [];
    nextJobId = 1;
    stored.length = 0;
    nextMessageId = 1;
    resetInbox();
    const awake = await drain(persona({
      settings: { timing: { asyncDelivery: true, maxDelayMinutes: 5, sleep: false } },
      styleProfile: {
        ...delayProfile(1200),
        routine: { days: 80, sleep: { startMin: 0, endMin: 450 } },
      },
    }), "在吗", night);
    expect(awake[0]?.type).toBe("deferred");
    expect(jobs[0]?.reason).toBe("delay");
    expect(jobs[0]?.dueAt.getTime()).toBe(night.getTime() + 5 * 60_000);
  });

  it("sleeps on the user's clock when the persona has no timezone", async () => {
    const night = parseZoneless("2024-06-02 03:00", "Asia/Shanghai")!;
    vi.setSystemTime(night);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    const events = await drain(persona({
      timezone: null,
      settings: { timing: { asyncDelivery: true, maxDelayMinutes: 5, sleep: true } },
      styleProfile: {
        ...delayProfile(1200),
        routine: { days: 80, sleep: { startMin: 0, endMin: 450 } },
      },
    }), "在吗", night);
    expect(events[0]?.type).toBe("deferred");
    expect(jobs[0]?.reason).toBe("asleep");
    expect(jobs[0]?.dueAt.getTime()).toBe(
      parseZoneless("2024-06-02 07:30", "Asia/Shanghai")!.getTime() + 1_200_000,
    );
  });

  it("does not queue a weak signal", async () => {
    const events = await drain(persona(), "我好累");
    expect(events.some((event) => event.type === "deferred")).toBe(false);
    expect(invokeWithProvider).toHaveBeenCalled();
    expect(jobs).toHaveLength(0);
  });

  it("does not queue a crisis or someone saying they are sad", async () => {
    for (const message of ["我想死", "我很难过"]) {
      resetInbox();
      stored.length = 0;
      nextMessageId = 1;
      jobs = [];
      nextJobId = 1;
      invokeWithProvider.mockClear();
      const events = await drain(persona(), message);
      expect(events.some((event) => event.type === "deferred"), message).toBe(false);
      expect(jobs, message).toHaveLength(0);
    }
  });

  it("lets only one of two overlapping claims call the model", async () => {
    await drain(persona(), "在吗");
    const id = jobs[0]!.id;
    vi.setSystemTime(jobs[0]!.dueAt);
    const first = runReplyJob(id, 1);
    const second = runReplyJob(id, 1);
    await Promise.all([first, second]);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("marks the job failed after three model errors and leaves a notice", async () => {
    await drain(persona(), "在吗");
    const id = jobs[0]!.id;
    invokeWithProvider.mockRejectedValue(new Error("down"));
    await runReplyJob(id, 1);
    await runReplyJob(id, 1);
    await runReplyJob(id, 1);
    expect(jobs[0]?.status).toBe("failed");
    const notice = stored.find((row) => row.origin === "system-notice");
    expect(notice?.content).toBe("这条没回成。可以再发一次，或者到设置里看看模型是不是通的。");
  });

  it("runs a pending job immediately on replyNow", async () => {
    await drain(persona(), "在吗");
    expect(jobs[0]?.status).toBe("pending");
    await replyNow(1, 1);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(jobs[0]?.status).toBe("done");
  });

  it("picks up a due job after the in-process timers are gone", async () => {
    await drain(persona(), "在吗");
    clearReplyJobTimers();
    vi.setSystemTime(jobs[0]!.dueAt);
    await sweepReplyJobs(jobs[0]!.dueAt);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(jobs[0]?.status).toBe("done");
  });

  it("answers from the in-process timer when the moment comes (B5.2)", async () => {
    // The queued-reply timers are what make a deferred answer arrive
    // without a sweep running; the tests only ever called
    // `runReplyJob` by hand.
    pushToUser.mockClear();
    const events = await drain(persona(), "在吗");
    expect(events[0]?.type).toBe("deferred");
    expect(jobs[0]?.status).toBe("pending");
    const wait = jobs[0]!.dueAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(wait + 1);
    expect(jobs[0]?.status).toBe("done");
    expect(pushToUser).toHaveBeenCalledWith(1, expect.objectContaining({ kind: "reply" }));
  });

  it("computes busy as the window end plus the delay, capped", () => {
    const now = NOW;
    const busyUntil = new Date(now.getTime() + 40 * 60_000);
    const due = computeReplyDue({
      now,
      delayMs: 20 * 60_000,
      maxDelayMinutes: 30,
      sleep: false,
      asleep: false,
      wakeAt: null,
      busyUntil,
    });
    expect(due.reason).toBe("busy");
    expect(due.dueAt.getTime()).toBe(now.getTime() + 30 * 60_000);
  });

  it("sends a deferred burst through the channel one bubble at a time", async () => {
    invokeWithProvider.mockResolvedValue("嗯\n好\n在");
    const bursting = persona({
      behaviorProfile: {
        samples: 20,
        replyGapMedianSec: 90,
        replyGapLogSigma: 0.8,
        burstSizes: [3],
        measuredAt: "2026-01-01T00:00:00.000Z",
      },
    });
    getPersonaById.mockImplementation(async () => bursting);
    const events = await drain(bursting, "在吗", NOW, { channel: "feishu", conversationKey: "oc_1" });
    expect(events[0]?.type).toBe("deferred");
    expect(jobs[0]?.channel).toBe("feishu");
    expect(jobs[0]?.targetId).toBe("oc_1");
    vi.setSystemTime(jobs[0]!.dueAt);
    send.mockClear();
    const sending = runReplyJob(jobs[0]!.id, 1);
    await vi.advanceTimersByTimeAsync(20_000);
    await sending;
    expect(send.mock.calls.map((call) => call[2])).toEqual(["嗯", "好", "在"]);
    expect(jobs[0]?.status).toBe("done");
  });

  it("says the channel did not deliver and does not generate the reply again", async () => {
    const events = await drain(persona(), "在吗", NOW, { channel: "feishu", conversationKey: "oc_1" });
    expect(events[0]?.type).toBe("deferred");
    vi.setSystemTime(jobs[0]!.dueAt);
    send.mockRejectedValueOnce(new Error("refused"));
    await runReplyJob(jobs[0]!.id, 1);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(retryReplyJob).not.toHaveBeenCalled();
    expect(jobs[0]?.status).toBe("failed");
    const notice = stored.find((row) => row.origin === "system-notice");
    expect(notice?.content).toBe("消息没有发出去：通道没有把这条消息送达。");
  });

  it("stops a burst when a later bubble cannot be sent", async () => {
    invokeWithProvider.mockResolvedValue("嗯\n好\n在");
    const bursting = persona({
      behaviorProfile: {
        samples: 20,
        replyGapMedianSec: 90,
        replyGapLogSigma: 0.8,
        burstSizes: [3],
        measuredAt: "2026-01-01T00:00:00.000Z",
      },
    });
    getPersonaById.mockImplementation(async () => bursting);
    await drain(bursting, "在吗", NOW, { channel: "feishu", conversationKey: "oc_1" });
    vi.setSystemTime(jobs[0]!.dueAt);
    send.mockReset();
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("refused"));
    invokeWithProvider.mockClear();
    const sending = runReplyJob(jobs[0]!.id, 1);
    await vi.advanceTimersByTimeAsync(20_000);
    await sending;
    expect(send.mock.calls.map((call) => call[2])).toEqual(["嗯", "好"]);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    expect(jobs[0]?.status).toBe("failed");
  });

  it("writes one reply rather than a choice when a deferred turn comes due", async () => {
    const chooser = persona({
      chatCount: 8,
      settings: {
        timing: { asyncDelivery: true, maxDelayMinutes: 30, sleep: false },
        layers: { abPairs: true },
      },
    });
    getPersonaById.mockImplementation(async () => chooser);
    const events = await drain(chooser, "在吗");
    expect(events[0]?.type).toBe("deferred");
    expect(jobs).toHaveLength(1);
    vi.setSystemTime(jobs[0]!.dueAt);
    await runReplyJob(jobs[0]!.id, 1);
    expect(jobs[0]?.status).toBe("done");
    const assistant = stored.filter((row) => row.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.content).toBe("在的。");
  });

function doubleTextProfile(rate = 1) {
  return {
    samples: 30,
    opportunities: 40,
    rate,
    waitSec: { p25: 480, median: 540, p75: 600 },
    lines: [{ text: "人呢", n: 21 }, { text: "？", n: 9 }],
  };
}

function followPersona(extra: Record<string, unknown> = {}) {
  const { settings, styleProfile, ...rest } = extra;
  return persona({
    settings: settings ?? { timing: { asyncDelivery: true, followUp: true, sleep: false } },
    styleProfile: styleProfile ?? { ...delayProfile(40), doubleText: doubleTextProfile() },
    ...rest,
  });
}

describe("a follow-up after they go quiet", () => {
  const quietHours = ENV.reminderQuietHours;

  beforeEach(() => {
    invokeWithProvider.mockClear();
    pushToUser.mockClear();
    incrementChatCount.mockClear();
    createMessage.mockClear();
    getPersonaById.mockImplementation(async () => followPersona());
  });

  afterEach(() => {
    ENV.reminderQuietHours = quietHours;
  });

  async function seedFollowUp(opts?: {
    persona?: ReturnType<typeof followPersona>;
    userText?: string;
    extra?: Array<Record<string, unknown>>;
    payload?: Record<string, unknown>;
  }) {
    const row = opts?.persona ?? followPersona();
    getPersonaById.mockImplementation(async () => row);
    stored.push(
      {
        id: 1,
        role: "user",
        content: opts?.userText ?? "在吗",
        createdAt: new Date(NOW.getTime() - 120_000),
      },
      {
        id: 2,
        role: "assistant",
        content: "在的。",
        createdAt: NOW,
      },
      ...(opts?.extra ?? []),
    );
    nextMessageId = Math.max(3, ...stored.map((item) => Number(item.id) + 1));
    return createReplyJob({
      userId: 1,
      personaId: 1,
      kind: "followup",
      status: "pending",
      reason: "followup",
      dueAt: NOW,
      channel: "web",
      targetId: null,
      locale: "zh",
      periodId: null,
      attempts: 0,
      payload: opts?.payload ?? { afterMessageId: 2 },
    });
  }

  async function expectCancelled() {
    const job = jobs[0]!;
    await runReplyJob(job.id, 1);
    expect(job.status).toBe("cancelled");
    expect(createMessage).not.toHaveBeenCalled();
    expect(invokeWithProvider).not.toHaveBeenCalled();
  }

  it("sends a stored line without calling the model", async () => {
    const events = await drain(followPersona(), "在吗");
    expect(events.some((event) => event.type === "deferred")).toBe(false);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("followup");
    expect(jobs[0]?.reason).toBe("followup");
    expect(jobs[0]!.dueAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 3 * 60_000);
    expect(jobs[0]!.dueAt.getTime()).toBeLessThanOrEqual(NOW.getTime() + 60 * 60_000);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);

    vi.setSystemTime(jobs[0]!.dueAt);
    await runReplyJob(jobs[0]!.id, 1);
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
    const follow = stored.filter((row) => row.origin === "followup");
    expect(follow).toHaveLength(1);
    expect(["人呢", "？"]).toContain(follow[0]?.content);
    expect(jobs[0]?.status).toBe("done");
    expect(pushToUser).toHaveBeenCalledWith(1, expect.objectContaining({
      kind: "followup",
      personaId: 1,
      personaName: "小A",
    }));
    expect(stored.filter((row) => row.origin === "proactive")).toHaveLength(0);
    expect(pushToUser).not.toHaveBeenCalledWith(1, expect.objectContaining({ kind: "proactive" }));
  });

  it("sends a deferred line on the channel it came from (B5.2/B5.8)", async () => {
    // A reply that is written later used to go out as a web push on every
    // channel except WeChat and Feishu: the person was talking on
    // Telegram and got nothing there. The row now carries the real
    // channel, and the adapter for it does the sending.
    getPersonaById.mockImplementation(async () => followPersona());
    stored.push(
      { id: 1, role: "user", content: "在吗", createdAt: new Date(NOW.getTime() - 120_000) },
      { id: 2, role: "assistant", content: "在的。", createdAt: NOW },
    );
    nextMessageId = 3;
    const job = await createReplyJob({
      userId: 1,
      personaId: 1,
      kind: "followup",
      status: "pending",
      reason: "followup",
      dueAt: NOW,
      channel: "telegram",
      targetId: "chat-9",
      locale: "zh",
      periodId: null,
      attempts: 0,
      payload: { afterMessageId: 2 },
    });
    pushToUser.mockClear();
    send.mockClear();
    await runReplyJob(job.id, 1);
    expect(send).toHaveBeenCalledWith(
      1,
      "chat-9",
      expect.stringMatching(/人呢|？/),
      "zh",
    );
    expect(pushToUser).not.toHaveBeenCalled();
    // The line belongs to the conversation it was spoken in, so the
    // stored row says so too.
    const follow = stored.find((row) => row.origin === "followup");
    expect(follow?.channel).toBe("telegram");
  });

  it("marks the follow-up as the record's own line (C10.7)", async () => {
    candidateRecordsByOverlap.mockImplementation(async (
      _personaId: number,
      _userId: number,
      params: { text: string },
    ) => [{
      id: 77,
      content: params.text,
      timestamp: new Date("2023-03-04T12:00:00.000Z"),
      role: "assistant",
      speaker: "小满",
      coverage: 1,
    }]);
    await drain(followPersona(), "在吗");
    expect(jobs).toHaveLength(1);
    vi.setSystemTime(jobs[0]!.dueAt);
    await runReplyJob(jobs[0]!.id, 1);
    const follow = stored.filter((row) => row.origin === "followup");
    expect(follow).toHaveLength(1);
    const marked = updateMessageMetadata.mock.calls.filter(
      (call: unknown[]) => (call[3] as { provenance?: unknown[] } | undefined)?.provenance,
    ).at(-1);
    expect(marked).toBeTruthy();
    const provenance = (marked![3] as { provenance: Array<{ start: number; end: number; recordId: number }> }).provenance;
    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.start).toBe(0);
    expect(provenance[0]!.recordId).toBe(77);
    // The whole stored line is covered.
    const markedMessage = stored.find((row) => row.id === marked![0]!);
    expect(provenance[0]!.end).toBe(String(markedMessage?.content ?? "").length);
    // Picking the line is not a model call.
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("does not queue when late replies are off, even if follow-up was left on", async () => {
    await drain(followPersona({
      settings: { timing: { asyncDelivery: false, followUp: true, sleep: false } },
    }), "在吗");
    expect(jobs.filter((job) => job.kind === "followup")).toHaveLength(0);
  });

  it("does not queue when the switch is off", async () => {
    await drain(followPersona({
      settings: { timing: { asyncDelivery: true, followUp: false, sleep: false } },
    }), "在吗");
    expect(jobs).toHaveLength(0);
  });

  it("does not queue a crisis, a weak signal, or someone saying they are sad", async () => {
    for (const message of ["我想死", "我好累", "我很难过"]) {
      resetInbox();
      stored.length = 0;
      nextMessageId = 1;
      jobs = [];
      nextJobId = 1;
      invokeWithProvider.mockClear();
      await drain(followPersona(), message);
      expect(jobs, message).toHaveLength(0);
    }
  });

  it("cancels when the user has already replied", async () => {
    await seedFollowUp({
      extra: [{ id: 3, role: "user", content: "在", createdAt: NOW }],
    });
    await expectCancelled();
  });

  it("cancels when the last user line is older than thirty minutes", async () => {
    stored.push(
      {
        id: 1,
        role: "user",
        content: "在吗",
        createdAt: new Date(NOW.getTime() - 31 * 60_000),
      },
      {
        id: 2,
        role: "assistant",
        content: "在的。",
        createdAt: NOW,
      },
    );
    nextMessageId = 3;
    getPersonaById.mockImplementation(async () => followPersona());
    await createReplyJob({
      userId: 1,
      personaId: 1,
      kind: "followup",
      status: "pending",
      reason: "followup",
      dueAt: NOW,
      channel: "web",
      targetId: null,
      locale: "zh",
      periodId: null,
      attempts: 0,
      payload: { afterMessageId: 2 },
    });
    await expectCancelled();
  });

  it("cancels a farewell", async () => {
    await seedFollowUp({ userText: "晚安" });
    await expectCancelled();
  });

  it("cancels a crisis line", async () => {
    await seedFollowUp({ userText: "我想死" });
    await expectCancelled();
  });

  it("cancels a weak signal", async () => {
    await seedFollowUp({ userText: "我好累" });
    await expectCancelled();
  });

  it("cancels when they said they are sad", async () => {
    await seedFollowUp({ userText: "我很难过" });
    await expectCancelled();
  });

  it("cancels when this chat already had a follow-up", async () => {
    getSessionStartAt.mockResolvedValue(new Date(NOW.getTime() - 10 * 60_000));
    await seedFollowUp({
      extra: [{
        id: 3,
        role: "assistant",
        origin: "followup",
        content: "人呢",
        createdAt: new Date(NOW.getTime() - 60_000),
      }],
    });
    await expectCancelled();
  });

  it("cancels when they were already followed up twice today", async () => {
    await seedFollowUp({
      extra: [
        {
          id: 3,
          role: "assistant",
          origin: "followup",
          content: "人呢",
          createdAt: new Date(NOW.getTime() - 3 * 3600_000),
        },
        {
          id: 4,
          role: "assistant",
          origin: "followup",
          content: "？",
          createdAt: new Date(NOW.getTime() - 2 * 3600_000),
        },
      ],
    });
    await expectCancelled();
  });

  it("cancels in quiet hours", async () => {
    await seedFollowUp();
    vi.setSystemTime(parseZoneless("2024-06-02 00:30", "Asia/Shanghai")!);
    await expectCancelled();
  });

  it("does not follow up between midnight and five, whatever the quiet hours say (C10.5)", async () => {
    /**
     * The quiet hours are a setting; the middle of the night is not.
     * Changing the window must not let a follow-up arrive at 02:30.
     */
    ENV.reminderQuietHours = "13:00-14:00";
    await seedFollowUp();
    vi.setSystemTime(parseZoneless("2024-06-02 02:30", "Asia/Shanghai")!);
    await expectCancelled();
  });

  it("cancels when the other person said no (C10.3)", async () => {
    await seedFollowUp({
      persona: followPersona({
        settings: {
          timing: { asyncDelivery: true, followUp: true, sleep: false },
          consent: "asked_no",
        },
      }),
    });
    vi.setSystemTime(NOW);
    await expectCancelled();
  });

  it("cancels when they are asleep", async () => {
    ENV.reminderQuietHours = "00:00-00:01";
    const afternoon = parseZoneless("2024-06-01 13:00", "Asia/Shanghai")!;
    vi.setSystemTime(afternoon);
    await seedFollowUp({
      persona: followPersona({
        settings: { timing: { asyncDelivery: true, followUp: true, sleep: true } },
        styleProfile: {
          ...delayProfile(40),
          doubleText: doubleTextProfile(),
          routine: { days: 80, sleep: { startMin: 12 * 60, endMin: 14 * 60 } },
        },
      }),
    });
    await expectCancelled();
  });

  it("cancels when they are not present", async () => {
    await seedFollowUp({ persona: followPersona({ presence: "quiet" }) });
    await expectCancelled();
  });

  it("cancels during taper", async () => {
    await seedFollowUp({
      persona: followPersona({
        settings: {
          timing: { asyncDelivery: true, followUp: true, sleep: false },
          taper: { stage: 1 },
        },
      }),
    });
    await expectCancelled();
  });

  it("cancels in memorial mode", async () => {
    await seedFollowUp({
      persona: followPersona({
        settings: {
          timing: { asyncDelivery: true, followUp: true, sleep: false },
          mode: "memorial",
        },
      }),
    });
    await expectCancelled();
  });

  it("cancels when the draw misses", async () => {
    await seedFollowUp({
      persona: followPersona({
        styleProfile: { ...delayProfile(40), doubleText: doubleTextProfile(0) },
      }),
    });
    await expectCancelled();
  });

  it("cancels when the switch is off at fire time", async () => {
    await seedFollowUp({
      persona: followPersona({
        settings: { timing: { asyncDelivery: true, followUp: false, sleep: false } },
      }),
    });
    await expectCancelled();
  });

  it("delivers a follow-up through the channel they were talking on", async () => {
    await seedFollowUp();
    jobs[0]!.channel = "feishu";
    jobs[0]!.targetId = "oc_1";
    await runReplyJob(jobs[0]!.id, 1);
    expect(jobs[0]?.status).toBe("done");
    expect(send).toHaveBeenCalledWith(
      1,
      "oc_1",
      expect.stringMatching(/^(人呢|？)$/),
      "zh",
    );
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });
});
});
