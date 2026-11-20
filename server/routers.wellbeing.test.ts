import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The wellbeing route (C4.3).
 *
 * It is the server half of the trend: eight weeks, in the user's own
 * calendar, and the two four-week halves the page compares. The page
 * only draws what this returns.
 */
const getUserMoods = vi.fn();
const listCheckinAnswersSince = vi.fn();
const listUserMessageTimesSince = vi.fn();
const getDailyChatCounts = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserMoods: (...a: unknown[]) => getUserMoods(...a),
  listCheckinAnswersSince: (...a: unknown[]) => listCheckinAnswersSince(...a),
  listUserMessageTimesSince: (...a: unknown[]) => listUserMessageTimesSince(...a),
  getDailyChatCounts: (...a: unknown[]) => getDailyChatCounts(...a),
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
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

const now = new Date();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(now);

describe("analytics.wellbeing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMoods.mockResolvedValue([{ date: today, mood: "warm" }]);
    listCheckinAnswersSince.mockResolvedValue([{ answer: "better", createdAt: now }]);
    listUserMessageTimesSince.mockResolvedValue([{ at: now }]);
    getDailyChatCounts.mockResolvedValue([{ date: today, userCount: 1 }]);
  });

  it("returns eight weeks and the two four-week halves", async () => {
    const result = await appRouter.createCaller(ctxFor(2)).analytics.wellbeing.get();

    expect(result.weeks).toHaveLength(8);
    expect(result.recent).toEqual(expect.objectContaining({ moods: 1, visits: 1, messages: 1 }));
    expect(result.previous).toEqual(expect.objectContaining({ moods: 0, visits: 0, messages: 0 }));
    expect(result.recent.lateNight).toBeGreaterThanOrEqual(0);
    expect(result.recent.checkins).toEqual({ better: 1, same: 0, worse: 0 });
    expect(getUserMoods).toHaveBeenCalledWith(2, 63, "Asia/Shanghai");
    expect(getDailyChatCounts).toHaveBeenCalledWith(2, 63, "Asia/Shanghai");
  });
});
