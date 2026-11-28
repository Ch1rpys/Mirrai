import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The counsellor summary's route (C4.6).
 *
 * It reads only the caller's own data, and it calls no model. The
 * generator never sees a message from the persona; the route passes the
 * conversation only so the user's own lines can supply optional themes.
 */
const getUserMoods = vi.fn();
const listCheckinAnswersSince = vi.fn();
const getSafetyEvents = vi.fn();
const getUserJournal = vi.fn();
const getPersonasByUserId = vi.fn();
const getRelationshipEvents = vi.fn();
const getMessagesByPersonaId = vi.fn();
const invoke = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserMoods: (...a: unknown[]) => getUserMoods(...a),
  listCheckinAnswersSince: (...a: unknown[]) => listCheckinAnswersSince(...a),
  getSafetyEvents: (...a: unknown[]) => getSafetyEvents(...a),
  getUserJournal: (...a: unknown[]) => getUserJournal(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
}));

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    llmService: {
      ...actual.llmService,
      invoke: (...a: unknown[]) => invoke(...a),
      invokeWithProvider: (...a: unknown[]) => invoke(...a),
    },
  };
});

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

describe("user.exportCounselorSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMoods.mockResolvedValue([{ date: "2026-03-01", mood: "warm" }]);
    listCheckinAnswersSince.mockResolvedValue([{ answer: "better" }]);
    getSafetyEvents.mockResolvedValue([]);
    getUserJournal.mockResolvedValue([]);
    getPersonasByUserId.mockResolvedValue([{ id: 5, name: "小满" }]);
    getRelationshipEvents.mockResolvedValue([]);
    getMessagesByPersonaId.mockResolvedValue([]);
  });

  it("reads only the caller's data and returns the page", async () => {
    const result = await appRouter
      .createCaller(ctxFor(2))
      .user.exportCounselorSummary({ range: "30d", includeThemes: false, includeJournal: false });
    expect(getUserMoods).toHaveBeenCalledWith(2, 30, "Asia/Shanghai");
    expect(listCheckinAnswersSince).toHaveBeenCalledWith(2, expect.any(Date));
    expect(getPersonasByUserId).toHaveBeenCalledWith(2);
    expect(getRelationshipEvents).toHaveBeenCalledWith(5, 2, 1000);
    expect(result.html).toContain("给咨询师的一页摘要");
  });

  it("calls no model", async () => {
    await appRouter
      .createCaller(ctxFor(2))
      .user.exportCounselorSummary({ range: "90d", includeThemes: true, includeJournal: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("prints relationship events on the user's own calendar (C4.6)", async () => {
    // The route has to hand the caller's zone to the page: an event at
    // 03:00 UTC on New Year's Day happened on New Year's Eve in New York.
    getRelationshipEvents.mockResolvedValue([
      { happenedAt: new Date("2026-01-01T03:00:00.000Z"), title: "跨年" },
    ]);

    const shanghai = await appRouter
      .createCaller(ctxFor(2))
      .user.exportCounselorSummary({ range: "all", includeThemes: false, includeJournal: false });
    expect(shanghai.html).toContain("2026-01-01 · 跨年");

    const newYork = await appRouter
      .createCaller(ctxFor(2, "America/New_York"))
      .user.exportCounselorSummary({ range: "all", includeThemes: false, includeJournal: false });
    expect(newYork.html).toContain("2025-12-31 · 跨年");
  });
});
