import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "./_core/context";
import { normalizePersonaSettings } from "@shared/persona-settings";

/**
 * The per-persona switches, through the router.
 *
 * Somebody else's persona is not readable. A patch is merged under the
 * same lock every other personaData write takes, so two updates cannot
 * drop each other's fields.
 */

const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
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
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

const SOURCE = readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");

describe("persona settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小A" });
    getPersonaSettings.mockResolvedValue(normalizePersonaSettings(null));
    setPersonaSettings.mockResolvedValue(true);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);

    await expect(
      appRouter.createCaller(ctxFor(1)).persona.getSettings({ id: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns the merged settings after a patch", async () => {
    const stored = normalizePersonaSettings({ layers: { stickers: false } });
    getPersonaSettings.mockResolvedValue(stored);
    setPersonaSettings.mockImplementation(async (_id, _userId, next) => {
      getPersonaSettings.mockResolvedValue(next);
      return true;
    });

    const caller = appRouter.createCaller(ctxFor(1));
    await caller.persona.updateSettings({
      id: 5,
      patch: { layers: { twoStage: true }, timing: { maxDelayMinutes: 12 } },
    });
    const settings = await caller.persona.getSettings({ id: 5 });

    expect(settings.layers.twoStage).toBe(true);
    expect(settings.layers.stickers).toBe(false);
    expect(settings.timing.maxDelayMinutes).toBe(12);
    expect(settings.layers.seededTurns).toBe(true);
    expect(setPersonaSettings).toHaveBeenCalled();
  });

  it("writes under the persona's lock", () => {
    const updateAt = SOURCE.indexOf("updateSettings: protectedProcedure");
    const lockAt = SOURCE.indexOf("withPersonaDataLock(input.id, async () => {", updateAt);
    const setAt = SOURCE.indexOf("await setPersonaSettings(input.id, ctx.user.id, next)", lockAt);
    expect(updateAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(updateAt);
    expect(setAt).toBeGreaterThan(lockAt);
  });
});
