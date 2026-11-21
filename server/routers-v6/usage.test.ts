import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

/**
 * The cost panel's server side (C8.9).
 *
 * The panel is only as honest as these numbers: a total that adds up
 * wrongly, a persona name that belongs to somebody else, a price that
 * silently becomes zero. The ledger itself is written in
 * `server/llm/usage.test.ts`; this is how it is read back.
 */
const sumLlmUsageByPurpose = vi.fn();
const sumLlmUsageByPersona = vi.fn();
const sumLlmUsageByDay = vi.fn();
const sumLlmUsageForJob = vi.fn();
const latestLlmUsageForPurpose = vi.fn();
const getLlmConfigsByUserId = vi.fn();
const getPersonasByUserId = vi.fn();
const setUserBudget = vi.fn();
const upsertLlmConfig = vi.fn();
const budgetStateForUser = vi.fn();
const monthStartInstant = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sumLlmUsageByPurpose: (...a: unknown[]) => sumLlmUsageByPurpose(...a),
  sumLlmUsageByPersona: (...a: unknown[]) => sumLlmUsageByPersona(...a),
  sumLlmUsageByDay: (...a: unknown[]) => sumLlmUsageByDay(...a),
  sumLlmUsageForJob: (...a: unknown[]) => sumLlmUsageForJob(...a),
  latestLlmUsageForPurpose: (...a: unknown[]) => latestLlmUsageForPurpose(...a),
  getLlmConfigsByUserId: (...a: unknown[]) => getLlmConfigsByUserId(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  setUserBudget: (...a: unknown[]) => setUserBudget(...a),
  upsertLlmConfig: (...a: unknown[]) => upsertLlmConfig(...a),
}));

vi.mock("../llm/budget", () => ({
  budgetStateForUser: (...a: unknown[]) => budgetStateForUser(...a),
  monthStartInstant: (...a: unknown[]) => monthStartInstant(...a),
  normalizeBudget: (value: any) => {
    if (!value || typeof value !== "object") return null;
    const tokens = Number(value.monthlyTokens);
    const cost = Number(value.monthlyCost);
    const out: Record<string, number> = {};
    if (Number.isFinite(tokens) && tokens > 0) out.monthlyTokens = tokens;
    if (Number.isFinite(cost) && cost > 0) out.monthlyCost = cost;
    return Object.keys(out).length ? out : null;
  },
}));

