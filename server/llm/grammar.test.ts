import { describe, expect, it } from "vitest";
import {
  GRAMMAR_DEFAULT_LINES,
  GRAMMAR_MAX_LINES,
  shapeGrammar,
} from "./grammar";

/**
 * The shape checker written a second way.
 *
 * This is the *intent* — which strings the grammar is meant to accept and
 * which it is meant to refuse. It is a hand-written statement of intent, not
 * a reading of the produced GBNF; the assertions in "the grammar the decoder
 * receives" below read the actual `shapeGrammar` output with the small GBNF
 * interpreter further down and are what pin the implementation (B9.3).
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

/**
 * A small interpreter for the GBNF subset `shapeGrammar` emits.
 *
 * It exists so the test can match strings against the text a constrained
 * decoder would actually receive, instead of against another hand-written
 * shape checker. Supported: `name ::= body` rules, `|` alternatives, quoted
 * literals, character classes (including negated `[^...]` and ranges), rule
 * references, groups, and the repetition operators `? * + {m,n}`. The logic
 * is ported from the independent verifier's `gbnf_cfg.py`; nothing in it
 * comes from the implementation under test.
 */
type GbnfNode =
  | { kind: "alts"; alts: GbnfNode[] }
  | { kind: "seq"; items: GbnfNode[] }
  | { kind: "literal"; text: string }
  | { kind: "class"; negated: boolean; chars: Set<string> }
  | { kind: "ref"; name: string }
  | { kind: "repeat"; inner: GbnfNode; min: number; max: number | null };

type GbnfToken =
  | { kind: "def" | "alt" | "open" | "close" }
  | { kind: "literal"; text: string }
  | { kind: "class"; negated: boolean; chars: Set<string> }
  | { kind: "repeat"; min: number; max: number | null }
  | { kind: "name"; name: string };

const GBNF_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  '"': '"',
  "\\": "\\",
  "-": "-",
  "]": "]",
};

function gbnfEscape(next: string): string {
  const decoded = GBNF_ESCAPES[next];
  if (decoded === undefined)
    throw new Error(`unsupported GBNF escape \\${next}`);
  return decoded;
}

