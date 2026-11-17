import { describe, expect, it } from "vitest";
import { isMemoryDate } from "./memory-date";

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
