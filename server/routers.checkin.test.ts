import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The after-chat question, as a route (C4.2).
 *
 * The server is what decides when to ask; the page only draws what it is
 * given. So a page that tries to answer a session that was never due gets
 * a refusal, not a row.
 */
const getPersonaById = vi.fn();
const createSessionCheckin = vi.fn();
const createSessionCheckinPrompt = vi.fn();
const pendingCheckin = vi.fn();
const worseSuggestion = vi.fn();
const recordWorseSuggestion = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createSessionCheckin: (...a: unknown[]) => createSessionCheckin(...a),
  createSessionCheckinPrompt: (...a: unknown[]) => createSessionCheckinPrompt(...a),
}));

vi.mock("./safety/checkins", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pendingCheckin: (...a: unknown[]) => pendingCheckin(...a),
  worseSuggestion: (...a: unknown[]) => worseSuggestion(...a),
  recordWorseSuggestion: (...a: unknown[]) => recordWorseSuggestion(...a),
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

const sessionStart = new Date("2026-03-10T10:00:00.000Z");

describe("checkin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    pendingCheckin.mockResolvedValue({ sessionStartAt: sessionStart });
    worseSuggestion.mockResolvedValue(false);
    createSessionCheckin.mockResolvedValue(1);
    createSessionCheckinPrompt.mockResolvedValue(3);
    recordWorseSuggestion.mockResolvedValue(true);
  });

  it("asks about the session the server just chose", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).checkin.pending({ personaId: 5 });
    expect(result).toEqual({ pending: { sessionStartAt: sessionStart.toISOString() }, worse: false });
  });

  it("writes an answer to the session it was asked about", async () => {
    await appRouter.createCaller(ctxFor(1)).checkin.answer({
      personaId: 5,
      sessionStartAt: sessionStart.toISOString(),
      answer: "worse",
    });
    expect(createSessionCheckin).toHaveBeenCalledWith({
      userId: 1,
      personaId: 5,
      sessionStartAt: sessionStart,
      answer: "worse",
    });
  });

  it("refuses an answer about a session that is no longer due", async () => {
    pendingCheckin.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).checkin.answer({
        personaId: 5,
        sessionStartAt: sessionStart.toISOString(),
        answer: "better",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createSessionCheckin).not.toHaveBeenCalled();
  });

  it("records that the question was shown", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).checkin.markPrompted({
      personaId: 5,
      sessionStartAt: sessionStart.toISOString(),
    });
    expect(createSessionCheckinPrompt).toHaveBeenCalledWith({
      userId: 1,
      personaId: 5,
      sessionStartAt: sessionStart,
      promptedAt: expect.any(Date),
    });
    expect(result).toEqual({ success: true });
  });

  it("refuses to record a question for a session that is not due", async () => {
    pendingCheckin.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).checkin.markPrompted({
        personaId: 5,
        sessionStartAt: sessionStart.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createSessionCheckinPrompt).not.toHaveBeenCalled();
  });

  it("records that the pause card was shown", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).checkin.acknowledgeWorse({ personaId: 5 });
    expect(recordWorseSuggestion).toHaveBeenCalledWith({ userId: 1, personaId: 5 });
    expect(result).toEqual({ recorded: true });
  });
});
