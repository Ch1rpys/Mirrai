import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { splitScenes, toTurns } from "./scenes";
import {
  measureMultiPoint,
  mineMultiPoint,
  splitPoints,
} from "./multi-point";

describe("splitting a message that said several things", () => {
  it("cuts 到家了。今天好累！你吃了吗 into three points", () => {
    expect(splitPoints("到家了。今天好累！你吃了吗")).toEqual(["到家了", "今天好累", "你吃了吗"]);
  });
});

describe("how they used to pick up one of several things", () => {
  const turns = splitScenes(buildXiaomanRecords()).flatMap((scene) => toTurns(scene));
  const measured = measureMultiPoint(turns);

  it("covers about a third of the points and usually the last one", () => {
    expect(measured).toBeTruthy();
    expect(measured!.samples).toBeGreaterThanOrEqual(30);
    expect(measured!.coverageMedian).toBeGreaterThan(0.25);
    expect(measured!.coverageMedian).toBeLessThan(0.42);
    expect(measured!.preferLast).toBeGreaterThanOrEqual(0.7);
    expect(measured!.preferLast).toBeLessThanOrEqual(0.9);
  });

  it("mines a last-thing candidate with three examples", () => {
    const mined = mineMultiPoint({ messages: buildXiaomanRecords(), locale: "zh" });
    expect(mined).toHaveLength(1);
    expect(mined[0]?.kind).toBe("multi_point");
    expect(mined[0]?.verified).toBe(false);
    expect(mined[0]?.pattern).toBe("通常接最后一件");
    expect(mined[0]?.evidence.length).toBe(3);
    expect(mined[0]?.evidence.every((row) => row.snippet.includes("→") || row.snippet.includes("对方"))).toBe(
      true,
    );
  });
});
