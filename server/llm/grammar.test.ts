import { describe, expect, it } from "vitest";
import { GRAMMAR_DEFAULT_LINES, GRAMMAR_MAX_LINES, shapeGrammar } from "./grammar";

/**
 * The shape checker written a second way.
 *
 * The grammar is a constraint for llama.cpp; there is no GBNF parser in
 * this repository to run a sample through. This function is the same shape
 * expressed directly, so the test can say which strings the grammar is
 * meant to accept and which it is meant to refuse.
 */
function fitsShape(text: string, maxLines: number): boolean {
  if (text === "") return false;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.split("\n");
  if (lines.length > maxLines) return false;
  return lines.every((line) => {
    if (line.length === 0) return false;
    const first = line[0]!;
    if (first === "-" || first === "*" || first === "#") return false;
    if (/[0-9]/.test(first) && line.length > 1) {
      const second = line[1]!;
      if (second === "." || second === "、" || second === ")" || second === "）") return false;
    }
    return true;
  });
}

describe("shapeGrammar", () => {
  it("returns the same grammar text every time", () => {
    expect(shapeGrammar({ maxLines: 3 })).toMatchSnapshot();
  });

  it("puts the requested line budget into the repetition", () => {
    expect(shapeGrammar({ maxLines: 3 })).toContain("(nl line){0,2}");
    expect(shapeGrammar({ maxLines: 1 })).toContain("(nl line){0,0}");
    expect(shapeGrammar({ maxLines: GRAMMAR_MAX_LINES })).toContain(
      `(nl line){0,${GRAMMAR_MAX_LINES - 1}}`,
    );
  });

  it("falls back to three lines and clamps the range", () => {
    expect(shapeGrammar()).toContain(`(nl line){0,${GRAMMAR_DEFAULT_LINES - 1}}`);
    expect(shapeGrammar({ maxLines: 0 })).toContain("(nl line){0,0}");
    expect(shapeGrammar({ maxLines: 999 })).toContain(
      `(nl line){0,${GRAMMAR_MAX_LINES - 1}}`,
    );
    expect(shapeGrammar({ maxLines: Number.NaN })).toContain(
      `(nl line){0,${GRAMMAR_DEFAULT_LINES - 1}}`,
    );
  });
});

describe("the shape it is meant to enforce", () => {
  it("accepts three ordinary lines", () => {
    expect(fitsShape("在的呀\n今天好累\n我先睡啦", 3)).toBe(true);
    expect(fitsShape("晚安\n", 3)).toBe(true);
    expect(fitsShape("2 点了 还不睡", 3)).toBe(true);
  });

  it("refuses a fourth line", () => {
    expect(fitsShape("一\n二\n三\n四", 3)).toBe(false);
  });

  it("refuses a line that starts like a list item", () => {
    expect(fitsShape("- 第一件事\n- 第二件事", 3)).toBe(false);
    expect(fitsShape("* 好", 3)).toBe(false);
    expect(fitsShape("# 标题", 3)).toBe(false);
    expect(fitsShape("1. 先这样\n2. 再那样", 3)).toBe(false);
    expect(fitsShape("1、先这样", 3)).toBe(false);
    expect(fitsShape("1）先这样", 3)).toBe(false);
  });

  it("refuses an empty reply and a blank line", () => {
    expect(fitsShape("", 3)).toBe(false);
    expect(fitsShape("在的\n\n好", 3)).toBe(false);
  });
});
