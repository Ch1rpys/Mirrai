import { describe, expect, it, vi } from "vitest";
import { copy } from "@shared/copy";
import type { OralAccountForExtraction } from "@shared/oral";
import {
  fieldsFromDescribedStatements,
  generateDescribedStatements,
  describedPersonaData,
  buildDescribedMessages,
} from "./described";

const accounts: OralAccountForExtraction[] = [
  { id: 3, tellerName: "阿树", body: "小满生气的时候一句话都不说，过一会儿才开口。小满喜欢海。" },
  { id: 9, tellerName: "琪琪", body: "他讨厌香菜，每次都要挑出来。" },
];

function outsideFence(text: string): string {
  return text.replace(/MATERIAL>>>:([0-9a-f]+)[\s\S]*?<<<END MATERIAL>>>:\1/g, "");
}

describe("generating a persona from descriptions (C1.8)", () => {
  it("keeps only the sentences whose quote is in what was actually said", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([
        {
          field: "personality",
          text: "生气时先沉默，过一会儿才开口。",
          quote: "生气的时候一句话都不说",
        },
        {
          field: "likes",
          text: "讨厌香菜。",
          quote: "讨厌香菜，每次都要挑出来",
        },
        {
          field: "likes",
          text: "喜欢爬山。",
          quote: "喜欢爬山",
        },
      ]),
    );
    const result = await describedPersonaData({
      accounts,
      name: "小满",
      locale: "zh",
      invoke,
    });
    expect(result.readable).toBe(true);
    expect(result.statements).toHaveLength(2);
    expect(result.dropped).toBe(1);
    // Every kept sentence has its words and its source.
    for (const statement of result.statements) {
      expect(statement.source).toBe("described");
      expect(statement.quote.length).toBeGreaterThan(0);
      expect(accounts.some((account) => account.body.includes(statement.quote))).toBe(true);
    }
    // The teller is taken from the account the quote is in, never invented.
    expect(result.statements[0]).toMatchObject({ teller: "阿树", accountId: 3 });
    expect(result.statements[1]).toMatchObject({ teller: "琪琪", accountId: 9 });
    expect(result.personaData?.personality).toContain("生气时先沉默");
    expect(result.personaData?.catchphrases).toEqual([]);
  });

  it("fills the persona's existing fields from the described sentences", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([
        { field: "personality", text: "生气时先沉默。", quote: "生气的时候一句话都不说" },
        { field: "catchphrase", text: "随你吧", quote: "喜欢海" },
        { field: "boundaries", text: "不会说重话。", quote: "过一会儿才开口" },
        { field: "address", text: "琪琪", quote: "他讨厌香菜" },
        { field: "story", text: "一起去过海边。", quote: "小满喜欢海" },
      ]),
    );
    const result = await describedPersonaData({
      accounts,
      name: "小满",
      locale: "zh",
      invoke,
    });
    const fields = fieldsFromDescribedStatements(result.statements, "zh");
    expect(fields.personality).toContain("生气时先沉默");
    expect(fields.personality).toContain("不会说重话");
    expect(fields.catchphrases).toEqual(["随你吧"]);
    expect(fields.nickname).toBe("琪琪");
    expect(fields.memories).toContain("一起去过海边");
  });

  it("writes honest fallbacks instead of an invented voice", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([
        { field: "personality", text: "喜欢海。", quote: "小满喜欢海" },
      ]),
    );
    const result = await describedPersonaData({
      accounts,
      name: "小满",
      locale: "zh",
      invoke,
    });
    expect(result.personaData?.speakingStyle).toBe(
      copy("zh", "labels.persona.describedSpeakingStyle"),
    );
    // The usual fallback invents catchphrases ("嗯嗯、好呀、哈哈"); this
    // persona has none, and says so by having none.
    expect(result.personaData?.catchphrases).toEqual([]);
    // And the described sentences are stored on the persona.
    expect(result.personaData?.described).toHaveLength(1);
    expect(result.personaData?.described?.[0]?.source).toBe("described");
  });

  it("says the answer was unreadable rather than that nothing was described", async () => {
    const invoke = vi.fn(async () => "这不是 JSON");
    const result = await describedPersonaData({
      accounts,
      name: "小满",
      locale: "zh",
      invoke,
    });
    expect(result.readable).toBe(false);
    expect(result.statements).toEqual([]);
    expect(result.personaData).toBeUndefined();
  });

  it("does not call the model when there is nothing to describe", async () => {
    const invoke = vi.fn();
    const result = await generateDescribedStatements({
      accounts: [],
      name: "小满",
      locale: "zh",
      invoke,
    });
    expect(result.readable).toBe(true);
    expect(result.statements).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fences the accounts as material, with the instruction outside", () => {
    const messages = buildDescribedMessages({ accounts, name: "小满", locale: "zh" });
    const user = String(messages[1]?.content ?? "");
    expect(user).toContain("他讨厌香菜");
    expect(outsideFence(user)).not.toContain("他讨厌香菜");
    expect(outsideFence(user)).not.toContain("小满喜欢海");
    // The instruction is the app's own words, not the accounts'.
    expect(String(messages[0]?.content)).toContain("JSON 数组");
    expect(String(messages[0]?.content)).not.toContain("他讨厌香菜");
  });

  it("accepts an answer wrapped in an object", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify({
        statements: [{ field: "likes", text: "讨厌香菜。", quote: "讨厌香菜" }],
      }),
    );
    const result = await generateDescribedStatements({
      accounts,
      name: "小满",
      locale: "zh",
      invoke,
    });
    expect(result.readable).toBe(true);
    expect(result.statements).toHaveLength(1);
  });
});
