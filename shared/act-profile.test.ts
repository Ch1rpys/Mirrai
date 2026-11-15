import { describe, expect, it } from "vitest";
import {
  ACT_MIN_SAMPLES,
  correctActCount,
  countsForCondition,
  hasActDistribution,
  normalizeActProfile,
  sampleAct,
  type ActProfile,
} from "./act-profile";

function profile(overrides: Partial<ActProfile> = {}): ActProfile {
  const unconditional = {
    answer: 20,
    acknowledge: 10,
    tease: 5,
    silence: 5,
    comfort: 0,
    affection: 0,
    advise: 0,
    logistics: 0,
    deflect: 0,
    repair: 0,
    share: 0,
  };
  return {
    samples: ACT_MIN_SAMPLES,
    unconditional,
    buckets: [
      {
        asking: true,
        counts: { answer: 12, acknowledge: 2 },
        samples: 14,
      },
    ],
    ...overrides,
  };
}

describe("sampling an action", () => {
  it("is stable for a fixed seed", () => {
    const first = sampleAct(profile(), {
      asking: false,
      emotion: "warm",
      dayPart: "day",
      relationshipPhase: "stable",
    }, { rng: () => 0.1 });
    const second = sampleAct(profile(), {
      asking: false,
      emotion: "warm",
      dayPart: "day",
      relationshipPhase: "stable",
    }, { rng: () => 0.1 });
    expect(first?.act).toBe(second?.act);
  });

  it("drops silence when the timing switch is off, and remembers the first draw", () => {
    const thin = profile({
      unconditional: { silence: 100, answer: 1 },
      samples: 101,
      buckets: [],
    });
    const draws: Array<() => number> = [() => 0.01, () => 0.99];
    let i = 0;
    const sampled = sampleAct(
      thin,
      { asking: false, emotion: "warm", dayPart: "day", relationshipPhase: "stable" },
      { dropSilence: true, rng: () => draws[Math.min(i++, draws.length - 1)]() },
    );
    expect(sampled?.drawn).toBe("silence");
    expect(sampled?.act).not.toBe("silence");
    expect(sampled?.resampled).toBe(true);
  });

  it("does not sample from a rumour", () => {
    expect(
      hasActDistribution(normalizeActProfile({ samples: 3, unconditional: { answer: 3 } })),
    ).toBe(false);
    expect(
      sampleAct(
        { samples: 3, unconditional: { answer: 3 }, buckets: [] },
        { asking: true, emotion: "warm", dayPart: "day", relationshipPhase: "initial" },
      ),
    ).toBeNull();
  });

  it("falls back from a thin bucket and says so", () => {
    const { fallback } = countsForCondition(profile({
      buckets: [{ asking: true, emotion: "distant", counts: { tease: 1 }, samples: 1 }],
    }), {
      asking: true,
      emotion: "distant",
      dayPart: "night",
      relationshipPhase: "closing",
    });
    expect(fallback).toBe(true);
  });

  it("subtracts one from a hand-corrected action and marks the profile edited", () => {
    const corrected = correctActCount(profile(), "answer");
    expect(corrected.unconditional.answer).toBe(19);
    expect(corrected.edited).toBe(true);
    expect(corrected.samples).toBe(39);
    const floored = correctActCount(profile({ unconditional: { tease: 0, answer: 40 }, samples: 40 }), "tease");
    expect(floored.unconditional.tease).toBe(0);
  });
});
