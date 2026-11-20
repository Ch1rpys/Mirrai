import { describe, expect, it } from "vitest";
import { queryLexemes, searchTokens, toTsQuery } from "./search-tokens";

describe("search tokens", () => {
  it("cuts a run of Han characters into adjacent pairs", () => {
    expect(searchTokens("喜欢海")).toEqual(["喜欢", "欢海"]);
  });

  it("keeps a single character as itself and lower-cases Latin words", () => {
    expect(searchTokens("OK吗")).toEqual(["ok", "吗"]);
  });

  it("cuts kana and hangul the same way", () => {
    expect(searchTokens("ありがとう")).toEqual([
      "あり",
      "りが",
      "がと",
      "とう",
    ]);
    expect(searchTokens("사랑해")).toEqual(["사랑", "랑해"]);
  });

  it("drops punctuation, spaces, and emoji", () => {
    expect(searchTokens("在吗？😀 OK!")).toEqual(["在吗", "ok"]);
  });

  it("de-duplicates in the order the tokens were first seen", () => {
    expect(searchTokens("哈哈哈哈哈")).toEqual(["哈哈"]);
  });

  it("caps a very long text at 2000 tokens", () => {
    const text = Array.from({ length: 4000 }, (_, index) => `w${index}`).join(" ");
    const tokens = searchTokens(text);
    expect(tokens).toHaveLength(2000);
    expect(tokens[0]).toBe("w0");
    expect(tokens[1999]).toBe("w1999");
  });
});

describe("query lexemes", () => {
  it("are the same tokens the ingestion side stores", () => {
    expect(queryLexemes("喜欢海")).toEqual(["喜欢", "欢海"]);
    expect(queryLexemes("OK吗")).toEqual(["ok", "吗"]);
  });
});

describe("toTsQuery", () => {
  it("quotes every lexeme and joins with the operator", () => {
    expect(toTsQuery(["喜欢", "欢海"], "&")).toBe("'喜欢' & '欢海'");
    expect(toTsQuery(["喜欢", "欢海"], "|")).toBe("'喜欢' | '欢海'");
  });

  it("doubles single quotes and backslashes inside a lexeme", () => {
    expect(toTsQuery(["a'b"], "&")).toBe("'a''b'");
    expect(toTsQuery(["a\\b"], "&")).toBe("'a\\\\b'");
  });

  it("returns nothing for no lexemes", () => {
    expect(toTsQuery([], "&")).toBe("");
    expect(toTsQuery([], "|")).toBe("");
  });
});
