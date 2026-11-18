import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import {
  matchRitual,
  mineRituals,
  normalizeRituals,
  turnsFromRecords,
  type RitualTurnLine,
} from "./ritual-table";

function xiaomanTurns() {
  return turnsFromRecords(
    buildXiaomanRecords().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      speaker: row.speaker,
    })),
  );
}

describe("mineRituals", () => {
  it("finds 晚安, 早 and 在吗 on the fixture, with 晚安 coverage 1", () => {
    const mined = mineRituals(xiaomanTurns());
    const triggers = mined.map((entry) => entry.trigger);
    expect(triggers).toEqual(expect.arrayContaining(["晚安", "早", "在吗"]));
    const goodnight = mined.find((entry) => entry.trigger === "晚安");
    expect(goodnight).toBeTruthy();
    expect(goodnight?.coverage).toBe(1);
    const total = goodnight?.n ?? 0;
    const share = (text: string) =>
      (goodnight?.replies.find((row) => row.text === text)?.n ?? 0) / total;
    expect(share("晚安")).toBeGreaterThanOrEqual(0.6 - 0.08);
    expect(share("晚安")).toBeLessThanOrEqual(0.6 + 0.08);
    expect(share("安")).toBeGreaterThanOrEqual(0.25 - 0.08);
    expect(share("安")).toBeLessThanOrEqual(0.25 + 0.08);
    expect(share("睡啦")).toBeGreaterThanOrEqual(0.15 - 0.08);
    expect(share("睡啦")).toBeLessThanOrEqual(0.15 + 0.08);
  });

  it("rejects a trigger that fired 11 times", () => {
    const turns: RitualTurnLine[][] = [];
    for (let i = 0; i < 11; i++) {
      turns.push([{ role: "user", content: "嗨", id: i * 2 + 1 }]);
      turns.push([{ role: "assistant", content: "嗨", id: i * 2 + 2 }]);
    }
    expect(mineRituals(turns).some((entry) => entry.trigger === "嗨")).toBe(false);
  });

  it("rejects a trigger whose top three replies cover only half", () => {
    const turns: RitualTurnLine[][] = [];
    const replies = ["a", "b", "c", "d", "e", "f"];
    for (let i = 0; i < 12; i++) {
      turns.push([{ role: "user", content: "嗨", id: i * 2 + 1 }]);
      turns.push([{ role: "assistant", content: replies[i % 6], id: i * 2 + 2 }]);
    }
    expect(mineRituals(turns).some((entry) => entry.trigger === "嗨")).toBe(false);
  });

  it("does not count an exchange where they sent two bubbles", () => {
    const turns: RitualTurnLine[][] = [];
    for (let i = 0; i < 12; i++) {
      turns.push([{ role: "user", content: "嗨", id: i * 3 + 1 }]);
      turns.push([
        { role: "assistant", content: "嗨", id: i * 3 + 2 },
        { role: "assistant", content: "在", id: i * 3 + 3 },
      ]);
    }
    expect(mineRituals(turns).some((entry) => entry.trigger === "嗨")).toBe(false);
  });
});

describe("normalizeRituals", () => {
  it("keeps a B1.6 handwritten { cue, reply } row as a ritual entry", () => {
    expect(
      normalizeRituals([{ cue: "晚安~", reply: "晚安呀", manual: true }]),
    ).toEqual([
      {
        trigger: "晚安",
        variants: ["晚安~"],
        n: 1,
        replies: [{ text: "晚安呀", n: 1, recordId: 0 }],
        coverage: 1,
        manual: true,
      },
    ]);
  });
});

describe("matchRitual", () => {
  const rituals = mineRituals(xiaomanTurns());

  it("hits 晚安~ and 晚安啦, and misses a longer line", () => {
    expect(matchRitual("晚安~", rituals)?.trigger).toBe("晚安");
    expect(matchRitual("晚安啦", rituals)?.trigger).toBe("晚安");
    expect(matchRitual("晚安 今天好累", rituals)).toBeNull();
  });
});
