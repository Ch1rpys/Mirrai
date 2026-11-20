import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const writeLetter = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  createSafetyEvent: (...args: unknown[]) => createSafetyEvent(...args),
  listPushSubscriptions: async () => [],
}));

vi.mock("./chat/letters", () => ({
  writeLetter: (...args: unknown[]) => writeLetter(...args),
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

describe("letters while the chat is closed (C6.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: "小满",
      settings: { taper: { stage: 3 } },
    });
    writeLetter.mockResolvedValue({
      letter: { id: 9, kind: "letter", status: "waiting" },
      asleep: false,
    });
  });

  it("still accepts a letter on the letters-only step", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).letter.write({
      personaId: 1,
      body: "现在只能写信了。",
      deliver: true,
      kind: "letter",
      locale: "zh",
    });
    expect(writeLetter).toHaveBeenCalledWith(expect.objectContaining({
      body: "现在只能写信了。",
      deliver: true,
    }));
    expect(result.letter.status).toBe("waiting");
  });
});
