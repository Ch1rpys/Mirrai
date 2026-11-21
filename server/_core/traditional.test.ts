import { describe, expect, it } from "vitest";
import { copy } from "@shared/copy";
// The side-effect import the server's entry point uses at startup: it hands
// OpenCC's simplified → traditional converter to the copy table.
import "./traditional";

/**
 * The server's own words in traditional Chinese.
 *
 * The interface's dictionary is generated (`client/src/i18n/zh-Hant.ts`); the
 * server's words are converted at run time instead, because they are looked up
 * by key and because the simplified → traditional table must not enter the
 * client bundle. This test is the wiring: importing the module the server
 * entry point imports is what registers the converter.
 */
describe("the server's traditional Chinese", () => {
  it("returns a user-facing sentence in traditional characters", () => {
    const simplified = copy("zh", "errors.userNotFound");
    const traditional = copy("zh-Hant", "errors.userNotFound");
    expect(traditional).not.toBe(simplified);
    // 找不到这个用户 → 找不到這個用戶; the same sentence.
    expect(traditional).toBe("找不到這個用戶");
  });

  it("keeps a model instruction in simplified Chinese", () => {
    // The manual is explicit: the prompts stay simplified. The persona's own
    // replies follow the records, not the reader's characters.
    const key = "prompt.emotionalWarm" as const;
    expect(copy("zh-Hant", key)).toBe(copy("zh", key));
  });

  it("converts the sentence and then fills the placeholders", () => {
    expect(copy("zh-Hant", "errors.unknownProvider", { provider: "Foo" })).toBe(
      "未知的 LLM 提供商：Foo",
    );
  });
});
