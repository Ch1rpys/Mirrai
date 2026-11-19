import { describe, expect, it } from "vitest";
import { memoryKnownBy, periodToInstant } from "./period-boundary";

describe("the end of a selected stretch", () => {
  it("closes the calendar day in the persona's zone", () => {
    const cut = periodToInstant("2022-06-01", "Asia/Shanghai");
    expect(cut?.toISOString()).toBe("2022-06-01T15:59:59.999Z");
    const morningAfter = new Date("2022-06-01T16:30:00.000Z");
    const eveningOf = new Date("2022-06-01T14:00:00.000Z");
    expect(memoryKnownBy(
      { date: null, recordId: 4, category: "memory" },
      cut,
      new Map([[4, morningAfter]]),
    )).toBe(false);
    expect(memoryKnownBy(
      { date: null, recordId: 4, category: "memory" },
      cut,
      new Map([[4, eveningOf]]),
    )).toBe(true);
  });

  it("uses the UTC end of the day when nobody's zone is known", () => {
    expect(periodToInstant("2022-06-01")?.toISOString()).toBe("2022-06-01T23:59:59.999Z");
  });
});
