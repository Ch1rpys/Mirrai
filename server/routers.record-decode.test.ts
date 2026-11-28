import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The route behind "read this line" (C3.4).
 *
 * It is a read: it goes through the persona ownership check, it bounds
 * the line the user can paste, and it hands the work to the decoder with
 * the caller's own id.
 *
 * The pasted line is user input too (WP12's rule): it is read for crisis
 * language before the decoder runs. A hit writes the safety event and
 * answers with the crisis flag instead of any of the three result blocks.
 */
const getPersonaById = vi.fn();
const decodeLine = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
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

/** What the decoder would say for an ordinary line: content in all three blocks. */
const decoded = {
  rules: [{
    id: "r1",
    trigger: ["就嗯？"],
    meaning: "她生气了",
    rendering: "更短、更冷",
    evidence: [],
  }],
  precedents: [{
    id: 12,
    content: "就嗯？",
    at: "2023-03-17T04:00:00.000Z",
    similarity: 1,
    before: [],
    after: [],
  }],
  after: { count: 6, gapMedianSec: 3600, states: [{ state: "distant", n: 6 }] },
  text: "就嗯？",
};

describe("record.decode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    decodeLine.mockResolvedValue(decoded);
    createSafetyEvent.mockResolvedValue(1);
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
    expect(createSafetyEvent).not.toHaveBeenCalled();
  });

  it("refuses an empty line and one over five hundred characters", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.record.decode({ personaId: 5, text: "  " })).rejects.toThrow();
    await expect(caller.record.decode({ personaId: 5, text: "x".repeat(501) })).rejects.toThrow();
    expect(decodeLine).not.toHaveBeenCalled();
  });

  it("reads the pasted line for crisis language before decoding it (C3.4)", async () => {
    /**
     * The decoder would return rules, precedents and "what followed"
     * for this line. The crisis path must run first: the answer is the
     * card flag only, the decoder is not called, and the event is
     * written like every other WP12 endpoint writes it.
     */
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.decode({ personaId: 5, text: "我不想活了" });
    expect(result).toEqual({ crisis: true });
    expect((result as Record<string, unknown>).rules).toBeUndefined();
    expect((result as Record<string, unknown>).precedents).toBeUndefined();
    expect((result as Record<string, unknown>).after).toBeUndefined();
    expect(decodeLine).not.toHaveBeenCalled();
    expect(createSafetyEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 5,
      type: "crisis",
      severity: "critical",
    }));
  });

  it("still decodes an ordinary line and says it is not a crisis", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.decode({ personaId: 5, text: "就嗯？" });
    expect(result).toMatchObject({ crisis: false, rules: decoded.rules });
    expect(decodeLine).toHaveBeenCalledWith({ personaId: 5, userId: 1, text: "就嗯？" });
    expect(createSafetyEvent).not.toHaveBeenCalled();
  });
});
