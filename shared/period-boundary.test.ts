import { describe, expect, it } from "vitest";
import { eventKnownBy, memoryKnownBy, periodToInstant } from "./period-boundary";
import { zonedDateKey } from "./timezone";

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

describe("an event with no day", () => {
  const cut = periodToInstant("2022-06-01", "Asia/Shanghai");
  it("is not part of a selected stretch, and stays when no stretch is selected", () => {
    expect(eventKnownBy(null, cut)).toBe(false);
    expect(eventKnownBy(undefined, cut)).toBe(false);
    expect(eventKnownBy(null, null)).toBe(true);
  });
});

describe("a date-only memory against a cut behind UTC", () => {
  it("compares as calendar days, not as UTC midnight", () => {
    const cut = periodToInstant("2026-03-02", "America/New_York")!;
    // New York's 2026-03-02 ends at 2026-03-03T04:59:59.999Z.
    expect(cut.toISOString()).toBe("2026-03-03T04:59:59.999Z");
    const through = zonedDateKey(cut, "America/New_York");
    expect(through).toBe("2026-03-02");
    expect(memoryKnownBy({ date: "2026-03-02", category: "fact" }, cut, new Map(), through)).toBe(true);
    expect(memoryKnownBy({ date: "2026-03-03", category: "fact" }, cut, new Map(), through)).toBe(false);
  });

  it("keeps the old instant comparison when the caller has no day key", () => {
    const cut = periodToInstant("2026-03-02", "America/New_York")!;
    // Callers that only have the instant keep the previous behaviour;
    // the prompt path always passes the day key.
    expect(memoryKnownBy({ date: "2026-03-03", category: "fact" }, cut)).toBe(true);
  });
});
