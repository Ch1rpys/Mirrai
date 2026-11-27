import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getPersonaStyleProfile = vi.fn();
const getRecordsVersion = vi.fn();
const setPersonaStyleProfile = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const iterateRecords = vi.fn();
const getUserById = vi.fn();
const listFidelityPairs = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  setPersonaStyleProfile: (...a: unknown[]) => setPersonaStyleProfile(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  listFidelityPairs: (...a: unknown[]) => listFidelityPairs(...a),
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

describe("the style profile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小A" });
    getPersonaStyleProfile.mockResolvedValue(null);
    getRecordsVersion.mockResolvedValue("3:9");
    setPersonaStyleProfile.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* () {});
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    listFidelityPairs.mockResolvedValue([]);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).style.get({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("measure writes version, measuredAt and recordsVersion", async () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const caller = appRouter.createCaller(ctxFor(1));
      const measured = await caller.style.measure({ personaId: 5 });
      expect(measured.profile.version).toBe(1);
      expect(measured.profile.measuredAt).toBe(now.toISOString());
      expect(measured.profile.recordsVersion).toBe("3:9");
      expect(setPersonaStyleProfile).toHaveBeenCalled();
      getPersonaStyleProfile.mockResolvedValue(measured.profile);
      const got = await caller.style.get({ personaId: 5 });
      expect(got.profile).toEqual(measured.profile);
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures again on the explicit route even when the records have not moved", async () => {
    // An explicit measurement is the user asking "measure it now". The
    // automatic calls after an import skip when the version has not moved,
    // which left an old profile without the fields a newer measurement
    // knows how to fill (B9.3's `never` is one).
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "3:9",
    });
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const measured = await appRouter.createCaller(ctxFor(1)).style.measure({ personaId: 5 });
      expect(measured.profile.measuredAt).toBe(now.toISOString());
      expect(setPersonaStyleProfile).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports when the local embedding model is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    try {
      const got = await appRouter.createCaller(ctxFor(1)).style.embedStatus();
      expect(got.status).toBe("no_ollama");
      expect(got.model).toBe("bge-m3");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
