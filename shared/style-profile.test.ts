import { describe, expect, it } from "vitest";
import { normalizeStyleProfile } from "./style-profile";

describe("the style profile", () => {
  it("fills the identity fields from an empty value", () => {
    expect(normalizeStyleProfile(null)).toEqual({
      version: 1,
      measuredAt: "",
      recordsVersion: "",
    });
  });

  it("drops unknown keys and keeps a measurement that is present", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      extra: true,
      fingerprint: { tokens: 3 },
    });
    expect(profile).not.toHaveProperty("extra");
    expect(profile.fingerprint).toEqual({ tokens: 3 });
    expect(profile.recordsVersion).toBe("12:40");
  });

  it("keeps a per-state sample pool and reads a bare array as any", () => {
    const keyed = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      samplePool: { distant: ["哦。"], warm: ["好呀"] },
    });
    expect(keyed.samplePool).toEqual({ distant: ["哦。"], warm: ["好呀"] });
    const any = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      samplePool: ["嗯"],
    });
    expect(any.samplePool).toEqual({ any: ["嗯"] });
  });

  it("keeps act clusters and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      actClusters: {
        tease: [{ size: 12, lines: ["你真行", "行啊你"] }],
        unknown: [{ size: 12, lines: ["x"] }],
      },
    });
    expect(profile.actClusters).toEqual({
      tease: [{ size: 12, lines: ["你真行", "行啊你"] }],
    });
  });

  it("keeps emotion dynamics and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      emotionDynamics: {
        transitions: { distant: { warm: 10 } },
        dwell: { distant: { medianMin: 300, p75Min: 360, episodes: 6 } },
        modal: "warm",
        samples: 40,
      },
    });
    expect(profile.emotionDynamics?.modal).toBe("warm");
    expect(profile.emotionDynamics?.samples).toBe(40);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      emotionDynamics: { modal: "warm" },
    });
    expect(empty.emotionDynamics).toBeUndefined();
  });

  it("keeps a conflict profile and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      conflict: {
        episodes: 6,
        durationMin: { median: 300, p25: 240, p75: 360, all: [180, 240, 300, 300, 360, 480] },
        repairBy: { them: 4, me: 2 },
        repairAcceptRate: 1,
        repairLines: ["好啦 不气了"],
        coldLines: ["哦。"],
      },
    });
    expect(profile.conflict?.episodes).toBe(6);
    expect(profile.conflict?.repairLines).toEqual(["好啦 不气了"]);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      conflict: { episodes: 0 },
    });
    expect(empty.conflict).toBeUndefined();
  });

  it("keeps a trigger table and drops a group that is too small", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      triggers: [
        { userAct: "acknowledge", to: "distant", n: 6, examples: [{ text: "嗯" }] },
        { userAct: "ask", to: "distant", n: 2, examples: [{ text: "在吗" }] },
      ],
    });
    expect(profile.triggers).toEqual([
      { userAct: "acknowledge", to: "distant", n: 6, examples: [{ text: "嗯" }] },
    ]);
  });

  it("keeps a session profile and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      sessions: {
        scenes: 30,
        lengthMin: { median: 15, p90: 40 },
        closeByThemRate: 0.9,
        closers: [{ text: "晚安", n: 20 }],
      },
    });
    expect(profile.sessions?.closers[0]?.text).toBe("晚安");
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      sessions: { scenes: 0 },
    });
    expect(empty.sessions).toBeUndefined();
  });

  it("keeps a multi-point profile and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      multiPoint: {
        samples: 40,
        coverageMedian: 1 / 3,
        preferLast: 0.8,
        examples: [{ user: "到家了。今天好累", reply: "先歇歇" }],
      },
    });
    expect(profile.multiPoint?.preferLast).toBe(0.8);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      multiPoint: { samples: 0 },
    });
    expect(empty.multiPoint).toBeUndefined();
  });

  it("keeps an in-session profile and drops a malformed one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      inSession: { samples: 200, selfStartRate: 0.15 },
    });
    expect(profile.inSession?.selfStartRate).toBe(0.15);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      inSession: { samples: 0 },
    });
    expect(empty.inSession).toBeUndefined();
  });

  it("keeps a photo table and drops a broken one", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      photos: { samples: 20, rate: 0.5, byState: { happy: { rate: 0.5, turns: 40 } } },
    });
    expect(profile.photos?.samples).toBe(20);
    expect(profile.photos?.byState.happy?.rate).toBe(0.5);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      photos: { samples: 9, rate: 0.5, byState: {} },
    });
    expect(empty.photos).toBeUndefined();
  });

  it("keeps a call table and drops a broken one", () => {
    const calls = {
      samples: 20,
      byDirection: { in: 14, out: 6, missed: 0 },
      durationSec: { median: 1800, p90: 3000, total: 36000 },
      perWeekMedian: 1,
      answerSlots: [{ weekday: 0, hour: 21, n: 16 }],
      longest: { recordId: 9, durationSec: 3600, at: "2024-06-02T13:00:00.000Z" },
      first: { recordId: 1, at: "2022-03-06T13:00:00.000Z" },
      last: { recordId: 20, at: "2024-09-29T13:00:00.000Z" },
    };
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      calls,
    });
    expect(profile.calls).toEqual(calls);
    const empty = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      calls: { samples: 2 },
    });
    expect(empty.calls).toBeUndefined();
  });
});
