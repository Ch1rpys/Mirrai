import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import {
  findTurningPoints,
  mergeTimelinePoints,
  weeklySeries,
  weekStartDate,
  type StoredTurningPoint,
  type TurningPoint,
} from "./timeline";

const rows = buildXiaomanRecords().map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  kind: row.kind,
  timestamp: row.timestamp,
  createdAt: row.timestamp,
  meta: row.meta ?? null,
}));

describe("the weekly curves", () => {
  it("cuts the fixture into weeks with a median length on each side", () => {
    const series = weeklySeries(rows, "Asia/Shanghai");
    expect(series.length).toBeGreaterThan(60);
    const first = series.find((week) => week.charsMedian != null);
    const last = [...series].reverse().find((week) => week.charsMedian != null);
    expect(first?.charsMedian).toBeGreaterThanOrEqual(9);
    expect(last?.charsMedian).toBeLessThanOrEqual(7);
    expect(series.every((week) => week.total >= 0)).toBe(true);
  });

  it("finds the change after the 2023 silence, and the median length moves from about 10 to about 6", () => {
    const points = findTurningPoints(weeklySeries(rows, "Asia/Shanghai"));
    const near = points.filter((point) => {
      const year = Number(point.id.slice(0, 4));
      const week = Number(point.id.slice(6));
      return year === 2023 && week >= 24 && week <= 33;
    });
    expect(near.length).toBeGreaterThanOrEqual(1);
    const lengthChange = near
      .flatMap((point) => point.changes)
      .find((change) => change.series === "charsMedian");
    expect(lengthChange).toBeTruthy();
    expect(Math.abs(lengthChange!.before - 10)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(lengthChange!.after - 6)).toBeLessThanOrEqual(1.5);
  });

  it("counts a negative scene from the emotion column", () => {
    const at = (iso: string) => new Date(iso);
    const series = weeklySeries([
      {
        id: 1,
        role: "assistant",
        content: "哦。",
        kind: "text",
        timestamp: at("2022-03-01T20:00:00+08:00"),
        createdAt: at("2022-03-01T20:00:00+08:00"),
        emotion: "distant",
        meta: null,
      },
      {
        id: 2,
        role: "assistant",
        content: "随便。",
        kind: "text",
        timestamp: at("2022-03-01T20:01:00+08:00"),
        createdAt: at("2022-03-01T20:01:00+08:00"),
        emotion: "distant",
        meta: null,
      },
    ], "Asia/Shanghai");
    expect(series[0]?.negativeShare).toBe(1);
  });

  it("only counts their replies in the reply-time curve", () => {
    const at = (second: number) => new Date(Date.UTC(2022, 0, 3, 12, 0, second));
    const series = weeklySeries([
      { id: 1, role: "user", content: "在吗", kind: "text", timestamp: at(0), createdAt: at(0), meta: null },
      { id: 2, role: "assistant", content: "在", kind: "text", timestamp: at(10), createdAt: at(10), meta: null },
      { id: 3, role: "user", content: "哦", kind: "text", timestamp: at(3600), createdAt: at(3600), meta: null },
    ], "UTC");
    // Their answer is about 10 seconds; my answer to them is 3590.
    expect(series[0]?.replyMedianSec).toBe(10);
  });

  it("finds nothing on a completely steady curve", () => {
    const flat = Array.from({ length: 24 }, (_, index) => ({
      week: `2024-W${String(index + 1).padStart(2, "0")}`,
      total: 10,
      myShare: 0.5,
      replyMedianSec: 40,
      charsMedian: 10,
      startsMeShare: 0.5,
      negativeShare: 0,
    }));
    expect(findTurningPoints(flat)).toEqual([]);
  });

  it("does not make a turn out of a boundary with too few weeks on either side", () => {
    const at = (index: number) => ({
      week: `2024-W${String(index + 1).padStart(2, "0")}`,
      total: 10,
      myShare: 0.5,
      replyMedianSec: index === 3 ? 10 : index >= 4 ? 100 : null,
      charsMedian: 10,
      startsMeShare: 0.5,
      negativeShare: 0,
    });
    // The boundary at week 4 has only three measured weeks before it
    // and four after it: the four-week rule must refuse it.
    const series = Array.from({ length: 8 }, (_, index) => at(index));
    expect(
      findTurningPoints(series, { window: 4 })
        .filter((point) => point.changes.some((change) => change.series === "replyMedianSec")),
    ).toEqual([]);
  });

  it("turns a week key into the date the reader can jump to", () => {
    expect(weekStartDate("2023-W27")).toBe("2023-07-03");
    expect(weekStartDate("not-a-week")).toBeNull();
  });
});

describe("the user's decisions on the electrocardiogram (C2.5)", () => {
  const detected: TurningPoint[] = [
    { id: "2023-W27", at: "2023-W27", changes: [{ series: "charsMedian", before: 10, after: 6 }], status: "auto" },
    { id: "2023-W33", at: "2023-W33", changes: [{ series: "total", before: 40, after: 12 }], status: "auto" },
  ];

  it("keeps a confirmed turn the new records no longer detect", () => {
    // The records change — a file is deleted, a row is corrected — and a
    // week that used to qualify stops qualifying. The user's confirmation
    // and the sentence they wrote about it are still their own; hiding
    // them makes the page disagree with what they decided.
    const stored: StoredTurningPoint[] = [{
      id: "2023-W29",
      at: "2023-W29",
      changes: [{ series: "charsMedian", before: 9, after: 5 }],
      status: "confirmed",
      note: "那周以后话短了",
    }];
    const merged = mergeTimelinePoints(detected, stored);
    const kept = merged.find((point) => point.id === "2023-W29");
    expect(kept).toMatchObject({ status: "confirmed", note: "那周以后话短了" });
    expect(kept?.weekStart).toBe(weekStartDate("2023-W29"));
    /**
     * The point survives so the user can still see it, and what moved
     * has to survive with it: the store keeps the changes the user
     * confirmed, because this run no longer measures them. An empty
     * change list here is what used to drop the line and the sentence
     * from the page.
     */
    expect(kept?.changes).toEqual([{ series: "charsMedian", before: 9, after: 5 }]);
    // And the detected ones are still there.
    expect(merged.map((point) => point.id)).toEqual(["2023-W27", "2023-W29", "2023-W33"]);
  });

  it("applies the decision to a turn that is still detected", () => {
    const merged = mergeTimelinePoints(detected, [{
      id: "2023-W27",
      at: "2023-W27",
      changes: [],
      status: "confirmed",
      note: "是对的",
    }]);
    expect(merged.find((point) => point.id === "2023-W27")).toMatchObject({
      status: "confirmed",
      note: "是对的",
    });
  });

  it("still drops a rejected turn, even when it was not re-detected", () => {
    const merged = mergeTimelinePoints(detected, [{
      id: "2000-W01",
      at: "2000-W01",
      changes: [],
      status: "rejected",
    }]);
    expect(merged.map((point) => point.id)).not.toContain("2000-W01");
  });
});
