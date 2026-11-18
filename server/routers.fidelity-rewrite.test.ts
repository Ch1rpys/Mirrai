import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The unlike mark's optional rewrite, and who is allowed to fill it in.
 */

const getPersonaById = vi.fn();
const getMessageById = vi.fn();
const createFidelityFeedback = vi.fn();
const setFidelityFeedbackRewrite = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  createFidelityFeedback: (...a: unknown[]) => createFidelityFeedback(...a),
  setFidelityFeedbackRewrite: (...a: unknown[]) => setFidelityFeedbackRewrite(...a),
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
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

describe("a rewrite on an unlike mark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小A" });
    getMessageById.mockResolvedValue({ id: 9, content: "你好吗", userId: 1, personaId: 5 });
    createFidelityFeedback.mockResolvedValue({ id: 11 });
    setFidelityFeedbackRewrite.mockImplementation(async (id: number, userId: number, rewrite: string) => {
      if (userId !== 1) return null;
      return { id, userId, rewrite };
    });
  });

  it("refuses a rewrite longer than 200 characters", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const tooLong = "x".repeat(201);
    await expect(
      caller.fidelity.mark({ personaId: 5, messageId: 9, reason: "word", rewrite: tooLong }),
    ).rejects.toThrow();
    await expect(
      caller.fidelity.setRewrite({ feedbackId: 11, rewrite: tooLong }),
    ).rejects.toThrow();
    expect(createFidelityFeedback).not.toHaveBeenCalled();
    expect(setFidelityFeedbackRewrite).not.toHaveBeenCalled();
  });

  it("will not rewrite someone else's mark", async () => {
    const caller = appRouter.createCaller(ctxFor(2));
    await expect(
      caller.fidelity.setRewrite({ feedbackId: 11, rewrite: "那才像" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(setFidelityFeedbackRewrite).toHaveBeenCalledWith(11, 2, "那才像");
  });

  it("stores a rewrite on the mark the caller owns", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const marked = await caller.fidelity.mark({
      personaId: 5,
      messageId: 9,
      reason: "word",
      rewrite: "那才像",
    });
    expect(marked).toEqual({ id: 11 });
    expect(createFidelityFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, personaId: 5, messageId: 9, reason: "word", rewrite: "那才像" }),
    );
    const filled = await caller.fidelity.setRewrite({ feedbackId: 11, rewrite: "嗯" });
    expect(filled).toEqual({ id: 11 });
  });
});
