import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getPersonaStyleProfile = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
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

describe("persona.exportManual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      relationshipDesc: "前任",
      togetherFrom: "2021-05",
      togetherTo: null,
      personaData: { personality: "温柔", speakingStyle: "轻轻说" },
    });
    getPersonaStyleProfile.mockResolvedValue({ fingerprint: null, conflict: null });
  });

  it("returns a printable page with the persona's name", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .persona.exportManual({ personaId: 5 });
    expect(result.html).toContain("小满 的说明书");
    expect(result.html).toContain("<!DOCTYPE html>");
  });

  it("does not export somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.exportManual({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
