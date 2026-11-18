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
});
