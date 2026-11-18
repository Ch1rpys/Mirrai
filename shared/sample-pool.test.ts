import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import {
  measureSamplePool,
  normalizeSamplePool,
  SAMPLE_POOL_PER_STATE,
} from "./sample-pool";
import type { FingerprintRow } from "./style-fingerprint";

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
    speaker: row.speaker,
  }));
}

describe("measureSamplePool", () => {
  it("keeps the fixture's distant lines short and the warm ones off a period", () => {
    const pool = measureSamplePool(fixtureRows());
    expect(pool?.distant?.length).toBeGreaterThan(0);
    expect(pool?.warm?.length).toBeGreaterThan(0);
    expect(pool?.any?.length).toBeGreaterThan(0);
    expect(pool?.any?.length).toBeLessThanOrEqual(SAMPLE_POOL_PER_STATE);
    expect(pool?.distant?.every((line) => Array.from(line).length <= 4)).toBe(true);
    // The fixture ends 90% of distant lines on a period, not all of them.
    const distantPeriod =
      pool!.distant!.filter((line) => /[。.．]$/.test(line)).length / pool!.distant!.length;
    expect(distantPeriod).toBeGreaterThanOrEqual(0.7);
    expect(pool?.warm?.some((line) => /[。.．]$/.test(line))).toBe(false);
  });

  it("drops a harmful line when the report says to", () => {
    const rows: FingerprintRow[] = Array.from({ length: 20 }, (_, i) => ({
      role: "assistant",
      content: i === 0 ? "你就是个废物" : `在的呀${i}`,
      timestamp: new Date(Date.UTC(2022, 2, 1, 12, i, 0)),
      kind: "text",
      emotion: "warm",
    }));
    const pool = measureSamplePool(rows, {
      harmReport: { decision: "remove", categories: [{ kind: "belittle", count: 1, examples: [] }] },
    });
    expect(JSON.stringify(pool)).not.toContain("废物");
  });
});

describe("normalizeSamplePool", () => {
  it("reads a bare array as the any pool", () => {
    expect(normalizeSamplePool(["嗯", "好呀"])).toEqual({ any: ["嗯", "好呀"] });
  });

  it("drops empty keys and unknown moods", () => {
    expect(
      normalizeSamplePool({
        warm: ["好呀"],
        other: ["nope"],
        distant: [],
      }),
    ).toEqual({ warm: ["好呀"] });
  });
});
