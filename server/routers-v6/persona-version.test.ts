import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "../_core/context";

/**
 * The snapshots of a persona.
 *
 * Restore writes the four columns back as a set, and stores the
 * current one first. Somebody else's snapshot is not readable.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();
const createPersonaVersion = vi.fn();
const listPersonaVersions = vi.fn();
const getPersonaVersion = vi.fn();
const getEvalRunsByIds = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  createPersonaVersion: (...a: unknown[]) => createPersonaVersion(...a),
  listPersonaVersions: (...a: unknown[]) => listPersonaVersions(...a),
  getPersonaVersion: (...a: unknown[]) => getPersonaVersion(...a),
  getEvalRunsByIds: (...a: unknown[]) => getEvalRunsByIds(...a),
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
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

const SOURCE = readFileSync(path.resolve(__dirname, "persona-version.ts"), "utf-8");

let persona: {
  id: number;
  userId: number;
  name: string;
  personaData: Record<string, unknown>;
  styleProfile: unknown;
  behaviorProfile: unknown;
  settings: unknown;
};

let versions: Array<{
  id: number;
  personaId: number;
  userId: number;
  reason: string;
  personaData: Record<string, unknown>;
  styleProfile: unknown;
  behaviorProfile: unknown;
  settings: unknown;
  evalRunId: number | null;
  createdAt: Date;
}>;

let nextVersionId: number;

describe("personaVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persona = {
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { speakingStyle: "更短", catchphrases: ["在的呀"] },
      styleProfile: { version: 2 },
      behaviorProfile: { samples: 4 },
      settings: { twoStage: "ask" },
    };
    versions = [
      {
        id: 10,
        personaId: 5,
        userId: 1,
        reason: "edit",
        personaData: { speakingStyle: "短句", catchphrases: ["在的呀", "嗯"] },
        styleProfile: { version: 1 },
        behaviorProfile: null,
        settings: null,
        evalRunId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    nextVersionId = 11;
    getPersonaById.mockImplementation(async (id: number, userId: number) => {
      if (id !== persona.id || userId !== persona.userId) return undefined;
      return { ...persona, personaData: { ...persona.personaData } };
    });
    updatePersona.mockImplementation(
      async (id: number, userId: number, patch: Record<string, unknown>) => {
        if (id !== persona.id || userId !== persona.userId) return false;
        Object.assign(persona, patch);
        return true;
      },
    );
    createPersonaVersion.mockImplementation(
      async (personaId: number, userId: number, reason: string) => {
        const id = nextVersionId++;
        versions.push({
          id,
          personaId,
          userId,
          reason,
          personaData: { ...persona.personaData },
          styleProfile: persona.styleProfile,
          behaviorProfile: persona.behaviorProfile,
          settings: persona.settings,
          evalRunId: null,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        });
        return id;
      },
    );
    getPersonaVersion.mockImplementation(async (id: number, userId: number) => {
      return versions.find((row) => row.id === id && row.userId === userId);
    });
    listPersonaVersions.mockImplementation(async (personaId: number, userId: number) => {
      return versions
        .filter((row) => row.personaId === personaId && row.userId === userId)
        .slice()
        .reverse();
    });
    getEvalRunsByIds.mockResolvedValue([]);
  });

  it("restores the persona and stores a restore snapshot first", async () => {
    await appRouter.createCaller(ctxFor(1)).personaVersion.restore({
      id: 5,
      versionId: 10,
    });
    expect(persona.personaData).toEqual({
      speakingStyle: "短句",
      catchphrases: ["在的呀", "嗯"],
    });
    expect(persona.styleProfile).toEqual({ version: 1 });
    expect(persona.behaviorProfile).toBeNull();
    expect(persona.settings).toBeNull();
    const stored = versions.find((row) => row.reason === "restore");
    expect(stored?.personaData).toEqual({
      speakingStyle: "更短",
      catchphrases: ["在的呀"],
    });
    expect(createPersonaVersion).toHaveBeenCalledWith(5, 1, "restore");
    expect(createPersonaVersion.mock.invocationCallOrder[0]).toBeLessThan(
      updatePersona.mock.invocationCallOrder[0],
    );
  });

  it("does not restore somebody else's version", async () => {
    await expect(
      appRouter.createCaller(ctxFor(2)).personaVersion.restore({
        id: 5,
        versionId: 10,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("returns the old and new speakingStyle of two versions", async () => {
    const diff = await appRouter.createCaller(ctxFor(1)).personaVersion.diff({
      id: 5,
      versionId: 10,
    });
    expect(diff.prose.speakingStyle).toEqual({
      before: "短句",
      after: "更短",
    });
    expect(diff.arrays.catchphrases).toEqual({ before: 2, after: 1 });
  });

  it("writes the restore under the persona's lock", () => {
    const at = SOURCE.indexOf("restore: protectedProcedure");
    const lockAt = SOURCE.indexOf("withPersonaDataLock(input.id, async () => {", at);
    const snapshotAt = SOURCE.indexOf('createPersonaVersion(input.id, ctx.user.id, "restore")', lockAt);
    const writeAt = SOURCE.indexOf("await updatePersona(input.id, ctx.user.id", snapshotAt);
    expect(at).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(at);
    expect(snapshotAt).toBeGreaterThan(lockAt);
    expect(writeAt).toBeGreaterThan(snapshotAt);
  });
});