import { appRouter } from "../routers";

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
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
      budget: null,
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("usage.summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monthStartInstant.mockReturnValue(new Date("2026-10-31T16:00:00.000Z"));
    sumLlmUsageByPurpose.mockResolvedValue([
      { purpose: "reply", promptTokens: 600, completionTokens: 200, calls: 3, estimatedCalls: 1, costMicros: 2_000_000 },
      { purpose: "rerank", promptTokens: 100, completionTokens: 40, calls: 1, estimatedCalls: 0, costMicros: 1_000_000 },
    ]);
    sumLlmUsageByPersona.mockResolvedValue([
      { personaId: 5, promptTokens: 700, completionTokens: 240, calls: 4, estimatedCalls: 1, costMicros: 3_000_000 },
    ]);
    sumLlmUsageByDay.mockResolvedValue([
      { day: "2026-11-20", promptTokens: 700, completionTokens: 240, calls: 4, estimatedCalls: 1, costMicros: 3_000_000 },
    ]);
    budgetStateForUser.mockResolvedValue({
      budget: { monthlyTokens: 100_000 },
      over: false,
      tokens: 940,
      costMicros: 3_000_000,
      monthStart: "2026-10-31T16:00:00.000Z",
    });
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 1,
        providerName: "OpenAI",
        extraConfig: { price: { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" } },
      },
    ]);
    getPersonasByUserId.mockResolvedValue([{ id: 5, userId: 1, name: "小满" }]);
    latestLlmUsageForPurpose.mockResolvedValue({
      createdAt: new Date("2026-11-20T10:00:00.000Z"),
      promptTokens: 900,
      completionTokens: 300,
      costMicros: 4_200_000,
      estimated: false,
    });
  });

  it("adds the ledger up, and names the persona", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).usage.summary({ range: "month" });
    expect(result.totals).toEqual({
      calls: 4,
      promptTokens: 700,
      completionTokens: 240,
      estimatedCalls: 1,
      costMicros: 3_000_000,
    });
    expect(result.byPersona[0]?.name).toBe("小满");
    expect(result.currency).toBe("CNY");
    expect(result.rerank).toEqual({ calls: 1, estimatedCalls: 0, costMicros: 1_000_000 });
    expect(result.lastDistill).toMatchObject({ promptTokens: 900, costMicros: 4_200_000 });
    expect(result.from).toBe("2026-10-31T16:00:00.000Z");
  });

  it("has no currency when two prices disagree", async () => {
    getLlmConfigsByUserId.mockResolvedValue([
      { id: 1, userId: 1, providerName: "OpenAI", extraConfig: { price: { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" } } },
      { id: 2, userId: 1, providerName: "Claude", extraConfig: { price: { inputPerMTok: 3, outputPerMTok: 9, currency: "USD" } } },
    ]);
    const result = await appRouter.createCaller(ctxFor(1)).usage.summary({});
    expect(result.currency).toBeNull();
    expect(result.prices).toHaveLength(2);
  });

  it("reports nothing spent rather than failing on an empty ledger", async () => {
    sumLlmUsageByPurpose.mockResolvedValue([]);
    sumLlmUsageByPersona.mockResolvedValue([]);
    sumLlmUsageByDay.mockResolvedValue([]);
    latestLlmUsageForPurpose.mockResolvedValue(null);
    const result = await appRouter.createCaller(ctxFor(1)).usage.summary({});
    expect(result.totals.calls).toBe(0);
    expect(result.lastDistill).toBeNull();
    expect(result.rerank.calls).toBe(0);
  });
});

describe("usage.setBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetStateForUser.mockResolvedValue({
      budget: { monthlyTokens: 5000 },
      over: false,
      tokens: 10,
      costMicros: 0,
      monthStart: "2026-10-31T16:00:00.000Z",
    });
    setUserBudget.mockResolvedValue(true);
  });

  it("sets one limit without forgetting the other", async () => {
    await appRouter.createCaller(ctxFor(1)).usage.setBudget({ monthlyCost: 20 });
    expect(setUserBudget).toHaveBeenCalledWith(1, { monthlyTokens: 5000, monthlyCost: 20 });
  });

  it("removes the ceiling when both are cleared", async () => {
    await appRouter.createCaller(ctxFor(1)).usage.setBudget({ monthlyTokens: null, monthlyCost: null });
    expect(setUserBudget).toHaveBeenCalledWith(1, null);
  });
});

describe("usage.setPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertLlmConfig.mockResolvedValue(1);
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 7,
        userId: 1,
        providerName: "OpenAI",
        extraConfig: { extraBody: { top_k: 5 } },
      },
    ]);
  });

  it("keeps the provider's other settings when it stores a price", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).usage.setPrice({
      provider: "openai",
      inputPerMTok: 2,
      outputPerMTok: 8,
      currency: "CNY",
    });
    expect(result).toMatchObject({ success: true, provider: "OpenAI" });
    expect(upsertLlmConfig).toHaveBeenCalledWith(1, {
      providerName: "OpenAI",
      extraConfig: {
        extraBody: { top_k: 5 },
        price: { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" },
      },
    });
  });

  it("refuses a provider that is not configured", async () => {
    getLlmConfigsByUserId.mockResolvedValue([]);
    await expect(
      appRouter.createCaller(ctxFor(1)).usage.setPrice({
        provider: "Nope",
        inputPerMTok: 2,
        outputPerMTok: 8,
        currency: "CNY",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsertLlmConfig).not.toHaveBeenCalled();
  });
});

describe("usage.job and usage.budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sumLlmUsageForJob.mockResolvedValue({ calls: 2, promptTokens: 30, completionTokens: 10, costMicros: 100 });
    budgetStateForUser.mockResolvedValue({
      budget: { monthlyCost: 1 },
      over: true,
      tokens: 500,
      costMicros: 2_000_000,
      monthStart: "2026-10-31T16:00:00.000Z",
    });
  });

  it("reads one job's spending", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).usage.job({ jobId: "job-9" });
    expect(sumLlmUsageForJob).toHaveBeenCalledWith(1, "job-9");
    expect(result.calls).toBe(2);
  });

  it("tells the interface whether the ceiling is reached", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).usage.budget();
    expect(result.over).toBe(true);
    expect(budgetStateForUser).toHaveBeenCalledWith(1, "Asia/Shanghai");
  });
});
