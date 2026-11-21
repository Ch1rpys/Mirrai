// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQuoteDraft,
  readQuoteDraft,
  writeQuoteDraft,
} from "./quote-selection";

/**
 * The lines on their way from the reader to the chat (C8.10).
 *
 * They travel through sessionStorage, so the URL carries only the flag
 * and a long line does not end up in browser history. A malformed entry
 * is dropped rather than half-read.
 */
const lines = [
  { id: 101, role: "user", speaker: "阿树", content: "说好的 周末看电影", timestamp: "2023-05-01T12:00:00.000Z" },
  { id: 102, role: "assistant", speaker: "小满", content: "好啊", timestamp: "2023-05-01T12:01:00.000Z" },
];

describe("the quotation on its way to the chat", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("goes and comes back", () => {
    writeQuoteDraft(5, lines);
    expect(readQuoteDraft(5)).toEqual(lines);
  });

  it("belongs to one persona", () => {
    writeQuoteDraft(5, lines);
    expect(readQuoteDraft(6)).toEqual([]);
  });

  it("is dropped when it is spent", () => {
    writeQuoteDraft(5, lines);
    clearQuoteDraft(5);
    expect(readQuoteDraft(5)).toEqual([]);
  });

  it("never carries more than eight lines", () => {
    writeQuoteDraft(5, Array.from({ length: 12 }, (_, index) => ({
      ...lines[0]!,
      id: 200 + index,
    })));
    expect(readQuoteDraft(5)).toHaveLength(8);
  });

  it("drops an entry that is not a line", () => {
    sessionStorage.setItem("mirrai:quote:5", JSON.stringify([
      { id: 1, content: "ok", role: "user" },
      { content: "no id" },
      "garbage",
    ]));
    expect(readQuoteDraft(5)).toHaveLength(1);
  });
});
