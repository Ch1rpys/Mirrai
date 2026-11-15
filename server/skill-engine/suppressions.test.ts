import { describe, expect, it } from "vitest";
import { mineForgetStyles, mineSuppressions } from "./suppressions";

function lines(n: number, text: string) {
  return Array.from({ length: n }, () => ({ role: "assistant", content: text }));
}

describe("counting subtractions", () => {
  it("does not invent a ban from a thin sample", () => {
    expect(mineSuppressions({ messages: lines(10, "嗯") })).toEqual([]);
  });

  it("writes a no-question-ending candidate when they never end that way", () => {
    const mined = mineSuppressions({ messages: lines(40, "嗯，在的") });
    expect(mined.some((row) => row.kind === "no_question_ending")).toBe(true);
    expect(mined.every((row) => row.verified === false)).toBe(true);
    expect(mined.every((row) => row.evidence.length > 0)).toBe(true);
  });

  it("does not write a forget style when none of the three appear", () => {
    expect(mineForgetStyles({ messages: lines(40, "嗯，在的") })).toEqual([]);
  });
});
