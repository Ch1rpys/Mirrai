import { describe, expect, it } from "vitest";
import { measureInSession, pickInSessionFact, type InSessionLine } from "./in-session";
import { normalizeLifeEvents } from "./life-events";

function turn(role: "user" | "assistant", content: string): InSessionLine[] {
  return [{ role, content, kind: "text" }];
}

describe("starting a topic in the middle of a chat", () => {
  it("counts 30 self-starts in 200 mid-scene turns as 0.15", () => {
    const turns: InSessionLine[][] = [
      turn("user", "在吗"),
      turn("assistant", "在"),
    ];
    for (let i = 0; i < 200; i++) {
      if (i < 30) {
        turns.push(turn("user", "今天天气不错"));
        const a = String.fromCodePoint(0x4e00 + i * 20);
        const b = String.fromCodePoint(0x4e00 + i * 20 + 1);
        turns.push(turn("assistant", a + b));
      } else {
        turns.push(turn("user", "吃饭了吗？"));
        turns.push(turn("assistant", "吃了"));
      }
    }
    const measured = measureInSession(turns);
    expect(measured).toEqual({ samples: 200, selfStartRate: 0.15 });
  });

  it("picks an open loop before an in-progress life event", () => {
    const events = normalizeLifeEvents([
      {
        id: "life-1",
        kind: "life",
        title: "下周答辩",
        detail: "下周要答辩",
        source: "manual",
        verified: true,
        closed: false,
      },
      {
        id: "loop-1",
        kind: "open_loop",
        title: "伞",
        detail: "记得带伞",
        source: "manual",
        verified: true,
        closed: false,
      },
    ]);
    expect(pickInSessionFact(events)).toBe("记得带伞");
  });
});
