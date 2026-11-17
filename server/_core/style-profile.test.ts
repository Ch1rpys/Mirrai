import { describe, expect, it, vi, beforeEach } from "vitest";

const getRecordsVersion = vi.fn();
const getPersonaStyleProfile = vi.fn();
const setPersonaStyleProfile = vi.fn();
const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const iterateRecords = vi.fn();

vi.mock("../db", () => ({
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  setPersonaStyleProfile: (...a: unknown[]) => setPersonaStyleProfile(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
}));

import { afterRecordsChanged, afterRecordsRemoved, measureStyleProfile } from "./style-profile";

describe("measureStyleProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPersonaStyleProfile.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* () {});
  });

  it("does not write again when the records version is unchanged", async () => {
    getRecordsVersion.mockResolvedValue("10:40");
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
    });
    const first = await measureStyleProfile({ personaId: 5, userId: 1 });
    expect(setPersonaStyleProfile).not.toHaveBeenCalled();
    const second = await measureStyleProfile({ personaId: 5, userId: 1 });
    expect(second).toEqual(first);
    expect(setPersonaStyleProfile).not.toHaveBeenCalled();
  });

  it("writes when the records version moved", async () => {
    getRecordsVersion.mockResolvedValue("12:50");
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.recordsVersion).toBe("12:50");
    expect(setPersonaStyleProfile).toHaveBeenCalledTimes(1);
  });
});

describe("afterRecordsChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecordsVersion.mockResolvedValue("3:9");
    getPersonaStyleProfile.mockResolvedValue(null);
    setPersonaStyleProfile.mockResolvedValue(true);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, analysisStatus: "ready" });
    getPersonaSettings.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* () {});
  });

  it("notes new rows on a persona that has already been distilled", async () => {
    await afterRecordsChanged({ personaId: 5, userId: 1, added: 4 });
    expect(setPersonaSettings).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ pendingRedistillAdded: 4 }),
    );
  });

  it("does not note a write of zero", async () => {
    await afterRecordsChanged({ personaId: 5, userId: 1, added: 0 });
    expect(setPersonaSettings).not.toHaveBeenCalled();
  });
});

describe("afterRecordsRemoved", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, analysisStatus: "ready" });
    getPersonaSettings.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
  });

  it("notes a distilled persona whose records version no longer matches", async () => {
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
    });
    getRecordsVersion.mockResolvedValue("7:30");
    await afterRecordsRemoved({ personaId: 5, userId: 1 });
    expect(setPersonaSettings).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ pendingRedistillRemoved: true }),
    );
  });

  it("does not note a table that still matches the profile", async () => {
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
    });
    getRecordsVersion.mockResolvedValue("10:40");
    await afterRecordsRemoved({ personaId: 5, userId: 1 });
    expect(setPersonaSettings).not.toHaveBeenCalled();
  });
});
