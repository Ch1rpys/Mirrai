import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "./_core/context";

/**
 * The three dates, through the router.
 *
 * Each caller only sees their own first letter, first sentence taken
 * back, and first goodbye. Somebody else's dates are not mixed in.
 */

const store: Record<number, {
  firstLetterAt: Date | null;
  firstOutboundSentAt: Date | null;
  firstFarewellAt: Date | null;
}> = {
  1: {
    firstLetterAt: new Date("2024-01-15T00:00:00.000Z"),
    firstOutboundSentAt: null,
    firstFarewellAt: null,
  },
  2: {
    firstLetterAt: new Date("2025-05-01T00:00:00.000Z"),
    firstOutboundSentAt: new Date("2025-06-01T00:00:00.000Z"),
    firstFarewellAt: null,
  },
};

const empty = {
  firstLetterAt: null,
  firstOutboundSentAt: null,
  firstFarewellAt: null,
};

const getUserMilestones = vi.fn(async (userId: number) => store[userId] ?? empty);

vi.mock("./db", () => ({
  getUserMilestones: (...a: unknown[]) => getUserMilestones(...a as [number]),
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
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as unknown as TrpcContext;
}

const SOURCE = readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");

describe("the user's own milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only counts the current user's dates", async () => {
    const own = await appRouter.createCaller(ctxFor(1)).user.milestones();
    const other = await appRouter.createCaller(ctxFor(2)).user.milestones();

    expect(own.firstLetterAt).toEqual(store[1].firstLetterAt);
    expect(own.firstOutboundSentAt).toBeNull();
    expect(other.firstLetterAt).toEqual(store[2].firstLetterAt);
    expect(other.firstOutboundSentAt).toEqual(store[2].firstOutboundSentAt);
    expect(getUserMilestones).toHaveBeenCalledWith(1);
    expect(getUserMilestones).toHaveBeenCalledWith(2);
    expect(getUserMilestones).not.toHaveBeenCalledWith(3);
  });

  it("asks the helper for the caller, not a persona", () => {
    expect(SOURCE).toMatch(/milestones:\s*protectedProcedure\.query\(async\s*\(\{\s*ctx\s*\}\)\s*=>\s*getUserMilestones\(ctx\.user\.id\)\)/);
  });
});
