import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Ticking a meeting note off (C3.7).
 *
 * The checklist is for 「等 TA 回来再说」 notes. A letter is not a task:
 * one that was delivered is answered, one that was kept is kept, and
 * neither has a done state.
 */
const getPersonaById = vi.fn();
const getLetterById = vi.fn();
const setLetterDone = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getLetterById: (...a: unknown[]) => getLetterById(...a),
  setLetterDone: (...a: unknown[]) => setLetterDone(...a),
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

describe("letter.setDone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getLetterById.mockResolvedValue({ id: 9, userId: 1, personaId: 5, kind: "todo", body: "有件事" });
    setLetterDone.mockResolvedValue(true);
  });

  it("ticks a note off and puts it back", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    expect(await caller.letter.setDone({ id: 9, done: true })).toEqual({ success: true });
    expect(setLetterDone).toHaveBeenCalledWith(9, 1, true);
    await caller.letter.setDone({ id: 9, done: false });
    expect(setLetterDone).toHaveBeenLastCalledWith(9, 1, false);
  });

  it("refuses a letter that is not a note", async () => {
    getLetterById.mockResolvedValue({ id: 9, userId: 1, personaId: 5, kind: "letter" });
    await expect(
      appRouter.createCaller(ctxFor(1)).letter.setDone({ id: 9, done: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setLetterDone).not.toHaveBeenCalled();
  });

  it("does not reach another user's note", async () => {
    getLetterById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).letter.setDone({ id: 9, done: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
