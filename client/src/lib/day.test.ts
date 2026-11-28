// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { timezone: "Asia/Shanghai" } }),
}));

import { dayKeyInZone, useDayKey } from "./day";

describe("a record's day on the user's calendar (C2.6)", () => {
  it("keeps a line said after midnight on the day the person lived it", () => {
    // 00:30 in Shanghai is still the previous day in UTC.
    expect(dayKeyInZone("2022-03-01T16:30:00.000Z", "Asia/Shanghai")).toBe("2022-03-02");
    // The UTC slice showed 2022-03-01.
    expect("2022-03-01T16:30:00.000Z".slice(0, 10)).toBe("2022-03-01");
  });

  it("passes a day key through and survives a bad value", () => {
    expect(dayKeyInZone("2022-03-01", "Asia/Shanghai")).toBe("2022-03-01");
    expect(dayKeyInZone("not a date", "Asia/Shanghai")).toBe("not a date");
    expect(dayKeyInZone(null, "Asia/Shanghai")).toBe("");
    expect(dayKeyInZone(undefined, null)).toBe("");
  });

  it("keeps a day key on its own day west of UTC (regression)", () => {
    // A day key is a calendar day, not an instant. Reading it with
    // `new Date` made it UTC midnight, and that is the evening before in
    // every zone west of Greenwich — so the memory book showed "2022-02-28"
    // for a line written on 2022-03-01.
    for (const timezone of ["America/New_York", "Pacific/Honolulu", "Asia/Shanghai"]) {
      expect(dayKeyInZone("2022-03-01", timezone), timezone).toBe("2022-03-01");
    }
  });

  it("converts an instant in the zone it is read in (C2.6)", () => {
    const instant = "2022-03-01T16:30:00.000Z";
    // 00:30 on the next day in Shanghai, 11:30 on the same day in New
    // York, 06:30 on the same day in Honolulu.
    expect(dayKeyInZone(instant, "Asia/Shanghai")).toBe("2022-03-02");
    expect(dayKeyInZone(instant, "America/New_York")).toBe("2022-03-01");
    expect(dayKeyInZone(instant, "Pacific/Honolulu")).toBe("2022-03-01");
  });

  it("keeps a zone-less wall clock on the day it names", () => {
    // Times the app stores as the user's own wall clock carry no zone;
    // the day is the one written down, not the one a UTC reading of the
    // string would land on.
    for (const timezone of ["America/New_York", "Pacific/Honolulu", "Asia/Shanghai"]) {
      expect(dayKeyInZone("2022-03-01T00:15:00", timezone), timezone).toBe("2022-03-01");
      expect(dayKeyInZone("2022-03-01 23:30", timezone), timezone).toBe("2022-03-01");
    }
  });

  it("binds the signed-in person's zone", () => {
    const { result } = renderHook(() => useDayKey());
    expect(result.current("2022-03-01T16:30:00.000Z")).toBe("2022-03-02");
    expect(result.current("2022-03-01")).toBe("2022-03-01");
  });
});
