import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A reply that is still waiting, through the router.
 *
 * Somebody else's persona is not readable. Running it now is the
 * same job the scheduler would run, just without waiting.
 */

const getPersonaById = vi.fn();
const getPendingReplyJob = vi.fn();
const replyNow = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPendingReplyJob: (...a: unknown[]) => getPendingReplyJob(...a),
}));

vi.mock("./chat/reply-jobs", () => ({
  replyNow: (...a: unknown[]) => replyNow(...a),
  maybeDeferReply: vi.fn(),
  cancelPendingReplyJobs: vi.fn().mockResolvedValue(0),
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

describe("a pending reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小A" });
    getPendingReplyJob.mockResolvedValue(null);
    replyNow.mockResolvedValue(true);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);

    await expect(
      appRouter.createCaller(ctxFor(1)).chat.pendingReply({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getPendingReplyJob).not.toHaveBeenCalled();
  });

  it("returns the waiting job, including a busy title", async () => {
    getPendingReplyJob.mockResolvedValue({
      id: 11,
      dueAt: new Date("2024-06-01T12:20:00.000Z"),
      reason: "busy",
      payload: { title: "周三下午上课" },
    });

    const got = await appRouter.createCaller(ctxFor(1)).chat.pendingReply({ personaId: 5 });
    expect(getPendingReplyJob).toHaveBeenCalledWith(5, 1, "reply");
    expect(got).toEqual({
      jobId: 11,
      dueAt: "2024-06-01T12:20:00.000Z",
      reason: "busy",
      title: "周三下午上课",
    });
  });

  it("returns null when nothing is waiting", async () => {
    const got = await appRouter.createCaller(ctxFor(1)).chat.pendingReply({ personaId: 5 });
    expect(got).toBeNull();
  });

  it("runs the waiting job now", async () => {
    const got = await appRouter.createCaller(ctxFor(1)).chat.replyNow({ personaId: 5 });
    expect(replyNow).toHaveBeenCalledWith(5, 1);
    expect(got).toEqual({ ok: true });
  });
});
