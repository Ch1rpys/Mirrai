import { describe, expect, it } from "vitest";
import { splitBurst } from "./burst";

describe("splitting a reply", () => {
  it("is one line when the draw is one", () => {
    expect(splitBurst("嗯\n好", 1)).toEqual(["嗯\n好"]);
  });

  it("prefers newlines that are already there", () => {
    expect(splitBurst("嗯\n好\n在", 3)).toEqual(["嗯", "好", "在"]);
  });

  it("does not cut in the middle of a word", () => {
    expect(splitBurst("hello", 3)).toEqual(["hello"]);
  });
});
