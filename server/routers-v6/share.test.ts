import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const createPersonaShare = vi.fn();
const acceptPersonaShare = vi.fn();
const getPersonaShareByTokenHash = vi.fn();
const getPersonaShareById = vi.fn();
const listPersonaShares = vi.fn();
const revokePersonaShare = vi.fn();
const leavePersonaShare = vi.fn();
const getActiveShareForMemberPersona = vi.fn();
const getUserById = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createPersonaShare: (...a: unknown[]) => createPersonaShare(...a),
  acceptPersonaShare: (...a: unknown[]) => acceptPersonaShare(...a),
  getPersonaShareByTokenHash: (...a: unknown[]) => getPersonaShareByTokenHash(...a),
  getPersonaShareById: (...a: unknown[]) => getPersonaShareById(...a),
  listPersonaShares: (...a: unknown[]) => listPersonaShares(...a),
  revokePersonaShare: (...a: unknown[]) => revokePersonaShare(...a),
  leavePersonaShare: (...a: unknown[]) => leavePersonaShare(...a),
  getActiveShareForMemberPersona: (...a: unknown[]) => getActiveShareForMemberPersona(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
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
      name: `User ${userId}`,
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const ownerPersona = { id: 5, userId: 1, name: "小满", sharedFromPersonaId: null } as any;

describe("family sharing (C7.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(ownerPersona);
    createPersonaShare.mockResolvedValue(11);
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
  });

  it("stores only the hash of a seven-day invitation", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).share.invite({ personaId: 5 });
    expect(result.link).toBe(`/share/${result.token}`);
    expect(createPersonaShare).toHaveBeenCalledTimes(1);
    const saved = createPersonaShare.mock.calls[0][0];
    expect(saved.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.tokenHash).not.toBe(result.token);
    expect(saved.ownerUserId).toBe(1);
    expect(saved.personaId).toBe(5);
    expect(saved.status).toBe("invited");
    const days = (saved.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("accepts with the hash of the token, in one transaction", async () => {
    acceptPersonaShare.mockResolvedValue({ personaId: 9, shareId: 11 });
    const result = await appRouter.createCaller(ctxFor(2)).share.accept({ token: "a".repeat(32) });
    expect(result.personaId).toBe(9);
    expect(acceptPersonaShare).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
      2,
    );
  });

  it("shows only the two names before accepting", async () => {
    getPersonaShareByTokenHash.mockResolvedValue({
      id: 11,
      personaId: 5,
      ownerUserId: 1,
      status: "invited",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const preview = await appRouter.createCaller(ctxFor(2)).share.preview({
      token: "a".repeat(32),
    });
    expect(preview).toEqual({ ownerName: "阿树", personaName: "小满" });
  });

  it("refuses an expired invitation", async () => {
    getPersonaShareByTokenHash.mockResolvedValue({
      id: 11,
      personaId: 5,
      ownerUserId: 1,
      status: "invited",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(
      appRouter.createCaller(ctxFor(2)).share.preview({ token: "a".repeat(32) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets the owner revoke, and the member leave", async () => {
    getPersonaShareById.mockResolvedValue({ id: 11, ownerUserId: 1, status: "active" });
    revokePersonaShare.mockResolvedValue(true);
    await appRouter.createCaller(ctxFor(1)).share.revoke({ id: 11 });
    expect(revokePersonaShare).toHaveBeenCalledWith(11, 1);

    getPersonaById.mockResolvedValue({
      id: 9,
      userId: 2,
      name: "小满",
      sharedFromPersonaId: 5,
    });
    getActiveShareForMemberPersona.mockResolvedValue({ id: 11, status: "active" });
    leavePersonaShare.mockResolvedValue(true);
    await appRouter.createCaller(ctxFor(2)).share.leave({ personaId: 9 });
    expect(leavePersonaShare).toHaveBeenCalledWith(9, 2);
  });

  it("does not let a member invite somebody else", async () => {
    getPersonaById.mockResolvedValue({
      id: 9,
      userId: 2,
      name: "小满",
      sharedFromPersonaId: 5,
    });
    await expect(
      appRouter.createCaller(ctxFor(2)).share.invite({ personaId: 9 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createPersonaShare).not.toHaveBeenCalled();
  });
});
