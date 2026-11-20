import { describe, expect, it } from "vitest";
import { COPY, copy } from "./index";
import { pickCareNote } from "../../server/safety/usage-monitor";
import { buildCrisisResponse, buildGentleCheckIn } from "../../server/safety/crisis";

/**
 * The memorial register (C7.1).
 *
 * A persona for someone who has died is not a relationship that ended.
 * The words that belong to "getting over it" — 放下, 告别, 毕业, 走出来,
 * move on, let go — do not belong in any of the variants written for
 * that mode. The app still recognises a crisis and still says the caring
 * words, in a different register.
 */
const FORBIDDEN = [/放下/, /告别/, /毕业/, /走出来/, /move on/i, /let go/i];

const memorialKeys = Object.keys(COPY).filter((key) => key.endsWith(".memorial"));

describe("the memorial wording", () => {
  it("has variants to check", () => {
    expect(memorialKeys.length).toBeGreaterThanOrEqual(3);
  });

  it("never uses the leaving-it-behind words", () => {
    for (const key of memorialKeys) {
      const entry = (COPY as Record<string, { zh: string; en: string }>)[key];
      for (const text of [entry.zh, entry.en]) {
        for (const pattern of FORBIDDEN) {
          expect(`${key}: ${text}`).not.toMatch(pattern);
        }
      }
    }
  });

  it("is what the care notes read for a memorial persona", () => {
    const note = pickCareNote(
      { sessionDurationMs: 3 * 60 * 60 * 1000, dailyMessageCount: 0, dependencyRising: false, now: Date.now() } as any,
      "zh",
      { memorial: true },
    );
    expect(note?.text).toBe(copy("zh", "labels.care.longSession.memorial"));
  });

  it("is what the crisis reply reads for a memorial persona", () => {
    const reply = buildCrisisResponse("小A", "zh", { memorial: true });
    expect(reply).toContain(copy("zh", "safety.crisisStop.memorial"));
    expect(reply).not.toContain(copy("zh", "safety.crisisStop"));
  });

  it("is what the gentle check-in reads for a memorial persona", () => {
    expect(buildGentleCheckIn("小A", "zh", { memorial: true })).toBe(
      copy("zh", "safety.crisisGentle.memorial"),
    );
  });
});
