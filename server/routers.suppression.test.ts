import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The subtraction rules editor (B4.7).
 *
 * A `multi_point` rule has no phrase to subtract — the line says "only
 * answer one of the messages" and it is a shape, not a string. The save
 * schema demanded at least one character for every kind, so the rule
 * the miner had just produced could not be confirmed in the editor.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
}));

vi.mock("./_core/lock", () => ({
  withPersonaDataLock: async (_id: number, fn: () => Promise<unknown>) => fn(),
}));

import { appRouter } from "./routers";

function ctxFor(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
      tokenVersion: 0,
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("suppression.save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    updatePersona.mockResolvedValue(undefined);
  });

  it("accepts a multi-point rule with no phrase, and keeps it (B4.7)", async () => {
    const result = await appRouter.createCaller(ctxFor()).suppression.save({
      personaId: 5,
      rules: [{
        pattern: "",
        kind: "multi_point",
        confidence: 0.8,
        source: "auto",
        verified: true,
        evidence: [{ snippet: "到家了。今天好累" }],
      }],
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({ kind: "multi_point", pattern: "", verified: true });
    expect(updatePersona).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({
        personaData: expect.objectContaining({
          suppressions: [expect.objectContaining({ kind: "multi_point", pattern: "" })],
        }),
      }),
    );
  });

  it("still refuses a phrase rule with no phrase", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).suppression.save({
        personaId: 5,
        rules: [{ pattern: "", kind: "no_phrase" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updatePersona).not.toHaveBeenCalled();
  });
});
