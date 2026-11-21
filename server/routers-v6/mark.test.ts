import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { copy } from "@shared/copy";

/**
 * The conversation's marks (C8.10).
 *
 * The three things a long conversation needs: a star to find a message
 * again, a pin to keep a few in front, and a named topic to return to.
 * The rules are small and easy to break: only your own conversation,
 * never a fourth pin, and a topic always has a name.
 */
const getPersonaById = vi.fn();
const getMessageById = vi.fn();
const listMessageMarks = vi.fn();
const countMessageMarks = vi.fn();
const addMessageMark = vi.fn();
const removeMessageMark = vi.fn();
const getMessageMark = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  listMessageMarks: (...a: unknown[]) => listMessageMarks(...a),
  countMessageMarks: (...a: unknown[]) => countMessageMarks(...a),
  addMessageMark: (...a: unknown[]) => addMessageMark(...a),
  removeMessageMark: (...a: unknown[]) => removeMessageMark(...a),
  getMessageMark: (...a: unknown[]) => getMessageMark(...a),
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
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
      budget: null,
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("mark.add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getMessageById.mockResolvedValue({ id: 11, personaId: 5, userId: 1 });
    countMessageMarks.mockResolvedValue(0);
    addMessageMark.mockImplementation(async (data: any) => ({ id: 3, ...data }));
  });

  it("stars a message of the caller's own conversation", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).mark.add({
      personaId: 5,
      messageId: 11,
      kind: "star",
    });
    expect(result.success).toBe(true);
    expect(addMessageMark).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 5,
      messageId: 11,
      kind: "star",
      label: null,
    }));
  });

  it("refuses somebody else's conversation", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).mark.add({ personaId: 5, messageId: 11, kind: "star" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(addMessageMark).not.toHaveBeenCalled();
  });

  it("refuses a message that is not in this conversation", async () => {
    getMessageById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).mark.add({ personaId: 5, messageId: 99, kind: "pin" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(addMessageMark).not.toHaveBeenCalled();
  });

  it("refuses a fourth pin with a reason the user can act on", async () => {
    countMessageMarks.mockResolvedValue(3);
    await expect(
      appRouter.createCaller(ctxFor(1)).mark.add({ personaId: 5, messageId: 11, kind: "pin" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "errors.pinLimit"),
    });
    expect(addMessageMark).not.toHaveBeenCalled();
  });

  it("refuses a topic without a name", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).mark.add({ personaId: 5, messageId: 11, kind: "topic" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "errors.topicNeedsLabel"),
    });
    expect(addMessageMark).not.toHaveBeenCalled();
  });

  it("keeps the name of a topic", async () => {
    await appRouter.createCaller(ctxFor(1)).mark.add({
      personaId: 5,
      messageId: 11,
      kind: "topic",
      label: "那天晚上的事",
    });
    expect(addMessageMark).toHaveBeenCalledWith(expect.objectContaining({
      kind: "topic",
      label: "那天晚上的事",
    }));
  });
});

describe("mark.list and mark.remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    listMessageMarks.mockResolvedValue([
      { id: 1, messageId: 11, kind: "pin", label: null, content: "在的呀" },
    ]);
    removeMessageMark.mockResolvedValue(true);
    getMessageMark.mockResolvedValue({ id: 1, userId: 1, personaId: 5, messageId: 11, kind: "star" });
  });

  it("lists one conversation's marks with the message each points at", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).mark.list({ personaId: 5, kind: "pin" });
    expect(result.maxPins).toBe(3);
    expect(result.marks[0]?.content).toBe("在的呀");
    expect(listMessageMarks).toHaveBeenCalledWith(5, 1, "pin");
  });

  it("does not reach another user's conversation", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).mark.list({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes by id, only its owner's", async () => {
    expect(await appRouter.createCaller(ctxFor(1)).mark.remove({ id: 1 }))
      .toEqual({ success: true });
    expect(removeMessageMark).toHaveBeenCalledWith(1, 1);

    removeMessageMark.mockResolvedValue(false);
    await expect(appRouter.createCaller(ctxFor(1)).mark.remove({ id: 2 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to read somebody else's mark", async () => {
    getMessageMark.mockResolvedValue(null);
    await expect(appRouter.createCaller(ctxFor(2)).mark.get({ id: 1 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
