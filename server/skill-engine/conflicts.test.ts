import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { isTextRecord } from "@shared/records";
import { splitScenes } from "@shared/scenes";
import {
  mineConflicts,
  pickConflictDuration,
  shouldForceRepair,
  type ConflictLine,
  type ConflictProfile,
} from "@shared/conflicts";

function fixtureScenes(): ConflictLine[][] {
  const records = buildXiaomanRecords();
  return splitScenes(
    records.map((row) => ({
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      emotion: isTextRecord(row) ? row.truth.state : null,
      act: row.truth.userAct ?? row.truth.act ?? null,
      id: row.id,
    })),
  );
}

function syntheticProfile(overrides: Partial<ConflictProfile> = {}): ConflictProfile {
  return {
    episodes: 6,
    durationMin: { median: 300, p25: 240, p75: 360, all: [180, 240, 300, 300, 360, 480] },
    repairBy: { them: 4, me: 2 },
    repairAcceptRate: 1,
    repairLines: ["好啦 不气了"],
    coldLines: ["哦。", "随便。"],
    ...overrides,
  };
}

function twoFights(): ConflictLine[][] {
  const start = Date.parse("2022-03-01T04:00:00.000Z");
  const hours = [3, 4];
  return hours.map((h, i) => {
    const t0 = start + i * 10 * 3_600_000;
    return [
      { role: "user", content: "嗯", timestamp: new Date(t0), kind: "text", emotion: null, act: "acknowledge" },
      {
        role: "assistant",
        content: "就嗯？",
        timestamp: new Date(t0 + 60_000),
        kind: "text",
        emotion: "distant",
      },
      {
        role: "assistant",
        content: "好啦 不气了",
        timestamp: new Date(t0 + 60_000 + h * 3_600_000),
        kind: "text",
        emotion: "warm",
      },
    ];
  });
}

describe("mining the fights that used to go quiet", () => {
  it("finds the six designed fights on the fixture", () => {
    const profile = mineConflicts(fixtureScenes());
    expect(profile).toBeTruthy();
    expect(profile!.episodes).toBe(6);
    const expected = [180, 240, 300, 300, 360, 480];
    expect(profile!.durationMin.all).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(profile!.durationMin.all[i]! - expected[i]!)).toBeLessThanOrEqual(10);
    }
    expect(profile!.repairBy).toEqual({ them: 4, me: 2 });
    expect(profile!.repairLines).toContain("好啦 不气了");
    expect(profile!.coldLines.length).toBeGreaterThan(0);
    expect(profile!.coldLines.every((line) => /。$/.test(line))).toBe(true);
  });

  it("returns nothing when there are only two fights", () => {
    expect(mineConflicts(twoFights())).toBeNull();
  });

  it("picks the same duration twice from the same seed", () => {
    const profile = syntheticProfile();
    const first = pickConflictDuration(profile.durationMin.all, () => 0.1);
    const second = pickConflictDuration(profile.durationMin.all, () => 0.1);
    expect(first).toBe(second);
  });

  it("forces a repair after every designed freeze and not after one hour", () => {
    const profile = syntheticProfile();
    expect(
      shouldForceRepair({
        state: "distant",
        sinceMin: 9 * 60,
        profile,
        random: () => 0.99,
      }),
    ).toBe(true);
    expect(
      shouldForceRepair({
        state: "distant",
        sinceMin: 60,
        profile,
        random: () => 0,
      }),
    ).toBe(false);
  });
});
