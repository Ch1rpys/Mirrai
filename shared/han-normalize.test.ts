import { describe, expect, it } from "vitest";
import { toSimplified } from "./han-normalize";

describe("toSimplified", () => {
  it("leaves simplified text as it is", () => {
    expect(toSimplified("我想自杀")).toBe("我想自杀");
    expect(toSimplified("难过 伤心 哭 委屈 不开心")).toBe(
      "难过 伤心 哭 委屈 不开心",
    );
  });

  it("converts traditional text to simplified", () => {
    expect(toSimplified("我想自殺")).toBe("我想自杀");
    expect(toSimplified("結束生命")).toBe("结束生命");
    expect(toSimplified("難過")).toBe("难过");
    expect(toSimplified("隨便，無所謂")).toBe("随便，无所谓");
  });

  it("converts a mixed sentence, leaving the Latin words alone", () => {
    expect(toSimplified("I miss you，我真的好難過")).toBe("I miss you，我真的好难过");
    expect(toSimplified("週末去公園 ok")).toBe("周末去公园 ok");
  });

  it("returns an empty string for empty input", () => {
    expect(toSimplified("")).toBe("");
  });

  it("does not change English or punctuation", () => {
    const text = "I don't want to live. 真的吗？";
    expect(toSimplified(text)).toBe(text);
  });

  it("folds the spellings the table leaves behind", () => {
    // 著 is correct in simplified Chinese too, so OpenCC keeps it — but the
    // crisis vocabulary is written with 着, and 「活著」 is the same word.
    expect(toSimplified("活著沒意義")).toBe("活着没意义");
    expect(toSimplified("我活著好累")).toBe("我活着好累");
    // The words where 著 is the ordinary spelling are left alone.
    expect(toSimplified("著名作家")).toBe("著名作家");
    expect(toSimplified("著作")).toBe("著作");
  });

  it("is idempotent", () => {
    const once = toSimplified("結束自己的生命，撐不下去了，我活著沒意義");
    expect(toSimplified(once)).toBe(once);
  });
});
