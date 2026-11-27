import { describe, expect, it } from "vitest";
import { zonedDateKey } from "@shared/timezone";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { pickOnThisDay } from "./on-this-day";

const ZONE = "Asia/Shanghai";

function fixtureRows() {
  return buildXiaomanRecords()
    .filter((row) => row.kind === "text" && row.timestamp)
    .map((row) => ({
      id: row.id,
      role: row.role,
      kind: row.kind,
      content: row.content,
      timestamp: row.timestamp,
      meta: row.meta ?? null,
    }));
}

describe("on this day", () => {
  it("finds the same calendar day in the years before, six lines each", () => {
    const rows = fixtureRows();
    const days = new Map<string, Set<number>>();
    for (const row of rows) {
      const key = zonedDateKey(row.timestamp!, ZONE);
      const set = days.get(key.slice(5)) ?? new Set<number>();
      set.add(Number(key.slice(0, 4)));
      days.set(key.slice(5), set);
    }
    const chosen = [...days.entries()].find(
      ([day, years]) => years.size >= 2 && day !== "02-29",
    );
    expect(chosen).toBeTruthy();
    const day = chosen![0];
    const today = new Date(`2025-${day}T12:00:00+08:00`);
    const years = pickOnThisDay(rows, today, ZONE);
    expect(years.length).toBeGreaterThanOrEqual(2);
    expect(years.map((year) => year.year)).toEqual(
      [...years.map((year) => year.year)].sort((a, b) => a - b),
    );
    for (const year of years) {
      expect(year.rows.length).toBeGreaterThan(0);
      expect(year.rows.length).toBeLessThanOrEqual(6);
      for (const row of year.rows) {
        expect(zonedDateKey(row.timestamp!, ZONE).slice(5)).toBe(day);
      }
    }
  });

  it("counts the twenty-ninth of February on the twenty-eighth of a common year", () => {
    const rows = [{
      id: 1,
      role: "assistant",
      kind: "text",
      content: "四年才过一次",
      timestamp: new Date("2024-02-29T04:00:00.000Z"),
      meta: null,
    }];
    const today = new Date("2025-02-28T04:00:00.000Z");
    const years = pickOnThisDay(rows, today, ZONE);
    expect(years).toHaveLength(1);
    expect(years[0].year).toBe(2024);
    expect(years[0].rows[0].content).toBe("四年才过一次");
  });

  it("keeps the twenty-ninth of February on its own day in a leap year", () => {
    // In a leap year the 29th exists, so it is not folded into the 28th:
    // the two days have different records and the calendar can show both.
    const rows = [{
      id: 1,
      role: "assistant",
      kind: "text",
      content: "四年才过一次",
      timestamp: new Date("2024-02-29T04:00:00.000Z"),
      meta: null,
    }];
    const today = new Date("2028-02-28T04:00:00.000Z");
    const years = pickOnThisDay(rows, today, ZONE);
    expect(years).toHaveLength(0);
  });

  it("uses the user's own calendar day on the other side of the date line", () => {
    const rows = [{
      id: 1,
      role: "assistant",
      kind: "text",
      content: "在的呀",
      timestamp: new Date("2024-02-28T20:00:00.000Z"),
      emotion: null,
      meta: null,
    }];
    // 2025-03-01T02:00Z is still 2025-02-28 in Los Angeles, and the
    // record is 2024-02-28 there too; in Shanghai the same two are
    // 2025-03-01 and 2024-02-29, so the day does not match.
    const today = new Date("2025-03-01T02:00:00.000Z");
    expect(pickOnThisDay(rows, today, "America/Los_Angeles")).toHaveLength(1);
    expect(pickOnThisDay(rows, today, "Asia/Shanghai")).toEqual([]);
  });

  it("leaves out a day whose first scene was a bad one", () => {
    const rows = [
      {
        id: 1,
        role: "assistant",
        kind: "text",
        content: "哦。",
        timestamp: new Date("2022-03-01T00:10:00+08:00"),
        emotion: "distant",
        meta: null,
      },
      {
        id: 2,
        role: "assistant",
        kind: "text",
        content: "随便。",
        timestamp: new Date("2022-03-01T00:11:00+08:00"),
        emotion: "distant",
        meta: null,
      },
      {
        id: 3,
        role: "assistant",
        kind: "text",
        content: "在的呀",
        timestamp: new Date("2022-03-01T20:00:00+08:00"),
        emotion: "warm",
        meta: null,
      },
      {
        id: 4,
        role: "assistant",
        kind: "text",
        content: "晚安",
        timestamp: new Date("2022-03-01T20:01:00+08:00"),
        emotion: "warm",
        meta: null,
      },
    ];
    const today = new Date("2025-03-01T12:00:00+08:00");
    const years = pickOnThisDay(rows, today, ZONE);
    expect(years).toHaveLength(1);
    expect(years[0].rows.map((row) => row.content)).toEqual(["在的呀", "晚安"]);
  });

  it("folds a harmful line away unless the user kept those lines", () => {
    const rows = [{
      id: 1,
      role: "assistant",
      kind: "text",
      content: "你真没用",
      timestamp: new Date("2022-03-01T20:00:00+08:00"),
      meta: null,
    }];
    const today = new Date("2025-03-01T12:00:00+08:00");
    expect(pickOnThisDay(rows, today, ZONE)).toEqual([]);
    expect(
      pickOnThisDay(rows, today, ZONE, {
        harmReport: { categories: [], decision: "keep" },
        keepHarm: true,
      }),
    ).toHaveLength(1);
  });
});
