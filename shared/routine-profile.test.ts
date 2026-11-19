import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { parseZoneless } from "./timezone";
import {
  isAsleep,
  measureRoutine,
  nextWake,
  type RoutineProfile,
  type RoutineRow,
} from "./routine-profile";

function dayAt(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2024, 0, day, hour - 8, minute, 0));
}

describe("when they sleep", () => {
  it("covers 01:00 to 07:00 on the fixture, and ends between 07:30 and 08:00", () => {
    const measured = measureRoutine(buildXiaomanRecords(), "Asia/Shanghai");
    expect(measured).not.toBeNull();
    expect(measured!.sleep).toBeTruthy();
    const { startMin, endMin } = measured!.sleep!;
    expect(endMin).toBeGreaterThanOrEqual(450);
    expect(endMin).toBeLessThanOrEqual(480);
    const profile = measured!;
    for (let minute = 60; minute <= 7 * 60; minute += 30) {
      const hour = Math.floor(minute / 60);
      const mins = minute % 60;
      const at = parseZoneless(
        `2024-06-03 ${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
        "Asia/Shanghai",
      )!;
      expect(isAsleep(at, profile, "Asia/Shanghai"), `${hour}:${mins}`).toBe(true);
    }
    expect(startMin).toBeLessThanOrEqual(60);
  });

  it("returns null when there are only 59 days", () => {
    const rows: RoutineRow[] = [];
    for (let day = 1; day <= 59; day++) {
      rows.push({ role: "assistant", timestamp: dayAt(day, 12) });
      rows.push({ role: "assistant", timestamp: dayAt(day, 21) });
    }
    expect(measureRoutine(rows, "Asia/Shanghai")).toBeNull();
  });

  it("does not invent sleep when they write all day", () => {
    const rows: RoutineRow[] = [];
    for (let day = 1; day <= 70; day++) {
      for (let hour = 0; hour < 24; hour++) {
        rows.push({ role: "assistant", timestamp: dayAt(day, hour, 10) });
      }
    }
    const measured = measureRoutine(rows, "Asia/Shanghai");
    expect(measured).not.toBeNull();
    expect(measured!.sleep).toBeUndefined();
  });

  it("handles a window that crosses midnight", () => {
    const routine: RoutineProfile = { days: 80, sleep: { startMin: 23 * 60, endMin: 7 * 60 } };
    const asleep = new Date("2024-06-01T16:30:00.000Z"); // 00:30 Shanghai
    const awake = new Date("2024-06-01T13:00:00.000Z"); // 21:00 Shanghai
    expect(isAsleep(asleep, routine, "Asia/Shanghai")).toBe(true);
    expect(isAsleep(awake, routine, "Asia/Shanghai")).toBe(false);
    expect(nextWake(asleep, routine, "Asia/Shanghai").toISOString()).toBe(
      parseZoneless("2024-06-02 07:00", "Asia/Shanghai")!.toISOString(),
    );
  });

  it("wakes at the local hour on a daylight-saving day", () => {
    const routine: RoutineProfile = { days: 80, sleep: { startMin: 60, endMin: 8 * 60 } };
    const during = new Date("2024-03-10T06:30:00.000Z"); // 01:30 EST
    expect(isAsleep(during, routine, "America/New_York")).toBe(true);
    expect(nextWake(during, routine, "America/New_York").toISOString()).toBe(
      parseZoneless("2024-03-10 08:00", "America/New_York")!.toISOString(),
    );
    const after = parseZoneless("2024-03-10 08:30", "America/New_York")!;
    expect(isAsleep(after, routine, "America/New_York")).toBe(false);
  });
});
