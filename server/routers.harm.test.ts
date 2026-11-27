import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "./_core/context";

/**
 * The user's decision about hurtful lines.
 *
 * A re-run of the distillation must not put a keep/soften/remove back
 * to pending — this route writes the decision under the same lock every
 * other personaData write takes.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
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

const SOURCE = readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
const report = {
  categories: [{ kind: "belittle", count: 5, examples: [1, 2, 3] }],
  decision: "pending",
};

describe("persona.decideHarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小A",
      personaData: { personality: "温柔", harmReport: report },
    });
    updatePersona.mockResolvedValue(true);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.decideHarm({ id: 99, decision: "remove" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes the decision onto the report", async () => {
    await appRouter.createCaller(ctxFor(1)).persona.decideHarm({
      id: 5,
      decision: "keep",
    });
    const patch = updatePersona.mock.calls[0]?.[2] as {
      personaData?: { harmReport?: { decision: string } };
    };
    expect(patch?.personaData?.harmReport?.decision).toBe("keep");
  });

  it("records the soften choice too (C10.1)", async () => {
    await appRouter.createCaller(ctxFor(1)).persona.decideHarm({
      id: 5,
      decision: "soften",
    });
    const patch = updatePersona.mock.calls[0]?.[2] as {
      personaData?: { harmReport?: { decision: string } };
    };
    expect(patch?.personaData?.harmReport?.decision).toBe("soften");
  });

  it("writes under the persona's lock", () => {
    const at = SOURCE.indexOf("decideHarm: protectedProcedure");
    const lockAt = SOURCE.indexOf("withPersonaDataLock(input.id, async () => {", at);
    const writeAt = SOURCE.indexOf("await updatePersona(input.id, ctx.user.id, {", lockAt);
    expect(at).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(at);
    expect(writeAt).toBeGreaterThan(lockAt);
  });
});
