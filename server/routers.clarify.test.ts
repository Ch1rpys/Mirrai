import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "./_core/context";

/**
 * The closed-set questions after a distillation.
 *
 * An angry-name answer becomes a confirmed rule. Asking the same
 * question twice is refused. The write sits under the same lock every
 * other personaData write takes.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();
const getPersonaStyleProfile = vi.fn();
const setPersonaStyleProfile = vi.fn();
const iterateRecords = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  setPersonaStyleProfile: (...a: unknown[]) => setPersonaStyleProfile(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
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
let stored: { personaData: Record<string, unknown> };

describe("persona.answerClarification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { personaData: { nickname: "宝贝" } };
    getPersonaById.mockImplementation(async () => ({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: stored.personaData,
    }));
    updatePersona.mockImplementation(async (_id: number, _user: number, patch: { personaData?: Record<string, unknown> }) => {
      if (patch.personaData) stored.personaData = patch.personaData;
      return true;
    });
    getPersonaStyleProfile.mockResolvedValue(null);
    setPersonaStyleProfile.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* () {});
  });

  it("writes a confirmed angry-name rule", async () => {
    await appRouter.createCaller(ctxFor(1)).persona.answerClarification({
      id: 5,
      questionId: "address_angry",
      answer: "喂",
    });
    const rules = stored.personaData.microRules as Array<{ source: string; verified: boolean }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe("manual");
    expect(rules[0]?.verified).toBe(true);
  });

  it("rejects answering the same question twice", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.persona.answerClarification({
      id: 5,
      questionId: "address_angry",
      answer: "喂",
    });
    await expect(
      caller.persona.answerClarification({
        id: 5,
        questionId: "address_angry",
        answer: "喂",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("writes under the persona's lock", () => {
    const at = SOURCE.indexOf("answerClarification: protectedProcedure");
    const lockAt = SOURCE.indexOf("withPersonaDataLock(input.id, async () => {", at);
    const writeAt = SOURCE.indexOf("await updatePersona(input.id, ctx.user.id", lockAt);
    expect(at).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(at);
    expect(writeAt).toBeGreaterThan(lockAt);
  });
});
