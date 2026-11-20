import { describe, expect, it } from "vitest";
import {
  isDayNearMemoryDate,
  isMemoryDate,
  isMonthDayNearMemoryDate,
} from "./memory-date";

describe("isMemoryDate", () => {
  it("accepts a real day and a month-day", () => {
    expect(isMemoryDate("2021-05-21")).toBe(true);
    expect(isMemoryDate("05-21")).toBe(true);
  });

  it("rejects a day that is not on the calendar", () => {
    expect(isMemoryDate("02-30")).toBe(false);
    expect(isMemoryDate("13-01")).toBe(false);
    expect(isMemoryDate("2026-02-30")).toBe(false);
  });

  it("rejects a phrase that is not a date", () => {
    expect(isMemoryDate("last summer")).toBe(false);
    expect(isMemoryDate("")).toBe(false);
  });
});

describe("the photo window around a memory", () => {
  it("matches a full date within three calendar days", () => {
    expect(isDayNearMemoryDate("2022-04-02", "2022-04-05")).toBe(true);
    expect(isDayNearMemoryDate("2022-04-02", "2022-04-06")).toBe(false);
  });

  it("matches a year-less month and day across New Year", () => {
    expect(isMonthDayNearMemoryDate("2023-01-01", "12-31")).toBe(true);
    expect(isMonthDayNearMemoryDate("2023-01-04", "12-31")).toBe(false);
    expect(isMonthDayNearMemoryDate("2022-12-31", "01-01")).toBe(true);
    expect(isMonthDayNearMemoryDate("2022-12-28", "01-01")).toBe(false);
  });
});
