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

import { buildGroupFixture, buildXiaomanRecords, GROUP_FIXTURE_TRUTH } from "../test-fixtures/xiaoman";
import { afterRecordsChanged, afterRecordsRemoved, measureStyleProfile } from "./style-profile";

/** Forty of the persona's chat lines, enough for a private fingerprint. */
function privateChatRows(count = 40) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    role: "assistant",
    content: "在的呀",
    timestamp: new Date(Date.parse("2022-03-01T12:00:00.000Z") + i * 120_000),
    kind: "text",
    speaker: "小满",
    meta: null,
  }));
}

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

  it("writes the sticker table from the fixture", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
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
          emotion: row.truth.state,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    const stickerRows = fixture.filter(
      (row) => row.kind === "sticker" && row.role === "assistant",
    );
    expect(measured.stickers?.samples).toBe(stickerRows.length);
    expect(measured.stickers?.byState.happy?.rate).toBeGreaterThan(0);
    expect(measured.stickers?.byState.distant?.rate).toBe(0);
  });

  it("writes the voice table from the fixture", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
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
          emotion: row.truth.state,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.voice?.durationSec.median).toBe(12);
    expect(measured.voice?.byState.warm?.rate).toBeGreaterThan(0);
  });

  it("measures the public register separately and needs forty posts", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树", timezone: "Asia/Shanghai" });
    const privateRows = buildXiaomanRecords();
    const makePublic = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: 10_000 + i,
        role: "assistant",
        content: i % 3 === 0 ? "今天去看了海。" : i % 3 === 1 ? "周末在家。" : "晚上吃了面。",
        timestamp: new Date(Date.UTC(2024, 5, 1 + (i % 28), 12, 0, i % 60)),
        kind: "text",
        speaker: "小满",
        meta: { register: "public" },
      }));
    let publicRows: ReturnType<typeof makePublic> = [];
    iterateRecords.mockImplementation(async function* (
      _personaId: number,
      _userId: number,
      options?: { register?: string },
    ) {
      const source = options?.register === "public" ? publicRows : privateRows;
      for (const row of source) yield row;
    });

    const before = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(before.publicFingerprint).toBeUndefined();

    publicRows = makePublic(60);
    const withPosts = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(withPosts.publicFingerprint).toBeTruthy();
    // The private measurements do not move when public posts arrive.
    expect(withPosts.fingerprint).toEqual(before.fingerprint);
    expect(withPosts.samplePool).toEqual(before.samplePool);
    expect(withPosts.actClusters).toEqual(before.actClusters);
    expect(withPosts.replyDelay).toEqual(before.replyDelay);

    const privateBefore = withPosts.fingerprint;
    publicRows = makePublic(39);
    const short = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(short.publicFingerprint).toBeUndefined();
    expect(short.fingerprint).toEqual(privateBefore);
    // Three full measurements over the xiaoman fixture are CPU-heavy and
    // cross the 5s default under the full suite's parallelism. The
    // assertions are unchanged; only the limit is widened.
  }, 30_000);

  it("measures the written register separately and never mixes it into the chat voice (C1.8)", async () => {
    getRecordsVersion.mockResolvedValue("45:45");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    const makeWritten = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: 20_000 + i,
        role: "assistant",
        content: i % 2 === 0 ? "今天去了海边，风很大。" : "想起去年冬天的事。",
        timestamp: new Date(Date.UTC(2023, 4, 1 + (i % 28), 4, 0, i % 60)),
        kind: "text",
        speaker: "小满",
        meta: { register: "written" },
      }));
    let writtenRows: ReturnType<typeof makeWritten> = makeWritten(45);
    let privateRows: Array<Record<string, unknown>> = [];
    iterateRecords.mockImplementation(async function* (
      _personaId: number,
      _userId: number,
      options?: { register?: string },
    ) {
      const source = options?.register === "written" ? writtenRows : privateRows;
      for (const row of source) yield row;
    });

    const onlyWritten = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(onlyWritten.writtenFingerprint?.samples).toBe(45);
    // With no private rows there is no chat fingerprint and no sample
    // pool: the written lines must not fill that gap with a default.
    expect(onlyWritten.fingerprint).toBeUndefined();
    expect(onlyWritten.samplePool).toBeUndefined();

    // The written measurement does not move the private one either.
    privateRows = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      role: "assistant",
      content: "在的呀",
      timestamp: new Date(Date.UTC(2023, 4, 1, 12, 0, i % 60)),
      kind: "text",
      speaker: "小满",
      meta: null,
    }));
    const both = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(both.fingerprint?.samples).toBe(40);
    expect(both.writtenFingerprint?.samples).toBe(45);

    writtenRows = makeWritten(39);
    const short = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(short.writtenFingerprint).toBeUndefined();
    expect(short.fingerprint?.samples).toBe(40);
  });

  it("writes the call table from the fixture", async () => {
    getRecordsVersion.mockResolvedValue("3200:3200");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      timezone: "Asia/Shanghai",
      personaData: {},
    });
    getUserById.mockResolvedValue({ id: 1, name: "阿树", timezone: "Asia/Shanghai" });
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
          emotion: row.truth.state,
          meta: row.meta ?? null,
        };
      }
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.calls?.samples).toBe(20);
    expect(measured.calls?.byDirection.in).toBeGreaterThanOrEqual(11);
    expect(measured.calls?.answerSlots[0]?.weekday).toBe(0);
    expect(measured.calls?.answerSlots[0]?.hour).toBe(21);
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
    expect(measured.doubleText?.lines.slice(0, 2).map((row) => row.text)).toEqual(["人呐", "？"]);
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

  it("measures the group register and stores it without touching the chat voice (C9.8)", async () => {
    getRecordsVersion.mockResolvedValue("3500:3500");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    const privateRows = privateChatRows();
    let groupRows: ReturnType<typeof buildGroupFixture> = [];
    iterateRecords.mockImplementation(async function* (
      _personaId: number,
      _userId: number,
      options?: { register?: string },
    ) {
      const source = options?.register === "group" ? groupRows : options?.register ? [] : privateRows;
      for (const row of source) yield row;
    });

    const before = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    // No group rows imported: the field is absent, not zeroed.
    expect(before.group).toBeUndefined();
    expect(before.fingerprint?.samples).toBe(40);

    groupRows = buildGroupFixture();
    const withGroup = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(iterateRecords).toHaveBeenCalledWith(5, 1, { register: "group" });
    expect(withGroup.group?.samples).toBe(GROUP_FIXTURE_TRUTH.samples);
    expect(withGroup.group?.afterMeRate).toBeCloseTo(0.6, 10);
    expect(withGroup.group?.afterOthersRate).toBeCloseTo(0.2, 10);
    expect(withGroup.group?.lengthMedian).toBe(5);
    expect(withGroup.group?.gapMedianMessages).toBe(5);
    // The group rows are read in their own register: the chat fingerprint
    // and everything measured from it stay exactly the same.
    expect(withGroup.fingerprint).toEqual(before.fingerprint);
    expect(withGroup.userSide).toEqual(before.userSide);
    expect(withGroup.samplePool).toEqual(before.samplePool);
    const written = setPersonaStyleProfile.mock.calls.at(-1)?.[2] as
      | { group?: { samples?: number } }
      | undefined;
    expect(written?.group?.samples).toBe(GROUP_FIXTURE_TRUTH.samples);
  });

  it("does not invent a group measurement below the floor (C9.8)", async () => {
    getRecordsVersion.mockResolvedValue("3500:3500");
    getPersonaStyleProfile.mockResolvedValue(null);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    const privateRows = privateChatRows();
    const belowFloor = Array.from({ length: 39 }, (_, i) => ({
      id: 30_000 + i,
      role: "assistant",
      content: "我也想去呀",
      timestamp: new Date(Date.parse("2024-01-08T11:00:00.000Z") + i * 30_000),
      kind: "text",
      speaker: "小满",
      meta: { register: "group" },
    }));
    iterateRecords.mockImplementation(async function* (
      _personaId: number,
      _userId: number,
      options?: { register?: string },
    ) {
      const source = options?.register === "group" ? belowFloor : options?.register ? [] : privateRows;
      for (const row of source) yield row;
    });
    const measured = await measureStyleProfile({
      personaId: 5,
      userId: 1,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(measured.group).toBeUndefined();
    expect(measured.fingerprint?.samples).toBe(40);
    const written = setPersonaStyleProfile.mock.calls.at(-1)?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty("group");
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
