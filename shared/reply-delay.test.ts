import { describe, expect, it } from "vitest";
import { seededRandom } from "../server/_core/behavior-profile";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { BEHAVIOR_MAX_GAP_SEC } from "./behavior-profile";
import {
  measureReplyDelay,
  pickDelayBucket,
  sampleDelayMs,
  type DelayBuckets,
  type DelayRow,
} from "./reply-delay";

function gaps(count: number, seconds: number, band: "evening" | "afternoon"): DelayRow[] {
  const rows: DelayRow[] = [];
  const start = band === "evening"
    ? new Date("2024-06-03T12:00:00.000Z") // 20:00 Shanghai
    : new Date("2024-06-03T04:30:00.000Z"); // 12:30 Shanghai
  for (let i = 0; i < count; i++) {
    const userAt = new Date(start.getTime() + i * 3_600_000);
    const taAt = new Date(userAt.getTime() + seconds * 1000);
    rows.push(
      { role: "user", content: "在吗", timestamp: userAt, kind: "text" },
      { role: "assistant", content: "在", timestamp: taAt, kind: "text", emotion: "warm" },
    );
  }
  return rows;
}

describe("conditional reply delay", () => {
  it("recovers the fixture's evening and afternoon medians", () => {
    const rows = buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      emotion: row.truth.state,
    }));
    const measured = measureReplyDelay(rows, "Asia/Shanghai");
    expect(measured).not.toBeNull();
    const evening = measured!.buckets.evening;
    const afternoon = measured!.buckets.afternoon;
    expect(evening).toBeTruthy();
    expect(afternoon).toBeTruthy();
    expect(Math.exp(evening.mu)).toBeGreaterThan(32);
    expect(Math.exp(evening.mu)).toBeLessThan(48);
    expect(Math.exp(afternoon.mu)).toBeGreaterThan(95);
    expect(Math.exp(afternoon.mu)).toBeLessThan(145);
    expect(evening.sigma).toBeGreaterThan(0.65);
    expect(evening.sigma).toBeLessThan(0.95);
    expect(afternoon.sigma).toBeGreaterThan(0.65);
    expect(afternoon.sigma).toBeLessThan(0.95);
    expect(measured!.resolution).toBe("second");
  });

  it("skips a fine bucket that has only five gaps", () => {
    const profile: DelayBuckets = {
      samples: 40,
      resolution: "second",
      buckets: {
        "evening|warm|false|false": { n: 5, mu: Math.log(10), sigma: 0.1 },
        "evening|warm|false": { n: 12, mu: Math.log(40), sigma: 0.2 },
        evening: { n: 20, mu: Math.log(50), sigma: 0.2 },
        all: { n: 40, mu: Math.log(60), sigma: 0.2 },
      },
    };
    const picked = pickDelayBucket(profile, {
      band: "evening",
      state: "warm",
      asking: false,
      media: false,
    });
    expect(picked.via).toBe("band|state|asking");
    expect(picked.bucket.mu).toBeCloseTo(Math.log(40));
  });

  it("returns null below thirty gaps", () => {
    const measured = measureReplyDelay(gaps(29, 40, "evening"), "Asia/Shanghai");
    expect(measured).toBeNull();
  });

  it("draws the same delay twice from one seed, inside an hour and six", () => {
    const bucket = { n: 30, mu: Math.log(40), sigma: 0.8 };
    const once = sampleDelayMs(bucket, seededRandom("delay-seed"));
    const twice = sampleDelayMs(bucket, seededRandom("delay-seed"));
    expect(twice).toBe(once);
    for (let i = 0; i < 40; i++) {
      const ms = sampleDelayMs(bucket, seededRandom(`delay-${i}`));
      expect(ms).toBeGreaterThanOrEqual(1000);
      expect(ms).toBeLessThanOrEqual(BEHAVIOR_MAX_GAP_SEC * 1000);
    }
  });
});
