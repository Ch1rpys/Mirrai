import { describe, expect, it, vi, beforeEach } from "vitest";

const getRecordsVersion = vi.fn();
const getPersonaStyleProfile = vi.fn();
const setPersonaStyleProfile = vi.fn();
const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const getUserById = vi.fn();
const iterateRecords = vi.fn();
const listFidelityPairs = vi.fn();

vi.mock("../db", () => ({
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  setPersonaStyleProfile: (...a: unknown[]) => setPersonaStyleProfile(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  listFidelityPairs: (...a: unknown[]) => listFidelityPairs(...a),
}));

import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { afterRecordsChanged, afterRecordsRemoved, measureStyleProfile } from "./style-profile";

describe("measureStyleProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPersonaStyleProfile.mockResolvedValue(true);
    iterateRecords.mockImplementation(async function* () {});
    listFidelityPairs.mockResolvedValue([]);
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

  it("writes a fingerprint when there are enough of their lines", async () => {
    getRecordsVersion.mockResolvedValue("40:40");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { nickname: "树树" },
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (let i = 0; i < 40; i++) {
        yield {
          role: "assistant",
          content: "在的呀",
          timestamp: new Date("2022-03-01T12:00:00.000Z"),
          kind: "text",
          emotion: "warm",
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.fingerprint?.samples).toBe(40);
    expect(measured.fingerprint?.particles["呀"]).toBe(1);
  });

  it("writes the fixture's 晚安 / 早 / 在吗 table and keeps a handwritten one", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "1:1",
      rituals: [
        {
          trigger: "嗨",
          variants: ["嗨"],
          n: 1,
          replies: [{ text: "嗨", n: 1, recordId: 1 }],
          coverage: 1,
          manual: true,
        },
      ],
    });
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { nickname: "树树" },
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (const row of buildXiaomanRecords()) {
        yield {
          id: row.id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          kind: row.kind,
          speaker: row.speaker,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const rituals = measured.rituals as Array<{ trigger: string; manual?: boolean; coverage: number }> | undefined;
    expect(rituals?.map((entry) => entry.trigger)).toEqual(
      expect.arrayContaining(["晚安", "早", "在吗", "嗨"]),
    );
    expect(rituals?.find((entry) => entry.trigger === "晚安")?.coverage).toBe(1);
    expect(rituals?.find((entry) => entry.trigger === "嗨")?.manual).toBe(true);
  });

  it("writes a per-state sample pool from the fixture", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { nickname: "树树" },
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (const row of buildXiaomanRecords()) {
        yield {
          id: row.id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          kind: row.kind,
          speaker: row.speaker,
          emotion: row.truth.state, // as B1.5 would have labelled it
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const distant = measured.samplePool?.distant ?? [];
    const warm = measured.samplePool?.warm ?? [];
    expect(distant.length).toBeGreaterThan(0);
    expect(warm.length).toBeGreaterThan(0);
    expect(distant.every((line) => Array.from(line).length <= 4)).toBe(true);
    expect(warm.some((line) => /[。.．]$/.test(line))).toBe(false);
  });

  it("writes acknowledge clusters whose every line is a true acknowledge", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { nickname: "树树" },
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    const fixture = buildXiaomanRecords();
    iterateRecords.mockImplementation(async function* () {
      for (const row of fixture) {
        yield {
          id: row.id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          kind: row.kind,
          speaker: row.speaker,
          act: row.truth.act ?? null,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.actClusters?.acknowledge).toBeTruthy();
    expect(measured.actClusters!.acknowledge!.length).toBeGreaterThan(0);
    const allowed = new Set(
      fixture
        .filter((row) => row.role === "assistant" && row.kind === "text" && row.truth.act === "acknowledge")
        .map((row) => row.content),
    );
    for (const cluster of measured.actClusters!.acknowledge!) {
      for (const line of cluster.lines) {
        expect(allowed.has(line)).toBe(true);
      }
    }
  });

  it("writes emotion dynamics whose distant dwell is about five hours", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { nickname: "树树" },
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (const row of buildXiaomanRecords()) {
        yield {
          id: row.id,
          role: row.role,
          content: row.content,
          timestamp: row.timestamp,
          kind: row.kind,
          speaker: row.speaker,
          emotion: row.truth.state,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.emotionDynamics?.modal).toBe("warm");
    expect(measured.emotionDynamics?.samples).toBeGreaterThanOrEqual(30);
    expect(measured.emotionDynamics?.dwell.distant?.medianMin).toBeGreaterThanOrEqual(240);
    expect(measured.emotionDynamics?.dwell.distant?.medianMin).toBeLessThanOrEqual(330);
    expect(measured.conflict?.episodes).toBe(6);
    expect(measured.conflict?.repairBy).toEqual({ them: 4, me: 2 });
    expect(measured.conflict?.repairLines).toContain("好啦 不气了");
    const ack = measured.triggers?.find((row) => row.userAct === "acknowledge");
    expect(ack?.n).toBe(6);
    expect(ack?.examples.every((example) => example.text === "嗯")).toBe(true);
    expect(measured.sessions?.closers.slice(0, 3).map((row) => row.text)).toEqual([
      "晚安",
      "安",
      "睡啦",
    ]);
    expect(measured.multiPoint?.samples).toBeGreaterThanOrEqual(30);
    expect(measured.multiPoint?.coverageMedian).toBeGreaterThan(0.25);
    expect(measured.multiPoint?.coverageMedian).toBeLessThan(0.42);
    expect(measured.inSession?.samples).toBeGreaterThanOrEqual(100);
    expect(measured.typing?.msPerChar).toBeGreaterThanOrEqual(160);
    expect(measured.typing?.msPerChar).toBeLessThanOrEqual(240);
    expect(measured.typing?.pairs).toBeGreaterThanOrEqual(30);
    expect(measured.quirks?.typoFixes.reduce((sum, row) => sum + row.n, 0)).toBe(6);
    expect(measured.doubleText?.samples).toBe(30);
    expect(measured.doubleText?.lines.slice(0, 2).map((row) => row.text)).toEqual(["人呢", "？"]);
  });

  it("remakes the sample pool from labelled rows even when the records version is unchanged", async () => {
    getRecordsVersion.mockResolvedValue("10:40");
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
      samplePool: { any: ["嗯"] },
    });
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (let i = 0; i < 12; i++) {
        yield {
          role: "assistant",
          content: "哦。",
          timestamp: new Date("2022-03-01T12:00:00.000Z"),
          kind: "text",
          emotion: "distant",
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      force: true,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.samplePool?.distant).toEqual(Array.from({ length: 12 }, () => "哦。"));
    expect(measured.samplePool?.any).toEqual(Array.from({ length: 12 }, () => "哦。"));
    expect(setPersonaStyleProfile).toHaveBeenCalled();
  });

  it("trains a negative length weight from thirty short-line picks even when the records have not moved", async () => {
    getRecordsVersion.mockResolvedValue("10:40");
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:40",
    });
    listFidelityPairs.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        features: {
          chosen: { ll: 0, length: 4 + (i % 3), surprise: 0.1, residue: 0, act: 0, real: 0.5 },
          rejected: { ll: 0, length: 28 + i, surprise: 0.1, residue: 0, act: 0, real: 0.5 },
        },
      })),
    );
    const measured = await measureStyleProfile({ personaId: 5, userId: 1 });
    const weights = measured.rerankWeights as { length?: number } | undefined;
    expect(weights?.length).toBeLessThan(0);
    expect(setPersonaStyleProfile).toHaveBeenCalled();
  });

  it("stores the user's own side of the record in the profile", async () => {
    getRecordsVersion.mockResolvedValue("80:80");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    iterateRecords.mockImplementation(async function* () {
      for (let i = 0; i < 40; i++) {
        yield {
          role: "user",
          content: `我自己说的一句 ${i}`,
          timestamp: new Date(Date.parse("2022-03-01T12:00:00.000Z") + i * 120_000),
          kind: "text",
        };
        yield {
          role: "assistant",
          content: "在的呀",
          timestamp: new Date(Date.parse("2022-03-01T12:01:00.000Z") + i * 120_000),
          kind: "text",
        };
      }
    });
    const measured = await measureStyleProfile({ personaId: 5, userId: 1 });
    expect(measured.userSide?.samples).toBe(40);
    expect(measured.userSide?.sampleLines).toHaveLength(12);
    const written = setPersonaStyleProfile.mock.calls.at(-1)?.[2] as
      | { userSide?: { samples?: number } }
      | undefined;
    expect(written?.userSide?.samples).toBe(40);
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
    listFidelityPairs.mockResolvedValue([]);
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
