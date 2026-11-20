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
const getOutboundLetterById = vi.fn();
const setOutboundLetterOutcome = vi.fn();
const createRelationshipEvent = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  getOutboundLetters: (...a: unknown[]) => getOutboundLetters(...a),
  createOutboundLetter: (...a: unknown[]) => createOutboundLetter(...a),
  getOutboundLetterById: (...a: unknown[]) => getOutboundLetterById(...a),
  setOutboundLetterOutcome: (...a: unknown[]) => setOutboundLetterOutcome(...a),
  createRelationshipEvent: (...a: unknown[]) => createRelationshipEvent(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
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

describe("outbound.list's one-time hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
  });

  it("offers the last page once, after a letter has been said", async () => {
    getOutboundLetters.mockResolvedValue([
      { id: 7, status: "sent", text: "我说了" },
      { id: 8, status: "sent", text: "还有一句" },
    ]);
    getPersonaSettings.mockResolvedValue(null);
    const first = await appRouter
      .createCaller(ctxFor(1))
      .outbound.list({ personaId: 5 });
    expect(first.saidItHint).toBe(true);

    getPersonaSettings.mockResolvedValue({ saidItHintShown: true });
    const second = await appRouter
      .createCaller(ctxFor(1))
      .outbound.list({ personaId: 5 });
    expect(second.saidItHint).toBe(false);
  });

  it("does not offer it before anything has been said", async () => {
    getOutboundLetters.mockResolvedValue([{ id: 7, status: "ready", text: "还没说" }]);
    getPersonaSettings.mockResolvedValue(null);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.list({ personaId: 5 });
    expect(result.saidItHint).toBe(false);
  });

  it("records that the hint was made", async () => {
    getPersonaSettings.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.dismissSaidItHint({ personaId: 5 });
    expect(setPersonaSettings).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ saidItHintShown: true }),
    );
    expect(result).toEqual({ success: true });
  });
});

describe("outbound.saveOutcome", () => {
  const sent = { id: 7, personaId: 5, status: "sent", text: "我说了" };

  beforeEach(() => {
    vi.clearAllMocks();
    getOutboundLetterById.mockResolvedValue(sent);
    setOutboundLetterOutcome.mockResolvedValue(true);
    createRelationshipEvent.mockResolvedValue({ id: 3 });
  });

  it("keeps the user's words exactly and records one relationship event", async () => {
    const note = "她沉默了一会儿，说「我知道了」。";
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.saveOutcome({ id: 7, note });
    expect(setOutboundLetterOutcome).toHaveBeenCalledWith(7, 1, note, expect.any(Date));
    expect(createRelationshipEvent).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 5, kind: "said_it", detail: note }),
    );
    expect(result).toEqual({ saved: true, event: { id: 3 } });
  });

  it("writes nothing when the user leaves it blank", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.saveOutcome({ id: 7, note: "   " });
    expect(result).toEqual({ saved: false });
    expect(setOutboundLetterOutcome).not.toHaveBeenCalled();
    expect(createRelationshipEvent).not.toHaveBeenCalled();
  });

  it("refuses a letter that has not been said yet", async () => {
    getOutboundLetterById.mockResolvedValue({ ...sent, status: "ready" });
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.saveOutcome({ id: 7, note: "说了" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not reach another user's letter", async () => {
    getOutboundLetterById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.saveOutcome({ id: 7, note: "说了" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts said_it as a relationship event kind", async () => {
    createRelationshipEvent.mockResolvedValue({ id: 9 });
    await appRouter
      .createCaller(ctxFor(1))
      .relationship.add({ personaId: 5, kind: "said_it", title: "说出口了" });
    expect(createRelationshipEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "said_it" }),
    );
  });
});
