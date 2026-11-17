import { describe, expect, it } from "vitest";
import { chunkHasFactCue, textHasFactCue } from "./fact-cues";

describe("fact cues", () => {
  it("hears a birthday, a first time, and a hospital", () => {
    expect(textHasFactCue("我生日是5月21号")).toBe(true);
    expect(textHasFactCue("that was the first time")).toBe(true);
    expect(textHasFactCue("we met at the hospital")).toBe(true);
  });

  it("does not treat a bare reply as a clue", () => {
    expect(textHasFactCue("在的呀")).toBe(false);
    expect(textHasFactCue("ok")).toBe(false);
  });

  it("marks a block when any line matches", () => {
    expect(
      chunkHasFactCue({
        rows: [
          { content: "在吗" },
          { content: "我生日是5月21号" },
        ],
      }),
    ).toBe(true);
    expect(
      chunkHasFactCue({
        rows: [{ content: "在的呀" }, { content: "嗯" }],
      }),
    ).toBe(false);
  });
});
