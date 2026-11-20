import { describe, expect, it } from "vitest";
import {
  ORAL_MAX_STATEMENTS,
  normalizeOralKey,
  oralClaimKey,
  parseOralStatements,
} from "./oral";

const accounts = [
  { id: 3, tellerName: "阿树", body: "小满讨厌香菜，每次点外卖都要备注。他喜欢海，说以后要住在海边。" },
  { id: 9, tellerName: "琪琪", body: "他打游戏输了会摔鼠标，然后自己去阳台抽一根。" },
];

describe("the key two tellers meet on (C7.4)", () => {
  it("normalises spacing and case", () => {
    expect(normalizeOralKey("Favorite Food")).toBe("favorite_food");
    expect(normalizeOralKey(" favorite-food ")).toBe("favorite_food");
  });

  it("rejects a key that is not an identifier", () => {
    expect(normalizeOralKey("喜欢海")).toBeNull();
    expect(normalizeOralKey("")).toBeNull();
    expect(normalizeOralKey("9lives")).toBeNull();
    expect(normalizeOralKey(undefined)).toBeNull();
  });
});

describe("reading what the model said (C7.4)", () => {
  it("keeps a statement whose quote is really in an account, and takes the teller from the account", () => {
    const parsed = parseOralStatements(
      [
        { kind: "habit", key: "smoking", text: "输了游戏会去阳台抽烟。", quote: "然后自己去阳台抽一根" },
      ],
      accounts,
    );
    expect(parsed.dropped).toBe(0);
    expect(parsed.statements).toEqual([
      {
        kind: "habit",
        key: "smoking",
        text: "输了游戏会去阳台抽烟。",
        quote: "然后自己去阳台抽一根",
        accountId: 9,
        tellerName: "琪琪",
      },
    ]);
  });

  it("drops a quote that is not a substring of any account", () => {
    const parsed = parseOralStatements(
      [
        {
          kind: "fact",
          key: "birthday",
          text: "他的生日是 5 月 21 日。",
          // The model knows this from somewhere else — it is not in the
          // account, so it is not kept.
          quote: "我生日是5月21号",
        },
      ],
      accounts,
    );
    expect(parsed.statements).toEqual([]);
    expect(parsed.dropped).toBe(1);
  });

  it("drops an unknown kind, an unusable key, and an empty text", () => {
    const parsed = parseOralStatements(
      [
        { kind: "guess", key: "x", text: "有。", quote: "小满讨厌香菜" },
        { kind: "fact", key: "喜欢海", text: "有。", quote: "小满讨厌香菜" },
        { kind: "fact", key: "ok", text: "", quote: "小满讨厌香菜" },
      ],
      accounts,
    );
    expect(parsed.statements).toEqual([]);
    expect(parsed.dropped).toBe(3);
  });

  it("collapses the same statement said twice in one answer", () => {
    const parsed = parseOralStatements(
      [
        { kind: "trait", key: "hates_coriander", text: "讨厌香菜。", quote: "讨厌香菜" },
        { kind: "trait", key: "hates_coriander", text: "讨厌香菜。", quote: "讨厌香菜" },
      ],
      accounts,
    );
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.dropped).toBe(1);
  });

  it("keeps the same key with different words — that is a disagreement", () => {
    const parsed = parseOralStatements(
      [
        { kind: "trait", key: "hates_coriander", text: "讨厌香菜。", quote: "讨厌香菜" },
        { kind: "trait", key: "hates_coriander", text: "爱吃香菜。", quote: "每次点外卖都要备注" },
      ],
      accounts,
    );
    expect(parsed.statements).toHaveLength(2);
  });

  it("cuts the answer off at the cap and says how much was dropped", () => {
    const many = Array.from({ length: ORAL_MAX_STATEMENTS + 3 }, (_, index) => ({
      kind: "trait",
      key: `trait_${index}`,
      text: `第 ${index} 条。`,
      quote: "小满讨厌香菜",
    }));
    const parsed = parseOralStatements(many, accounts);
    expect(parsed.statements).toHaveLength(ORAL_MAX_STATEMENTS);
    expect(parsed.dropped).toBe(3);
  });

  it("reads nothing out of a non-array answer", () => {
    expect(parseOralStatements({ statements: [] }, accounts)).toEqual({
      statements: [],
      dropped: 0,
    });
    expect(parseOralStatements(null, accounts)).toEqual({ statements: [], dropped: 0 });
  });

  it("treats the same claim as the same claim across runs", () => {
    expect(oralClaimKey("Hates_Coriander", "讨厌 香菜。")).toBe(
      oralClaimKey("hates_coriander", "讨厌  香菜。"),
    );
    expect(oralClaimKey("hates_coriander", "讨厌香菜。")).not.toBe(
      oralClaimKey("hates_coriander", "爱吃香菜。"),
    );
  });
});
