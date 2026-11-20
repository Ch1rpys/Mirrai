import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getRecordsByIds = vi.fn();
const getRecordsAround = vi.fn();
const findUnfinishedForPersona = vi.fn();
const completeUnfinishedLine = vi.fn();
const createMessage = vi.fn();
const updateMessageMetadata = vi.fn();
const createMemory = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getRecordsByIds: (...args: unknown[]) => getRecordsByIds(...args),
  getRecordsAround: (...args: unknown[]) => getRecordsAround(...args),
  createMessage: (...args: unknown[]) => createMessage(...args),
  updateMessageMetadata: (...args: unknown[]) => updateMessageMetadata(...args),
  createMemory: (...args: unknown[]) => createMemory(...args),
}));

vi.mock("../records/unsaid", () => ({
  findUnfinishedForPersona: (...args: unknown[]) => findUnfinishedForPersona(...args),
}));

vi.mock("../chat/unsaid", () => ({
  completeUnfinishedLine: (...args: unknown[]) => completeUnfinishedLine(...args),
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

const item = {
  kind: "trailing" as const,
  recordId: 3,
  text: "算了。",
  at: "2024-05-01T21:00:00.000Z",
  context: [
    { recordId: 1, role: "user", text: "周末去看电影吗", at: null },
    { recordId: 2, role: "assistant", text: "好啊 我看看时间", at: null },
  ],
};

describe("the unfinished words route (C6.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockImplementation(async (id: number, userId: number) =>
      id === 1 && userId === 1 ? { id: 1, userId: 1, name: "小满", personaData: {} } : null,
    );
    findUnfinishedForPersona.mockResolvedValue([item]);
    getRecordsByIds.mockResolvedValue([
      { id: 3, personaId: 1, userId: 1, role: "assistant", kind: "text", content: "算了。", timestamp: new Date() },
    ]);
    getRecordsAround.mockResolvedValue({
      target: { id: 3 },
      before: [{ content: "周末去看电影吗" }, { content: "好啊 我看看时间" }],
      after: [],
    });
    completeUnfinishedLine.mockResolvedValue("那就算了吧，下次吧");
  });

  it("lists the original lines and their context", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).unsaid.list({ personaId: 1 });
    expect(result.items).toEqual([item]);
    expect(findUnfinishedForPersona).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 1, userId: 1 }),
    );
  });

  it("reads the record again before asking for a continuation, and stores nothing", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).unsaid.complete({
      personaId: 1,
      recordId: 3,
    });
    expect(result).toEqual({ text: "那就算了吧，下次吧" });
    expect(getRecordsByIds).toHaveBeenCalledWith([3], 1);
    expect(completeUnfinishedLine).toHaveBeenCalledWith(
      expect.objectContaining({
        line: "算了。",
        context: ["周末去看电影吗", "好啊 我看看时间"],
      }),
    );
    expect(createMessage).not.toHaveBeenCalled();
    expect(updateMessageMetadata).not.toHaveBeenCalled();
    expect(createMemory).not.toHaveBeenCalled();
  });

  it("refuses a record that is not one of their text lines", async () => {
    getRecordsByIds.mockResolvedValue([
      { id: 3, personaId: 1, userId: 1, role: "user", kind: "text", content: "算了。", timestamp: new Date() },
    ]);
    await expect(
      appRouter.createCaller(ctxFor(1)).unsaid.complete({ personaId: 1, recordId: 3 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(completeUnfinishedLine).not.toHaveBeenCalled();
  });

  it("refuses somebody else's persona", async () => {
    await expect(
      appRouter.createCaller(ctxFor(2)).unsaid.list({ personaId: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
