import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const getRecordsByIds = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getPersonaSettings: (...args: unknown[]) => getPersonaSettings(...args),
  setPersonaSettings: (...args: unknown[]) => setPersonaSettings(...args),
  getRecordsByIds: (...args: unknown[]) => getRecordsByIds(...args),
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
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    userId: 1,
    personaId: 1,
    role: "assistant",
    kind: "text",
    content: "晚安呀",
    timestamp: new Date("2024-05-01T21:00:00Z"),
    createdAt: new Date("2024-05-01T21:00:00Z"),
    ...overrides,
  };
}

describe("keeping three lines (C6.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 1, userId: 1, name: "小满" });
    getPersonaSettings.mockResolvedValue({});
    setPersonaSettings.mockResolvedValue(true);
    getRecordsByIds.mockImplementation(async (ids: number[]) => [
      record({ id: 3 }),
      record({ id: 2, content: "喜欢你呀", timestamp: new Date("2024-04-01T21:00:00Z") }),
      record({ id: 4, role: "user", content: "我说的" }),
      record({ id: 5, kind: "sticker", content: "[sticker:狗狗探头]" }),
      record({ id: 6, personaId: 2, content: "别人的分身" }),
    ].filter((row) => ids.includes(row.id)));
  });

  it("refuses a line the user said, a sticker, and another persona's line", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    for (const recordId of [4, 5, 6]) {
      await expect(
        caller.persona.setKeptQuotes({ personaId: 1, recordIds: [recordId] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(setPersonaSettings).not.toHaveBeenCalled();
  });

  it("refuses a fourth line", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.setKeptQuotes({
        personaId: 1,
        recordIds: [1, 2, 3, 4],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("takes the words and the date from the record, in the order chosen", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).persona.setKeptQuotes({
      personaId: 1,
      recordIds: [3, 2],
    });
    expect(result.quotes).toEqual([
      { recordId: 3, text: "晚安呀", at: "2024-05-01T21:00:00.000Z" },
      { recordId: 2, text: "喜欢你呀", at: "2024-04-01T21:00:00.000Z" },
    ]);
    const written = setPersonaSettings.mock.calls[0][2];
    expect(written.keptQuotes).toEqual(result.quotes);
  });

  it("clears the three when none are chosen", async () => {
    await appRouter.createCaller(ctxFor(1)).persona.setKeptQuotes({
      personaId: 1,
      recordIds: [],
    });
    expect(setPersonaSettings.mock.calls[0][2].keptQuotes).toEqual([]);
  });
});
