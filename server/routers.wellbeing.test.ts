import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

function ctxFor(userId: number, timezone = "Asia/Shanghai"): TrpcContext {
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
      timezone,
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("opens the oldest week on the user's own midnight in UTC+12 and east (C4.3)", async () => {
    // 2026-01-14 12:00 UTC is already Thursday 15 January in Kiritimati
    // and Apia, so this week's Monday is 12 January and the eight-week
    // window opens on Monday 24 November 2025. That instant is NOT a
    // safe 12:00 UTC on the day key: 12:00 UTC is the next local day at
    // UTC+13/+14, and asking for its midnight cut the oldest Monday off.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-14T12:00:00.000Z"));
      const cases = [
        {
          timezone: "Pacific/Kiritimati", // UTC+14
          firstWeekStart: "2025-11-23T10:00:00.000Z",
          mondayMorning: "2025-11-23T16:00:00.000Z", // Monday 06:00 local
        },
        {
          timezone: "Pacific/Apia", // UTC+13
          firstWeekStart: "2025-11-23T11:00:00.000Z",
          mondayMorning: "2025-11-23T17:00:00.000Z", // Monday 06:00 local
        },
        {
          // UTC+12: the old 12:00 UTC probe was already the next local day.
          timezone: "Pacific/Tarawa",
          firstWeekStart: "2025-11-23T12:00:00.000Z",
          mondayMorning: "2025-11-23T18:00:00.000Z", // Monday 06:00 local
        },
      ];
      for (const testCase of cases) {
        vi.clearAllMocks();
        const monday = new Date(testCase.mondayMorning);
        getUserMoods.mockResolvedValue([{ date: "2025-11-24", mood: "warm" }]);
        getDailyChatCounts.mockResolvedValue([]);
        // The real queries take the window's lower bound and never look
        // before it, so the stub does the same.
        listCheckinAnswersSince.mockImplementation((_userId: number, since: Date) =>
          [{ answer: "better", createdAt: monday }].filter((row) => row.createdAt >= since),
        );
        listUserMessageTimesSince.mockImplementation((_userId: number, since: Date) =>
          [{ at: monday }].filter((row) => row.at >= since),
        );

        const result = await appRouter
          .createCaller(ctxFor(2, testCase.timezone))
          .analytics.wellbeing.get();

        // The oldest week is the Monday itself and is fully inside the
        // window: the check-in and the message on that Monday are
        // counted, not dropped.
        expect(result.weeks[0].start, testCase.timezone).toBe("2025-11-24");
        expect(listCheckinAnswersSince, testCase.timezone).toHaveBeenLastCalledWith(
          2,
          new Date(testCase.firstWeekStart),
        );
        expect(listUserMessageTimesSince, testCase.timezone).toHaveBeenLastCalledWith(
          2,
          new Date(testCase.firstWeekStart),
        );
        expect(result.weeks[0].checkins.better, testCase.timezone).toBe(1);
        expect(result.weeks[0].messages, testCase.timezone).toBe(1);
        expect(result.weeks[0].moods, testCase.timezone).toBe(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
