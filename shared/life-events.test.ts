import { describe, expect, it } from "vitest";
import {
  currentRoutines,
  inProgressLife,
  normalizeLifeEvents,
} from "./life-events";

describe("normalising stored life events", () => {
  it("leaves an old row without a routine kind unchanged", () => {
    const events = normalizeLifeEvents([
      {
        id: "e1",
        kind: "life",
        title: "下周答辩",
        detail: "下周要答辩",
        whoSaid: "them",
        closed: false,
        source: "manual",
        verified: true,
        evidence: [],
      },
      {
        id: "e2",
        kind: "open_loop",
        title: "伞",
        detail: "记得带伞",
        source: "manual",
        verified: true,
        closed: false,
      },
    ]);
    expect(events.map((row) => row.kind)).toEqual(["life", "open_loop"]);
    expect(events[0]?.schedule).toBeUndefined();
    expect(inProgressLife(events).map((row) => row.id)).toEqual(["e1"]);
  });

  it("drops a routine that has no usable schedule", () => {
    const events = normalizeLifeEvents([
      { kind: "routine", title: "周三下午上课", source: "auto", verified: true },
    ]);
    expect(events).toEqual([]);
  });
});

describe("the clock falling inside a confirmed routine", () => {
  const routine = {
    id: "r1",
    kind: "routine" as const,
    title: "周三下午上课",
    detail: "",
    whoSaid: "them",
    closed: false,
    source: "auto" as const,
    verified: true,
    evidence: [],
    schedule: { weekdays: [3], startHour: 14, endHour: 16 },
  };

  it("counts as in-progress life only inside the window", () => {
    const events = normalizeLifeEvents([routine]);
    const wed = new Date("2026-11-18T07:00:00Z");
    const thu = new Date("2026-11-19T07:00:00Z");
    expect(currentRoutines(events, wed, "Asia/Shanghai").map((row) => row.id)).toEqual(["r1"]);
    expect(inProgressLife(events, wed, "Asia/Shanghai").map((row) => row.id)).toEqual(["r1"]);
    expect(currentRoutines(events, thu, "Asia/Shanghai")).toEqual([]);
    expect(inProgressLife(events, thu, "Asia/Shanghai")).toEqual([]);
    expect(inProgressLife(events)).toEqual([]);
  });

  it("omits an unconfirmed window", () => {
    const events = normalizeLifeEvents([{ ...routine, verified: false }]);
    expect(currentRoutines(events, new Date("2026-11-18T07:00:00Z"), "Asia/Shanghai")).toEqual([]);
  });
});
