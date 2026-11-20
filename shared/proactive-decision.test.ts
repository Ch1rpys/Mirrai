import { describe, expect, it } from "vitest";
import {
  decideProactiveWindow,
  parseQuietHours,
  proactiveUseProbability,
  resolveProactiveDeliverAt,
} from "./proactive-decision";

describe("whether a bought window is used", () => {
  it("never fires at frequency zero", () => {
    const decision = decideProactiveWindow({
      frequencyHours: 0,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "active",
      rng: () => 0,
    });
    expect(decision.used).toBe(false);
    expect(decision.skipReason).toBe("frequency");
  });

  it("fires every time when the rate was never counted", () => {
    expect(proactiveUseProbability(null)).toBe(1);
    const decision = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "active",
      rng: () => 0.99,
    });
    expect(decision.used).toBe(true);
  });

  it("skips when the counted rate is zero", () => {
    expect(proactiveUseProbability(0)).toBe(0);
    const decision = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: 0,
      presence: "active",
      rng: () => 0,
    });
    expect(decision.used).toBe(false);
    expect(decision.skipReason).toBe("probability");
  });

  it("does not fire when they cannot be reached, or have graduated, or asked for quiet", () => {
    expect(decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "active",
      reachability: "unreachable",
      rng: () => 0,
    }).skipReason).toBe("unreachable");
    expect(decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "asleep",
      rng: () => 0,
    }).skipReason).toBe("graduated");
    expect(decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "quiet",
      rng: () => 0,
    }).skipReason).toBe("hold");
  });

  it("skips when the user stepped down the taper (C6.1)", () => {
    const decision = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "active",
      taperStage: 1,
      rng: () => 0,
    });
    expect(decision.used).toBe(false);
    expect(decision.skipReason).toBe("taper");
  });

  it("says nothing for a memorial persona, and records why (C7.1)", () => {
    const decision = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart: new Date("2026-01-01T00:00:00Z"),
      openingRate: null,
      presence: "active",
      memorial: true,
      rng: () => 0,
    });
    expect(decision.used).toBe(false);
    expect(decision.skipReason).toBe("memorial");
  });

  it("is the same decision for the same silence", () => {
    const silenceStart = new Date("2026-01-01T00:00:00Z");
    const a = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart,
      openingRate: 0.1,
      presence: "active",
      rng: () => 0.2,
    });
    const b = decideProactiveWindow({
      frequencyHours: 24,
      silenceStart,
      openingRate: 0.1,
      presence: "active",
      rng: () => 0.2,
    });
    expect(a).toEqual(b);
  });
});

describe("when the message lands", () => {
  it("lands at the end of quiet hours when every active hour sits inside them", () => {
    const quiet = parseQuietHours("00:00-23:59");
    const at = resolveProactiveDeliverAt({
      eligibleAt: new Date("2026-06-01T12:00:00Z"),
      activeHours: [10, 11, 12],
      quietHours: quiet,
      userTimeZone: "UTC",
      personaTimeZone: "UTC",
      rng: () => 0,
    });
    expect(at.getUTCHours()).toBe(23);
    expect(at.getUTCMinutes()).toBe(59);
  });
});
