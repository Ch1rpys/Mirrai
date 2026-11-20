import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The way out, from inside the conversation (C3.3).
 *
 * The exit list is the user's own sentences. So the two refusals matter
 * as much as the two writes: a persona's message must not get onto the
 * list, and another user's message must not be readable through this
 * door. The line itself is copied character for character — the app
 * never rewrites what the user said.
 */
const getPersonaById = vi.fn();
const getMessageById = vi.fn();
const getOutboundLetters = vi.fn();
const createOutboundLetter = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  getOutboundLetters: (...a: unknown[]) => getOutboundLetters(...a),
  createOutboundLetter: (...a: unknown[]) => createOutboundLetter(...a),
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

const persona = { id: 5, userId: 1, name: "小满" };
const userMessage = { id: 42, userId: 1, personaId: 5, role: "user", content: "我害怕你离开我" };

describe("outbound.addFromMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    getMessageById.mockResolvedValue(userMessage);
    getOutboundLetters.mockResolvedValue([]);
    createOutboundLetter.mockResolvedValue(11);
  });

  it("copies the message's words exactly", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.addFromMessage({ personaId: 5, messageId: 42 });
    expect(createOutboundLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        personaId: 5,
        text: "我害怕你离开我",
        sourceMessageId: 42,
      }),
    );
    expect(result).toEqual({ id: 11, text: "我害怕你离开我", existed: false });
  });

  it("refuses a persona's message", async () => {
    getMessageById.mockResolvedValue({ ...userMessage, role: "assistant", content: "我在。" });
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.addFromMessage({ personaId: 5, messageId: 42 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createOutboundLetter).not.toHaveBeenCalled();
  });

  it("does not reach another user's message", async () => {
    // The helper scopes the read to the caller, so somebody else's
    // message is not found — and a message that is not there is not
    // copied.
    getMessageById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.addFromMessage({ personaId: 5, messageId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createOutboundLetter).not.toHaveBeenCalled();
  });

  it("returns the existing row instead of a second copy", async () => {
    createOutboundLetter.mockResolvedValue(undefined);
    getOutboundLetters.mockResolvedValue([
      { id: 7, sourceMessageId: 42, text: "我害怕你离开我", status: "ready" },
    ]);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.addFromMessage({ personaId: 5, messageId: 42 });
    expect(result).toEqual({ id: 7, text: "我害怕你离开我", existed: true });
  });

  it("refuses a persona the caller does not own", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).outbound.addFromMessage({ personaId: 5, messageId: 42 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("outbound.addOwn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    createOutboundLetter.mockResolvedValue(12);
  });

  it("writes a sentence with no message behind it", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.addOwn({ personaId: 5, text: "那天我应该留下来的" });
    expect(createOutboundLetter).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 5, text: "那天我应该留下来的", status: "ready" }),
    );
    expect(result).toEqual({ success: true });
  });

  it("refuses an empty sentence", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.addOwn({ personaId: 5, text: "   " }),
    ).rejects.toThrow();
    expect(createOutboundLetter).not.toHaveBeenCalled();
  });
});
