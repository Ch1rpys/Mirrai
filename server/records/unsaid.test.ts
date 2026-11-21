import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findUnfinished, isTrailingLine } from "./unsaid";
import { buildXiaomanRecords, XIAOMAN_TRUTH } from "../test-fixtures/xiaoman";

/**
 * The unfinished lines (C6.5).
 *
 * The reader is deliberately dumb: it finds what the record says and
 * returns it. Everything that a model writes happens in another module,
 * after the user asks for it.
 */
describe("the lines they started and never finished", () => {
  it("finds the open loop the persona started and never came back to", () => {
    const rows = buildXiaomanRecords();
    const personaData = {
      lifeEvents: [
        {
          id: "open-loop-1",
          kind: "open_loop",
          title: XIAOMAN_TRUTH.openLoopTa,
          detail: XIAOMAN_TRUTH.openLoopTa,
          whoSaid: "them",
          closed: false,
          source: "manual",
          verified: true,
          evidence: [{ snippet: XIAOMAN_TRUTH.openLoopTa }],
        },
        {
          id: "open-loop-2",
          kind: "open_loop",
          title: XIAOMAN_TRUTH.openLoopUser,
          detail: XIAOMAN_TRUTH.openLoopUser,
          whoSaid: "me",
          closed: false,
          source: "manual",
          verified: true,
          evidence: [{ snippet: XIAOMAN_TRUTH.openLoopUser }],
        },
      ],
    };

    const items = findUnfinished(rows, personaData);
    const loop = items.find((item) => item.text === XIAOMAN_TRUTH.openLoopTa);
    expect(loop).toBeTruthy();
    expect(loop!.kind).toBe("open_loop");
    expect(loop!.at).toBeTruthy();
    // The user's own open loop is not the persona's unfinished sentence.
    expect(items.some((item) => item.text === XIAOMAN_TRUTH.openLoopUser)).toBe(false);
  });

  it("finds a line that ends in a brush-off, with the two lines before it", () => {
    const rows = [
      { id: 1, role: "user", content: "周末去看电影吗" },
      { id: 2, role: "assistant", content: "好啊 我看看时间" },
      { id: 3, role: "assistant", content: "算了。" },
    ];

    const items = findUnfinished(rows, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "trailing",
      recordId: 3,
      text: "算了。",
    });
    expect(items[0].context.map((line) => line.recordId)).toEqual([1, 2]);
    expect(items[0].context.map((line) => line.text)).toEqual([
      "周末去看电影吗",
      "好啊 我看看时间",
    ]);
  });

  it("recognises the brush-offs in both languages, and nothing else", () => {
    for (const line of ["算了", "没事。", "以后再说！", "forget it.", "Never mind"]) {
      expect(isTrailingLine(line)).toBe(true);
    }
    for (const line of ["我没事的", "好呀", "算了吧"]) {
      expect(isTrailingLine(line)).toBe(false);
    }
  });

  it("cannot call a model: the reader has no model to call (C6.5)", () => {
    // The finding half is a pure function of the record. The model is
    // only asked later, by `server/chat/unsaid.ts`, once the user
    // presses the button. A scan rather than a mock, because a model
    // imported here would be a model that runs on page load.
    const source = readFileSync(path.resolve(__dirname, "unsaid.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*llm/);
    expect(source).not.toMatch(/\b(llmService|invokeWithProvider|invoke)\s*\(/);
  });

  it("does not repeat a line that is both an open loop and a brush-off", () => {
    const rows = [{ id: 1, role: "assistant", content: "下次再说" }];
    const personaData = {
      lifeEvents: [
        {
          id: "loop",
          kind: "open_loop",
          title: "下次再说",
          detail: "下次再说",
          whoSaid: "them",
          closed: false,
          source: "manual",
          verified: true,
          evidence: [{ snippet: "下次再说" }],
        },
      ],
    };
    const items = findUnfinished(rows, personaData);
    expect(items.filter((item) => item.recordId === 1)).toHaveLength(1);
  });
});
