import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { mineRoutines } from "./routine";

describe("mining a weekly window from what they used to say", () => {
  it("reads Wednesday 14–16 class off 刚下课, and drops a three-week coincidence", () => {
    const mined = mineRoutines(buildXiaomanRecords(), "Asia/Shanghai");
    const lesson = mined.find(
      (row) =>
        row.kind === "routine" &&
        row.schedule?.weekdays.includes(3) &&
        row.schedule.startHour === 14 &&
        row.schedule.endHour === 16,
    );
    expect(lesson?.title).toBe("周三下午上课");
    expect(lesson?.source).toBe("auto");
    expect(lesson?.verified).toBe(false);
    expect(lesson?.evidence).toHaveLength(3);
    expect(lesson?.evidence.every((row) => row.snippet.includes("刚下课"))).toBe(true);
    expect(lesson?.evidence.every((row) => Boolean(row.at))).toBe(true);

    const threeWeeks = [0, 1, 2].map((week) => ({
      role: "assistant" as const,
      content: "刚下课",
      kind: "text" as const,
      timestamp: new Date(Date.UTC(2022, 2, 2 + week * 7, 8, 5, 0)),
    }));
    expect(mineRoutines(threeWeeks, "Asia/Shanghai")).toEqual([]);
  });
});
