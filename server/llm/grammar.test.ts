import { describe, expect, it } from "vitest";
import { GRAMMAR_DEFAULT_LINES, GRAMMAR_MAX_LINES, shapeGrammar } from "./grammar";

/**
 * The shape checker written a second way.
 *
 * This is the *intent* — which strings the grammar is meant to accept and
 * which it is meant to refuse. It is not coupled to the implementation:
 * the old, too-narrow grammar satisfied it too, because it was a second
 * hand-written checker rather than a reading of the produced GBNF. The
 * assertions in "the grammar the decoder receives" below read the actual
 * `shapeGrammar` output and are what pin the implementation (B9.3).
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
    // A list item can start with any number of digits, not only one
    // (B9.3): "12. " and "10、" are the same shape as "2. ".
    if (/^\d+[.、)）]/.test(line)) return false;
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

describe("the grammar the decoder receives (B9.3)", () => {
  /**
   * GBNF as it is produced: one rule per line, `name ::= body`.
   *
   * The old test only exercised `fitsShape`, a second hand-written
   * checker — the old grammar (`digit ::= [0-9]` and a `safe` rule that
   * looked at the character after the first digit) satisfied it, so the
   * only thing pinning the fix was the snapshot. These assertions read
   * the text llama.cpp would actually receive.
   */
  function rulesOf(text: string): Map<string, string> {
    const rules = new Map<string, string>();
    for (const line of text.split("\n")) {
      const match = /^([a-z_]+)\s*::=\s*(.+)$/.exec(line);
      if (match) rules.set(match[1]!, match[2]!);
    }
    return rules;
  }

  const grammar = shapeGrammar({ maxLines: 3 });
  const rules = rulesOf(grammar);

  it("lets a number be any run of digits, not one character", () => {
    const digits = rules.get("digits") ?? "";
    expect(digits).toBeTruthy();
    // `[0-9]+`: a run, not the old single-character `[0-9]`.
    expect(digits).toMatch(/^\[0-9\]\+$/);
    expect(rules.has("digit")).toBe(false);
    expect(grammar).not.toContain("digit ::= [0-9]");
  });

  it("rejects a bullet mark after the digits, including 、 ) ）", () => {
    const spacer = rules.get("spacer") ?? "";
    expect(spacer).toBeTruthy();
    // A negated character class, so the *second* character after the
    // digits cannot be `、`, `)` or `）` — nor `.` (the list marker).
    expect(spacer).toMatch(/^\[\^/);
    for (const mark of [".", "、", ")", "）"]) {
      expect(spacer).toContain(mark);
    }
    const line = rules.get("line") ?? "";
    // Digits are only accepted as a line through `digits spacer rest`,
    // so "12. " cannot be read as digits + rest.
    expect(line).toContain("digits spacer rest");
    expect(line.split("|").map((part) => part.trim())).toEqual([
      "plain rest",
      "digits",
      "digits spacer rest",
    ]);
    expect(rules.has("safe")).toBe(false);
    expect(grammar).not.toContain("safe ::=");
  });

  it("does not contain the old too-narrow line rule", () => {
    expect(grammar).not.toContain("line ::= plain rest | digit | digit safe rest");
    expect(rules.get("line")).not.toContain("digit safe rest");
    expect(rules.get("line")).not.toMatch(/\bdigit\b/);
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
    // Multi-digit list markers are the same shape; the checker only
    // looked at the second character, so these got through (B9.3).
    expect(fitsShape("12. 先这样\n13. 再那样", 3)).toBe(false);
    expect(fitsShape("10、先这样", 3)).toBe(false);
    expect(fitsShape("10）先这样", 3)).toBe(false);
    // Numbers that are not a list marker are still fine.
    expect(fitsShape("2024 年的第一场雪", 3)).toBe(true);
  });

  it("refuses an empty reply and a blank line", () => {
    expect(fitsShape("", 3)).toBe(false);
    expect(fitsShape("在的\n\n好", 3)).toBe(false);
  });
});
