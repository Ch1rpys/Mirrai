import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { CALL_MIN_SAMPLES, measureCalls, normalizeCallStats } from "./call-stats";

function rows() {
  return buildXiaomanRecords().map((row) => ({
    id: row.id,
    role: row.role,
    kind: row.kind,
    content: row.content,
    timestamp: row.timestamp,
    meta: row.meta ?? null,
  }));
}

function call(id: number, at: string, direction: "in" | "out" | "missed", sec = 600) {
  return {
    id,
    role: direction === "in" ? "assistant" : "user",
    kind: "call",
    content: `[call:voice:${sec}]`,
    timestamp: new Date(at),
    meta: { direction, durationSec: sec },
  };
}

describe("measuring calls", () => {
  it("counts the calls the fixture was designed with", () => {
    const stats = measureCalls(rows(), "Asia/Shanghai");
    expect(stats).not.toBeNull();
    expect(stats!.samples).toBe(20);
    expect(stats!.byDirection.in).toBeGreaterThanOrEqual(11);
    expect(stats!.byDirection.in).toBeLessThanOrEqual(17);
    expect(stats!.byDirection.in + stats!.byDirection.out + stats!.byDirection.missed).toBe(20);
    expect(stats!.durationSec.median).toBeGreaterThanOrEqual(600);
    expect(stats!.durationSec.median).toBeLessThanOrEqual(3600);
    // Every designed call is on a Sunday around nine in the evening.
    expect(stats!.answerSlots.length).toBeGreaterThan(0);
    expect(stats!.answerSlots[0]!.weekday).toBe(0);
    expect(stats!.answerSlots[0]!.hour).toBe(21);
    expect(stats!.answerSlots[0]!.n).toBeGreaterThanOrEqual(16);
    expect(stats!.longest.durationSec).toBeGreaterThanOrEqual(stats!.durationSec.median);
    expect(stats!.first.at <= stats!.last.at).toBe(true);
    expect(stats!.first.recordId).toBeGreaterThan(0);
    expect(stats!.last.recordId).toBeGreaterThan(0);
    expect(stats!.perWeekMedian).toBeGreaterThanOrEqual(1);
  });

  it("returns no measurement with fewer than five calls", () => {
    const all = rows().filter((row) => row.kind === "call");
    expect(measureCalls(all.slice(0, 4), "Asia/Shanghai")).toBeNull();
    expect(measureCalls(all.slice(0, CALL_MIN_SAMPLES), "Asia/Shanghai")).not.toBeNull();
  });

  it("reads an older row's direction from who sent it", () => {
    const stats = measureCalls(
      [
        { id: 1, role: "assistant", kind: "call", content: "[call:voice:120]", timestamp: new Date("2024-06-02T13:00:00Z") },
        { id: 2, role: "user", kind: "call", content: "[call:voice:60]", timestamp: new Date("2024-06-09T13:00:00Z") },
        call(3, "2024-06-16T13:00:00Z", "missed", 0),
        { id: 4, role: "assistant", kind: "call", content: "[call:video:300]", timestamp: new Date("2024-06-23T13:00:00Z") },
        { id: 5, role: "user", kind: "call", content: "[call:voice:180]", timestamp: new Date("2024-06-30T13:00:00Z") },
      ],
      "Asia/Shanghai",
    );
    expect(stats).not.toBeNull();
    expect(stats!.byDirection).toEqual({ in: 2, out: 2, missed: 1 });
    // 13:00Z is 21:00 in Shanghai, and Sunday in both clocks here.
    expect(stats!.answerSlots[0]).toMatchObject({ weekday: 0, hour: 21 });
  });

  it("reads back a stored measurement and drops a broken one", () => {
    const stats = measureCalls(rows(), "Asia/Shanghai")!;
    expect(normalizeCallStats(stats)).toEqual(stats);
    expect(normalizeCallStats({ samples: 4 })).toBeNull();
    expect(normalizeCallStats({ samples: 20 })).toBeNull();
    expect(normalizeCallStats(null)).toBeNull();
  });
});
