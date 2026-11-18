import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { splitScenes } from "./scenes";
import { measureSessions, shouldClose, type SessionProfile } from "./session-profile";

const TZ = "Asia/Shanghai";

function profile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    scenes: 30,
    lengthMin: { median: 15, p90: 40 },
    closeByThemRate: 0.8,
    closers: [{ text: "晚安", n: 20 }],
    bedtime: { median: 1320, p25: 1290, p75: 1350, days: 40 },
    ...overrides,
  };
}

describe("measuring how a scene used to run", () => {
  it("matches the fixture's closing lines, close rate, and bedtime", () => {
    const measured = measureSessions(splitScenes(buildXiaomanRecords()), TZ);
    expect(measured).toBeTruthy();
    expect(measured!.scenes).toBeGreaterThanOrEqual(20);
    expect(measured!.closers.slice(0, 3).map((row) => row.text)).toEqual(["晚安", "安", "睡啦"]);
    expect(measured!.closeByThemRate).toBeGreaterThan(0.9);
    expect(measured!.lengthMin.median).toBeGreaterThan(10);
    expect(measured!.lengthMin.median).toBeLessThan(20);
    expect(measured!.bedtime).toBeTruthy();
    expect(measured!.bedtime!.days).toBeGreaterThanOrEqual(20);
    // 22:21 ± 15 minutes — last evening line of the fixture.
    expect(measured!.bedtime!.median).toBeGreaterThanOrEqual(22 * 60 + 6);
    expect(measured!.bedtime!.median).toBeLessThanOrEqual(22 * 60 + 36);
  });
});

describe("whether this turn should close the chat", () => {
  it("does not close when this session already did", () => {
    expect(
      shouldClose({
        sessionMin: 80,
        personaMinuteOfDay: 1320,
        profile: profile(),
        closedThisSession: true,
      }),
    ).toBe(false);
  });

  it("does not close when they rarely closed", () => {
    expect(
      shouldClose({
        sessionMin: 80,
        personaMinuteOfDay: 1320,
        profile: profile({ closeByThemRate: 0.2 }),
        closedThisSession: false,
      }),
    ).toBe(false);
  });

  it("closes when the session is longer than they used to go", () => {
    expect(
      shouldClose({
        sessionMin: 70,
        personaMinuteOfDay: 600,
        profile: profile(),
        closedThisSession: false,
      }),
    ).toBe(true);
  });

  it("closes in the bedtime window after ten minutes", () => {
    expect(
      shouldClose({
        sessionMin: 12,
        personaMinuteOfDay: 1320,
        profile: profile(),
        closedThisSession: false,
      }),
    ).toBe(true);
  });

  it("does not close outside the bedtime window when the session is still short", () => {
    expect(
      shouldClose({
        sessionMin: 12,
        personaMinuteOfDay: 600,
        profile: profile(),
        closedThisSession: false,
      }),
    ).toBe(false);
  });
});
