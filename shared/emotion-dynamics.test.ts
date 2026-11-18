import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { isTextRecord } from "./records";
import { splitScenes } from "./scenes";
import {
  applyInertia,
  decayState,
  measureEmotionDynamics,
  type EmotionDynamics,
  type LabelledScene,
} from "./emotion-dynamics";

function fixtureScenes(): LabelledScene[] {
  const records = buildXiaomanRecords();
  return splitScenes(
    records.map((row) => ({
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      emotion: isTextRecord(row) ? row.truth.state : null,
    })),
  );
}

function syntheticDynamics(overrides: Partial<EmotionDynamics> = {}): EmotionDynamics {
  return {
    transitions: { distant: { distant: 20, happy: 1, warm: 1 } },
    dwell: { distant: { medianMin: 300, p75Min: 360, episodes: 6 } },
    modal: "warm",
    samples: 40,
    ...overrides,
  };
}

function scenesWithStates(states: string[], gapHours = 12): LabelledScene[] {
  const start = Date.parse("2022-03-01T12:00:00.000Z");
  return states.map((emotion, i) => {
    const at = new Date(start + i * gapHours * 3_600_000);
    return [
      { role: "user", emotion: null, timestamp: at, kind: "text" },
      { role: "assistant", emotion, timestamp: new Date(at.getTime() + 60_000), kind: "text" },
    ];
  });
}

describe("measuring how a mood used to move", () => {
  it("finds a distant dwell around five hours and warm as the usual state on the fixture", () => {
    const dynamics = measureEmotionDynamics(fixtureScenes());
    expect(dynamics).toBeTruthy();
    expect(dynamics!.modal).toBe("warm");
    expect(dynamics!.samples).toBeGreaterThanOrEqual(30);
    expect(dynamics!.dwell.distant).toBeTruthy();
    expect(dynamics!.dwell.distant!.medianMin).toBeGreaterThanOrEqual(240);
    expect(dynamics!.dwell.distant!.medianMin).toBeLessThanOrEqual(330);
  });

  it("returns nothing when there are only 29 transitions", () => {
    const states = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? "warm" : "happy"));
    expect(measureEmotionDynamics(scenesWithStates(states))).toBeNull();
  });
});

describe("holding a negative state", () => {
  it("keeps distant when it has only lasted 30 minutes and the recovery is rare", () => {
    const applied = applyInertia({
      current: "distant",
      proposed: "happy",
      sinceMin: 30,
      userAct: "other",
      dynamics: syntheticDynamics(),
    });
    expect(applied).toEqual({ state: "distant", kept: true, reason: "inertia" });
  });

  it("lets a repair through when they used to accept it", () => {
    const applied = applyInertia({
      current: "distant",
      proposed: "happy",
      sinceMin: 30,
      userAct: "repair",
      dynamics: syntheticDynamics(),
      repairAcceptRate: 0.3,
    });
    expect(applied.state).toBe("happy");
    expect(applied.kept).toBe(false);
  });

  it("decays distant after 400 minutes and leaves it at 100", () => {
    const dynamics = syntheticDynamics();
    expect(decayState({ current: "distant", sinceMin: 400, dynamics })).toBe("warm");
    expect(decayState({ current: "distant", sinceMin: 100, dynamics })).toBe("distant");
  });
});
