import { describe, expect, it } from "vitest";
import { mineOpenLoops } from "./open-loops";

describe("unfinished business", () => {
  it("drops a line with no evidence of a promise", () => {
    expect(mineOpenLoops({ messages: [{ role: "assistant", content: "嗯" }] })).toEqual([]);
  });

  it("keeps the original sentence on a candidate", () => {
    const mined = mineOpenLoops({
      messages: [{ role: "user", content: "改天一起吃饭", timestamp: new Date("2026-01-01") }],
    });
    expect(mined).toHaveLength(1);
    expect(mined[0].verified).toBe(false);
    expect(mined[0].whoSaid).toBe("me");
    expect(mined[0].evidence[0].snippet).toContain("改天一起吃饭");
  });

  it("drops a line that is not from either side", () => {
    expect(mineOpenLoops({ messages: [{ role: "other", content: "下次一起" }] })).toEqual([]);
  });
});