function tokenizeGbnf(text: string): GbnfToken[] {
  // Comment lines start with `#`; they are not part of the grammar.
  const source = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const tokens: GbnfToken[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (source.startsWith("::=", i)) {
      tokens.push({ kind: "def" });
      i += 3;
      continue;
    }
    if (c === "|") {
      tokens.push({ kind: "alt" });
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "open" });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "close" });
      i += 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let literal = "";
      while (j < source.length && source[j] !== '"') {
        if (source[j] === "\\") {
          literal += gbnfEscape(source[j + 1]);
          j += 2;
        } else {
          literal += source[j];
          j += 1;
        }
      }
      if (source[j] !== '"')
        throw new Error(`unterminated GBNF literal at ${i}`);
      tokens.push({ kind: "literal", text: literal });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      let j = i + 1;
      const negated = source[j] === "^";
      if (negated) j += 1;
      const chars = new Set<string>();
      while (j < source.length && source[j] !== "]") {
        if (source[j] === "\\") {
          chars.add(gbnfEscape(source[j + 1]));
          j += 2;
          continue;
        }
        // A `-` between two characters is a range; one before `]` is a
        // literal hyphen.
        if (
          j + 2 < source.length &&
          source[j + 1] === "-" &&
          source[j + 2] !== "]"
        ) {
          const from = source.charCodeAt(j);
          const to = source.charCodeAt(j + 2);
          for (let code = from; code <= to; code += 1) {
            chars.add(String.fromCharCode(code));
          }
          j += 3;
          continue;
        }
        chars.add(source[j]);
        j += 1;
      }
      if (source[j] !== "]")
        throw new Error(`unterminated GBNF character class at ${i}`);
      tokens.push({ kind: "class", negated, chars });
      i = j + 1;
      continue;
    }
    if (c === "*" || c === "+" || c === "?") {
      tokens.push({
        kind: "repeat",
        min: c === "+" ? 1 : 0,
        max: c === "?" ? 1 : null,
      });
      i += 1;
      continue;
    }
    if (c === "{") {
      const end = source.indexOf("}", i);
      if (end < 0) throw new Error(`unterminated GBNF repetition at ${i}`);
      const body = source.slice(i + 1, end);
      const [minText, maxText] = body.includes(",")
        ? body.split(",", 2)
        : [body, body];
      tokens.push({
        kind: "repeat",
        min: minText === "" ? 0 : Number(minText),
        max: maxText === "" ? null : Number(maxText),
      });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      tokens.push({ kind: "name", name: source.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected GBNF character ${JSON.stringify(c)} at ${i}`);
  }
  return tokens;
}

class GbnfParser {
  private pos = 0;

  constructor(private readonly tokens: GbnfToken[]) {}

  parseRules(): Map<string, GbnfNode> {
    const rules = new Map<string, GbnfNode>();
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.kind !== "name") {
        throw new Error(`expected a rule name, got ${token.kind}`);
      }
      this.pos += 1;
      if (this.tokens[this.pos]?.kind !== "def") {
        throw new Error(`expected ::= after rule ${token.name}`);
      }
      this.pos += 1;
      rules.set(token.name, this.parseAlternatives());
    }
    return rules;
  }

  private parseAlternatives(): GbnfNode {
    const alts = [this.parseSequence()];
    while (this.tokens[this.pos]?.kind === "alt") {
      this.pos += 1;
      alts.push(this.parseSequence());
    }
    return { kind: "alts", alts };
  }

  private parseSequence(): GbnfNode {
    const items: GbnfNode[] = [];
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.kind === "alt" || token.kind === "close") break;
      // A name followed by ::= starts the next rule, not a reference here.
      if (token.kind === "name" && this.tokens[this.pos + 1]?.kind === "def")
        break;
      items.push(this.parseItem());
    }
    return { kind: "seq", items };
  }

  private parseItem(): GbnfNode {
    const token = this.tokens[this.pos];
    let node: GbnfNode;
    if (token.kind === "open") {
      this.pos += 1;
      node = this.parseAlternatives();
      if (this.tokens[this.pos]?.kind !== "close")
        throw new Error("expected )");
      this.pos += 1;
    } else if (token.kind === "name") {
      this.pos += 1;
      node = { kind: "ref", name: token.name };
    } else if (token.kind === "literal") {
      this.pos += 1;
      node = { kind: "literal", text: token.text };
    } else if (token.kind === "class") {
      this.pos += 1;
      node = { kind: "class", negated: token.negated, chars: token.chars };
    } else {
      throw new Error(`unexpected ${token.kind} in a rule body`);
    }
    const repetition = this.tokens[this.pos];
    if (repetition?.kind === "repeat") {
      this.pos += 1;
      node = {
        kind: "repeat",
        inner: node,
        min: repetition.min,
        max: repetition.max,
      };
    }
    return node;
  }
}

function sameSet(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function parseGbnf(text: string): Map<string, GbnfNode> {
  return new GbnfParser(tokenizeGbnf(text)).parseRules();
}

/** Whether `rules` accepts `text` as a whole. */
function acceptsGbnf(rules: Map<string, GbnfNode>, text: string): boolean {
  const root = rules.get("root");
  if (!root) throw new Error('the grammar has no "root" rule');
  const memo = new Map<string, Set<number>>();
  const nodeIds = new Map<GbnfNode, number>();
  let nextNodeId = 0;
  const idOf = (node: GbnfNode): number => {
    let id = nodeIds.get(node);
    if (id === undefined) {
      id = nextNodeId;
      nextNodeId += 1;
      nodeIds.set(node, id);
    }
    return id;
  };
  const match = (node: GbnfNode, pos: number): Set<number> => {
    const key = `${idOf(node)}:${pos}`;
    const cached = memo.get(key);
    if (cached) return cached;
    // Guard against rule cycles that would otherwise recurse forever.
    const result = new Set<number>();
    memo.set(key, result);
    switch (node.kind) {
      case "alts":
        for (const alt of node.alts) {
          for (const end of match(alt, pos)) result.add(end);
        }
        break;
      case "seq": {
        let positions = new Set([pos]);
        for (const item of node.items) {
          const next = new Set<number>();
          for (const p of positions) {
            for (const end of match(item, p)) next.add(end);
          }
          positions = next;
          if (positions.size === 0) break;
        }
        for (const end of positions) result.add(end);
        break;
      }
      case "literal":
        if (text.startsWith(node.text, pos)) result.add(pos + node.text.length);
        break;
      case "class":
        if (pos < text.length) {
          const inside = node.chars.has(text[pos]!);
          if (inside !== node.negated) result.add(pos + 1);
        }
        break;
      case "ref": {
        const target = rules.get(node.name);
        if (!target) throw new Error(`unknown GBNF rule ${node.name}`);
        for (const end of match(target, pos)) result.add(end);
        break;
      }
      case "repeat": {
        let frontier = new Set([pos]);
        if (node.min === 0) result.add(pos);
        let repetitions = 0;
        for (;;) {
          if (node.max !== null && repetitions >= node.max) break;
          const next = new Set<number>();
          for (const p of frontier) {
            for (const end of match(node.inner, p)) next.add(end);
          }
          repetitions += 1;
          if (repetitions >= node.min) {
            for (const end of next) result.add(end);
          }
          if (next.size === 0 || sameSet(next, frontier)) break;
          frontier = next;
        }
        break;
      }
    }
    return result;
  };
  return match(root, 0).has(text.length);
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
    expect(shapeGrammar()).toContain(
      `(nl line){0,${GRAMMAR_DEFAULT_LINES - 1}}`,
    );
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
   * These assertions do not compare rule text with an expected list: they
   * parse the real `shapeGrammar` output with the interpreter above and
   * check which strings that grammar accepts. That is the artefact
   * llama.cpp's decoder is handed, so the acceptance language is what pins
   * the implementation (B9.3).
   */
  const grammar = shapeGrammar({ maxLines: 3 });
  const rules = parseGbnf(grammar);

  it("is parsed from the produced text, including its digits rule", () => {
    expect(rules.has("root")).toBe(true);
    expect(rules.has("digits")).toBe(true);
    expect(grammar).toContain("digits ::=");
  });

  it("refuses a line that starts like a list item", () => {
    // Multi-digit markers are the B9.3 defect: while `spacer` accepted
    // digits, "12. " could be split into digits "1" + spacer "2" + rest
    // ". " and every multi-digit list marker got through.
    for (const text of [
      "12. 第一点",
      "10、第一点",
      "10）第一点",
      "123、第一点",
      "2024. 新年",
      "1. 第一点",
      "1、先这样",
      "1）先这样",
      "- 列表",
      "* 列表",
      "# 标题",
    ]) {
      expect(acceptsGbnf(rules, text)).toBe(false);
    }
  });

  it("refuses a fourth line when the budget is three", () => {
    expect(acceptsGbnf(rules, "一\n二\n三")).toBe(true);
    expect(acceptsGbnf(rules, "一\n二\n三\n四")).toBe(false);
  });

  it("accepts ordinary replies, including ones that start with a number", () => {
    for (const text of [
      "12",
      "3点见",
      "2024年见的",
      "2 点了 还不睡",
      "在的呀\n今天好累\n我先睡啦",
      "晚安\n",
    ]) {
      expect(acceptsGbnf(rules, text)).toBe(true);
    }
  });

  it("still refuses an empty reply and an empty line", () => {
    expect(acceptsGbnf(rules, "")).toBe(false);
    expect(acceptsGbnf(rules, "在的\n\n好")).toBe(false);
  });

  it("enforces the line budget it puts into the text", () => {
    const lines = [
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "七",
      "八",
      "九",
      "十",
      "十一",
    ];
    for (const maxLines of [1, 3, GRAMMAR_MAX_LINES]) {
      const budget = parseGbnf(shapeGrammar({ maxLines }));
      expect(acceptsGbnf(budget, lines.slice(0, maxLines).join("\n"))).toBe(
        true,
      );
      expect(acceptsGbnf(budget, lines.slice(0, maxLines + 1).join("\n"))).toBe(
        false,
      );
    }
  });

  it("enforces the clamped budget for 0, NaN and 999", () => {
    const clampedLow = parseGbnf(shapeGrammar({ maxLines: 0 }));
    expect(acceptsGbnf(clampedLow, "一")).toBe(true);
    expect(acceptsGbnf(clampedLow, "一\n二")).toBe(false);

    const fallback = parseGbnf(shapeGrammar({ maxLines: Number.NaN }));
    expect(acceptsGbnf(fallback, "一\n二\n三")).toBe(true);
    expect(acceptsGbnf(fallback, "一\n二\n三\n四")).toBe(false);

    const clampedHigh = parseGbnf(shapeGrammar({ maxLines: 999 }));
    const ten = "一\n二\n三\n四\n五\n六\n七\n八\n九\n十";
    expect(acceptsGbnf(clampedHigh, ten)).toBe(true);
    expect(acceptsGbnf(clampedHigh, `${ten}\n十一`)).toBe(false);
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
