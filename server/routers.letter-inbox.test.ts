import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The mailbox (C8.2).
 *
 * The five groups, whose rows get in which group, that the user only
 * ever sees their own, that a sealed persona's things are left out, and
 * that marking a reply read is what takes the unread number down.
 */
const getPersonasByUserId = vi.fn();
const listInboxLetters = vi.fn();
const listInboxScheduled = vi.fn();
const countUnreadLetters = vi.fn();
const countUnopenedCapsules = vi.fn();
const countUnreadAutoRepliesByPersona = vi.fn();
const markLetterRead = vi.fn();
const markPersonaRead = vi.fn();
const getPersonaById = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  listInboxLetters: (...a: unknown[]) => listInboxLetters(...a),
  listInboxScheduled: (...a: unknown[]) => listInboxScheduled(...a),
  countUnreadLetters: (...a: unknown[]) => countUnreadLetters(...a),
  countUnopenedCapsules: (...a: unknown[]) => countUnopenedCapsules(...a),
  countUnreadAutoRepliesByPersona: (...a: unknown[]) => countUnreadAutoRepliesByPersona(...a),
  markLetterRead: (...a: unknown[]) => markLetterRead(...a),
  markPersonaRead: (...a: unknown[]) => markPersonaRead(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
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

const letter = (overrides: Record<string, unknown>) => ({
  id: 1,
  userId: 1,
  personaId: 5,
  body: "写下来的话",
  kind: "letter",
  status: "answered",
  mood: null,
  replyAt: null,
  repliedAt: new Date("2026-03-02T10:00:00Z"),
  replyText: "回信",
  readAt: null,
  createdAt: new Date("2026-03-01T10:00:00Z"),
  personaName: "小满",
  ...overrides,
});

const scheduled = (overrides: Record<string, unknown>) => ({
  id: 1,
  userId: 1,
  personaId: 5,
  kind: "capsule",
  body: "给以后的你",
  dueAt: new Date("2020-01-01T00:00:00Z"),
  status: "delivered",
  cancelReason: null,
  openedAt: null,
  createdAt: new Date("2019-01-01T00:00:00Z"),
  personaName: "小满",
  ...overrides,
});

describe("letter.inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonasByUserId.mockResolvedValue([
      { id: 5, userId: 1, name: "小满", settings: {} },
      { id: 6, userId: 1, name: "封着的", settings: { seal: { until: "2999-01-01", earlyOpen: "never" } } },
    ]);
    listInboxLetters.mockResolvedValue([]);
    listInboxScheduled.mockResolvedValue([]);
    countUnreadLetters.mockResolvedValue(0);
    countUnopenedCapsules.mockResolvedValue(0);
    countUnreadAutoRepliesByPersona.mockResolvedValue({});
  });

  it("puts each thing in its group and leaves the sealed persona out", async () => {
    listInboxLetters.mockResolvedValue([
      // Deliberately out of order: the read one arrived later, but the
      // unread one must come first.
      letter({ id: 1, status: "answered", readAt: null, repliedAt: new Date("2026-03-05T00:00:00Z") }),
      letter({ id: 2, status: "answered", readAt: new Date("2026-03-06T00:00:00Z"), repliedAt: new Date("2026-03-01T00:00:00Z") }),
      letter({ id: 3, status: "waiting", replyAt: new Date("2026-03-05T00:00:00Z") }),
      letter({ id: 4, status: "private" }),
      letter({ id: 9, status: "answered", personaId: 6, personaName: "封着的" }),
    ]);
    listInboxScheduled.mockResolvedValue([
      scheduled({ id: 11, kind: "capsule", status: "delivered", dueAt: new Date("2020-01-01T00:00:00Z") }),
      scheduled({ id: 12, kind: "capsule", status: "scheduled", dueAt: new Date("2999-01-01T00:00:00Z") }),
      scheduled({ id: 13, kind: "capsule", status: "cancelled" }),
      scheduled({ id: 14, kind: "message", status: "scheduled", dueAt: new Date("2099-01-01T00:00:00Z") }),
    ]);

    const inbox = await appRouter.createCaller(ctxFor(1)).letter.inbox();

    // The secured persona is not even asked about.
    expect(listInboxLetters).toHaveBeenCalledWith(1, [5]);
    expect(listInboxScheduled).toHaveBeenCalledWith(1, [5]);

    // Received: unread first, then by the time the reply came.
    expect(inbox.received.map((row: any) => row.id)).toEqual([1, 2]);
    expect(inbox.waiting.map((row: any) => row.id)).toEqual([3]);
    expect(inbox.kept.map((row: any) => row.id)).toEqual([4]);
    // Due capsules only, newest day first; a cancelled one is gone and
    // one that has not come due is in the other group.
    expect(inbox.capsules.map((row: any) => row.id)).toEqual([11]);
    expect(inbox.upcoming.map((row: any) => row.id)).toEqual([14, 12]);
  });

  it("seals on the user's clock, not the persona's", async () => {
    vi.useFakeTimers();
    try {
      // 2026-03-19T20:00Z is 2026-03-19 13:00 in Los Angeles: the seal
      // until 2026-03-20 still holds. The persona's own clock
      // (Asia/Shanghai) has already passed midnight and would call it
      // open — the mailbox must agree with `sealedGuard`, which uses
      // the user's timezone.
      vi.setSystemTime(new Date("2026-03-19T20:00:00Z"));
      getPersonasByUserId.mockResolvedValue([
        {
          id: 5,
          userId: 1,
          name: "小满",
          timezone: "Asia/Shanghai",
          settings: { seal: { until: "2026-03-20", earlyOpen: "never" } },
        },
        { id: 6, userId: 1, name: "小林", settings: {} },
      ]);
      listInboxLetters.mockResolvedValue([
        letter({ id: 21, personaId: 5 }),
        letter({ id: 22, personaId: 6, personaName: "小林" }),
      ]);
      const inbox = await appRouter
        .createCaller(ctxFor(1, "America/Los_Angeles"))
        .letter.inbox();
      expect(inbox.received.map((row: any) => row.personaId)).toEqual([6]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is empty when the user has no personas", async () => {
    getPersonasByUserId.mockResolvedValue([]);
    const inbox = await appRouter.createCaller(ctxFor(1)).letter.inbox();
    expect(inbox).toEqual({ received: [], waiting: [], kept: [], capsules: [], upcoming: [] });
    expect(listInboxLetters).toHaveBeenCalledWith(1, []);
  });

  it("marks a reply read and refuses somebody else's", async () => {
    markLetterRead.mockResolvedValue(true);
    const caller = appRouter.createCaller(ctxFor(1));
    expect(await caller.letter.markRead({ id: 3 })).toEqual({ success: true });
    expect(markLetterRead).toHaveBeenCalledWith(3, 1);

    markLetterRead.mockResolvedValue(false);
    await expect(caller.letter.markRead({ id: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("letter.unreadCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonasByUserId.mockResolvedValue([
      { id: 5, userId: 1, name: "小满", settings: {}, lastReadAt: null },
      { id: 6, userId: 1, name: "封着的", settings: { seal: { until: "2999-01-01", earlyOpen: "never" } } },
    ]);
    countUnreadLetters.mockResolvedValue(2);
    countUnopenedCapsules.mockResolvedValue(1);
    countUnreadAutoRepliesByPersona.mockResolvedValue({ 5: 3 });
  });

  it("adds the three things that are waiting", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).letter.unreadCount();
    expect(result).toMatchObject({ total: 6, letters: 2, capsules: 1, replies: 3 });
    // The sealed persona is left out of every count.
    expect(countUnreadAutoRepliesByPersona).toHaveBeenCalledWith(1, [
      { id: 5, lastReadAt: null },
    ]);
  });

  it("goes down by one after a reply is marked read", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    expect((await caller.letter.unreadCount()).letters).toBe(2);
    markLetterRead.mockImplementation(async () => true);
    countUnreadLetters.mockImplementation(async () => 1);
    await caller.letter.markRead({ id: 3 });
    expect((await caller.letter.unreadCount()).letters).toBe(1);
  });

  it("is zero when nothing is waiting", async () => {
    countUnreadLetters.mockResolvedValue(0);
    countUnopenedCapsules.mockResolvedValue(0);
    countUnreadAutoRepliesByPersona.mockResolvedValue({});
    expect((await appRouter.createCaller(ctxFor(1)).letter.unreadCount()).total).toBe(0);
  });
});

describe("chat.markRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    markPersonaRead.mockResolvedValue(true);
  });

  it("records that the conversation is in front of the user", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    expect(await caller.chat.markRead({ personaId: 5 })).toEqual({ success: true });
    expect(markPersonaRead).toHaveBeenCalledWith(5, 1);
  });

  it("refuses another user's persona", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).chat.markRead({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(markPersonaRead).not.toHaveBeenCalled();
  });
});
