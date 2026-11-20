import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The route behind "read this line" (C3.4).
 *
 * It is a read: it goes through the persona ownership check, it bounds
 * the line the user can paste, and it hands the work to the decoder with
 * the caller's own id.
 */
const getPersonaById = vi.fn();
const decodeLine = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./records/decode", () => ({
  decodeLine: (...a: unknown[]) => decodeLine(...a),
  median: vi.fn(),
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

describe("record.decode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    decodeLine.mockResolvedValue({ rules: [], precedents: [], after: { count: 0, gapMedianSec: null, states: [] }, text: "就嗯？" });
  });

  it("passes the caller's own id and the line to the decoder", async () => {
    await appRouter.createCaller(ctxFor(1)).record.decode({ personaId: 5, text: "就嗯？" });
    expect(decodeLine).toHaveBeenCalledWith({ personaId: 5, userId: 1, text: "就嗯？" });
  });

  it("refuses a persona the caller does not own", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(2)).record.decode({ personaId: 5, text: "就嗯？" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(decodeLine).not.toHaveBeenCalled();
  });

  it("refuses an empty line and one over five hundred characters", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.record.decode({ personaId: 5, text: "  " })).rejects.toThrow();
    await expect(caller.record.decode({ personaId: 5, text: "x".repeat(501) })).rejects.toThrow();
    expect(decodeLine).not.toHaveBeenCalled();
  });
});
