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

  it("binds the signed-in person's zone", () => {
    const { result } = renderHook(() => useDayKey());
    expect(result.current("2022-03-01T16:30:00.000Z")).toBe("2022-03-02");
  });
});
