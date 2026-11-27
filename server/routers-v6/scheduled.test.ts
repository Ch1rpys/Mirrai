import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const createScheduledItem = vi.fn();
const listScheduledItems = vi.fn();
const getScheduledItem = vi.fn();
const cancelScheduledItem = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  createScheduledItem: (...args: unknown[]) => createScheduledItem(...args),
  listScheduledItems: (...args: unknown[]) => listScheduledItems(...args),
  getScheduledItem: (...args: unknown[]) => getScheduledItem(...args),
  cancelScheduledItem: (...args: unknown[]) => cancelScheduledItem(...args),
  createSafetyEvent: (...args: unknown[]) => createSafetyEvent(...args),
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
      name: `User ${userId}`,
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: 1,
    personaId: 1,
    kind: "capsule",
    body: "给以后的自己",
    dueAt: new Date(FUTURE),
    status: "scheduled",
    cancelReason: null,
    claimedAt: null,
    deliveredAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("scheduled items (C5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockImplementation(async (id: number, userId: number) =>
      id === 1 && userId === 1 ? { id: 1, userId: 1, name: "小满" } : null,
    );
    createScheduledItem.mockImplementation(async (data: any) =>
      item({ id: 11, ...data, dueAt: new Date(data.dueAt) }),
    );
    createSafetyEvent.mockResolvedValue(1);
  });

  it("creates a capsule without returning its body", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).scheduled.create({
      personaId: 1,
      kind: "capsule",
      body: "给以后的自己",
      dueAt: FUTURE,
    });
    expect(result.created).toBe(true);
    expect(result.item).toMatchObject({ id: 11, kind: "capsule", state: "pending", body: null });
    expect(createScheduledItem).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 1,
      kind: "capsule",
      body: "给以后的自己",
      status: "scheduled",
    }));
  });

  it("refuses a day that has already passed", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.create({
        personaId: 1,
        kind: "message",
        body: "到那天再说",
        dueAt: PAST,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createScheduledItem).not.toHaveBeenCalled();
  });

  it("stops a crisis line and shows the help instead", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).scheduled.create({
      personaId: 1,
      kind: "capsule",
      body: "我不想活了",
      dueAt: FUTURE,
    });
    expect(result).toMatchObject({ created: false, crisis: true });
    expect((result as any).help).toContain("12356");
    expect(createScheduledItem).not.toHaveBeenCalled();
    expect(createSafetyEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 1,
      type: "crisis",
    }));
  });

  it("lists pending items without a capsule's body", async () => {
    listScheduledItems.mockResolvedValue([
      item({ id: 1, kind: "capsule", body: "未到期" }),
      item({ id: 2, kind: "message", body: "到那天说" }),
      item({ id: 3, kind: "capsule", body: "到了", dueAt: new Date(PAST), status: "delivered" }),
      item({ id: 4, kind: "letter", body: "没送出去", dueAt: new Date(PAST), status: "cancelled", cancelReason: "asleep" }),
      item({ id: 5, kind: "letter", body: "早就到了", dueAt: new Date(PAST), status: "delivered" }),
    ]);
    const result = await appRouter.createCaller(ctxFor(1)).scheduled.list({ personaId: 1 });
    expect(result.items).toEqual([
      { id: 1, kind: "capsule", dueAt: FUTURE, state: "pending", reason: null, body: null },
      { id: 2, kind: "message", dueAt: FUTURE, state: "pending", reason: null, body: "到那天说" },
      { id: 3, kind: "capsule", dueAt: PAST, state: "ready", reason: null, body: "到了" },
      {
        id: 4,
        kind: "letter",
        dueAt: PAST,
        state: "cancelled",
        reason: "asleep",
        body: "没送出去",
      },
    ]);
  });

  it("opens a capsule only on its day", async () => {
    getScheduledItem.mockResolvedValue(item({ id: 1, kind: "capsule", body: "未到期" }));
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.open({ id: 1 }),
    ).resolves.toEqual({ body: null, dueAt: FUTURE });

    getScheduledItem.mockResolvedValue(
      item({ id: 1, kind: "capsule", body: "到了", dueAt: new Date(PAST), status: "delivered" }),
    );
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.open({ id: 1 }),
    ).resolves.toEqual({ body: "到了", dueAt: PAST });
  });

  it("does not open a message or a letter", async () => {
    getScheduledItem.mockResolvedValue(item({ kind: "message" }));
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.open({ id: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("cancels a scheduled item once, and refuses after that", async () => {
    getScheduledItem.mockResolvedValue(item());
    cancelScheduledItem.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.cancel({ id: 7 }),
    ).resolves.toEqual({ success: true });
    // The user called it off themselves; the mailbox must not say the
    // persona could not talk that day (C5.3).
    expect(cancelScheduledItem).toHaveBeenCalledWith(7, 1, "user");
    cancelScheduledItem.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(ctxFor(1)).scheduled.cancel({ id: 7 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not touch another user's persona or item", async () => {
    const caller = appRouter.createCaller(ctxFor(2));
    await expect(caller.scheduled.list({ personaId: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.scheduled.create({ personaId: 1, kind: "message", body: "hi", dueAt: FUTURE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    getScheduledItem.mockResolvedValue(null);
    await expect(caller.scheduled.open({ id: 7 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.scheduled.cancel({ id: 7 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createScheduledItem).not.toHaveBeenCalled();
    expect(cancelScheduledItem).not.toHaveBeenCalled();
  });
});
