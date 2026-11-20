import { describe, expect, it } from "vitest";
import { splitScenes } from "@shared/scenes";
import { normalizeTrigger } from "@shared/ritual-table";
import { zonedHour } from "@shared/timezone";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { buildReportFromRecords } from "./report";

const rows = buildXiaomanRecords().map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  kind: row.kind,
  timestamp: row.timestamp,
  createdAt: row.timestamp,
  meta: row.meta ?? null,
}));

const report = buildReportFromRecords(rows, { timeZone: "Asia/Shanghai" });

describe("the annual report", () => {
  it("covers the designed span and active days", () => {
    expect(report.span.from).toBe("2022-03-01");
    expect(report.span.to).toBe("2024-10-31");
    expect(report.span.activeDays).toBe(160);
    expect(report.span.days).toBe(975);
  });

  it("finds the twenty-five day silence between June and July 2023", () => {
    expect(report.longestSilence?.days).toBe(25);
    expect(report.longestSilence?.from.slice(0, 10)).toBe("2023-06-09");
    expect(report.longestSilence?.to.slice(0, 10)).toBe("2023-07-04");
  });

  it("counts every year into the totals", () => {
    const sum = report.byYear.reduce((total, year) => total + year.me + year.them, 0);
    expect(sum).toBe(report.totals.me + report.totals.them);
    expect(sum).toBe(rows.filter((row) => row.role === "user" || row.role === "assistant").length);
  });

  it("counts the first goodnight of each scene exactly once", () => {
    const scenesWithGoodnight = splitScenes(rows).filter((scene) =>
      scene.some((row) => normalizeTrigger(row.content) === "晚安"),
    ).length;
    const counted = report.byYear.reduce(
      (total, year) => total + year.goodnightFirstMe + year.goodnightFirstThem,
      0,
    );
    expect(counted).toBe(scenesWithGoodnight);
    expect(scenesWithGoodnight).toBeGreaterThan(50);
  });

  it("has no message from them in the small hours", () => {
    // The heatmap is one cell per clock hour. The early-morning replies
    // of the fixture start at 07:30, so the hour-7 cell can hold them;
    // the hours from midnight to seven are empty.
    const theirs = rows.filter((row) => row.role === "assistant");
    for (const row of theirs) {
      expect(zonedHour(row.timestamp, "Asia/Shanghai")).toBeGreaterThanOrEqual(7);
    }
    for (const day of report.heatmap) {
      for (let hour = 0; hour < 7; hour++) expect(day[hour]).toBe(0);
    }
  });

  it("gives every year at most twelve terms", () => {
    for (const year of report.byYear) {
      expect(year.topTerms.length).toBeLessThanOrEqual(12);
    }
  });

  it("has no calls when the style profile does not carry them", () => {
    expect(report.calls).toBeNull();
  });
});
