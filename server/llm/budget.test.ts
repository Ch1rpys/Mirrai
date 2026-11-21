import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The monthly ceiling (C8.9).
 *
 * Two things are worth pinning down: the month is the user's own month,
 * and a malformed budget can never switch anything off (a typo must not
 * be read as "zero allowed").
 */
const getUserBudget = vi.fn();
const sumLlmUsageByPurpose = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserBudget: (...a: unknown[]) => getUserBudget(...a),
  sumLlmUsageByPurpose: (...a: unknown[]) => sumLlmUsageByPurpose(...a),
}));

import {
  budgetExceeded,
  budgetStateForUser,
  monthStartInstant,
  normalizeBudget,
} from "./budget";

describe("a stored budget", () => {
  it("reads the two limits", () => {
    expect(normalizeBudget({ monthlyTokens: 5000, monthlyCost: 12.5 }))
      .toEqual({ monthlyTokens: 5000, monthlyCost: 12.5 });
    expect(normalizeBudget({ monthlyTokens: 5000 })).toEqual({ monthlyTokens: 5000 });
    expect(normalizeBudget({ monthlyCost: 3 })).toEqual({ monthlyCost: 3 });
  });

  it("treats an empty or broken value as no ceiling", () => {
    expect(normalizeBudget(null)).toBeNull();
    expect(normalizeBudget({})).toBeNull();
    expect(normalizeBudget("5000")).toBeNull();
    expect(normalizeBudget({ monthlyTokens: "abc" })).toBeNull();
    expect(normalizeBudget({ monthlyTokens: -1 })).toBeNull();
    expect(normalizeBudget({ monthlyCost: 0 })).toBeNull();
  });
});

describe("the month being counted", () => {
  it("starts at the user's own month boundary, not the server's", () => {
    // 2026-11-21 15:00 in Shanghai is 07:00 UTC. November in Shanghai
    // began at 00:00 Shanghai = 2026-10-31T16:00Z.
    const shanghai = monthStartInstant(
      new Date("2026-11-21T07:00:00.000Z"),
      "Asia/Shanghai",
    );
    expect(shanghai.toISOString()).toBe("2026-10-31T16:00:00.000Z");

    // The same instant is still October in New York, whose November
    // begins at 00:00 EDT = 04:00Z on the 1st.
    const november = monthStartInstant(
      new Date("2026-11-15T12:00:00.000Z"),
      "America/New_York",
    );
    expect(november.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("falls back to UTC when no zone is known", () => {
    expect(
      monthStartInstant(new Date("2026-11-21T07:00:00.000Z"), null).toISOString(),
    ).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("how much of it is used", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserBudget.mockResolvedValue(null);
    sumLlmUsageByPurpose.mockResolvedValue([]);
  });

  it("is not over when the user set no ceiling", async () => {
    const state = await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-15T00:00:00Z"));
    expect(state.over).toBe(false);
    expect(state.budget).toBeNull();
    expect(state.tokens).toBe(0);
  });

  it("counts prompt and completion tokens against the token ceiling", async () => {
    getUserBudget.mockResolvedValue({ monthlyTokens: 1000 });
    sumLlmUsageByPurpose.mockResolvedValue([
      { purpose: "reply", promptTokens: 600, completionTokens: 500, calls: 2, costMicros: 0 },
    ]);
    const over = await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-15T00:00:00Z"));
    expect(over.tokens).toBe(1100);
    expect(over.over).toBe(true);

    sumLlmUsageByPurpose.mockResolvedValue([
      { purpose: "reply", promptTokens: 100, completionTokens: 50, calls: 1, costMicros: 0 },
    ]);
    expect((await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-15T00:00:00Z"))).over)
      .toBe(false);
  });

  it("counts the cost against the cost ceiling, in micros", async () => {
    getUserBudget.mockResolvedValue({ monthlyCost: 2 });
    sumLlmUsageByPurpose.mockResolvedValue([
      { purpose: "distill", promptTokens: 10, completionTokens: 10, calls: 1, costMicros: 2_000_000 },
    ]);
    const state = await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-15T00:00:00Z"));
    expect(state.costMicros).toBe(2_000_000);
    expect(state.over).toBe(true);

    sumLlmUsageByPurpose.mockResolvedValue([
      { purpose: "distill", promptTokens: 10, completionTokens: 10, calls: 1, costMicros: 1_999_999 },
    ]);
    expect((await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-15T00:00:00Z"))).over)
      .toBe(false);
  });

  it("asks about the user's month, not the whole ledger", async () => {
    await budgetStateForUser(7, "Asia/Shanghai", new Date("2026-11-21T07:00:00.000Z"));
    const [, from] = sumLlmUsageByPurpose.mock.calls[0]!;
    expect((from as Date).toISOString()).toBe("2026-10-31T16:00:00.000Z");
  });

  it("does not throw when the database cannot answer", async () => {
    getUserBudget.mockRejectedValue(new Error("down"));
    sumLlmUsageByPurpose.mockRejectedValue(new Error("down"));
    await expect(budgetExceeded(7, "Asia/Shanghai")).resolves.toBe(false);
  });
});
