import { describe, expect, it } from "vitest";
import { renderFixture, type FixtureFormat } from "../test-fixtures/render";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { importerById } from "./registry";
import type { ImportFormatId } from "./types";
import { importSourceFrom } from "./normalize";

const records = buildXiaomanRecords();

function sameSecond(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);
}

function sameMinute(a: Date | null, b: Date): boolean {
  if (!a) return false;
  return Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
}

const TEXT_FORMATS: Array<{ id: ImportFormatId & FixtureFormat; time: "second" | "minute" }> = [
  { id: "generic-line", time: "second" },
  { id: "wechat-txt-2line", time: "second" },
  { id: "wechat-txt-paren", time: "second" },
  { id: "wechat-csv", time: "second" },
  { id: "wechat-json", time: "second" },
  { id: "qq-txt", time: "second" },
  { id: "qq-mht", time: "second" },
  { id: "telegram-json", time: "second" },
  { id: "whatsapp-txt", time: "second" },
  { id: "line-txt", time: "minute" },
  { id: "kakao-txt", time: "minute" },
  { id: "meta-json", time: "second" },
  { id: "discord-json", time: "second" },
];

describe("importer roundtrip", () => {
  it.each(TEXT_FORMATS)("$id parses back the Xiaoman log it rendered", async ({ id, time }) => {
    const original = records.filter((row) => row.kind === "text" && row.content.trim());
    const rendered = renderFixture(original, id);
    const importer = importerById(id);
    expect(importer).toBeDefined();
    const parsed = await importer!.parse(
      importSourceFrom(`xiaoman.${id}.txt`, Buffer.from(rendered, "utf8"), rendered),
      { timeZone: "Asia/Shanghai" },
    );
    expect(parsed.records.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(parsed.records[i]?.speaker, `${id} speaker ${i}`).toBe(original[i]!.speaker);
      expect(parsed.records[i]?.content, `${id} content ${i}`).toBe(original[i]!.content.trim());
      expect(parsed.records[i]?.kind, `${id} kind ${i}`).toBe("text");
      const sameTime = time === "minute" ? sameMinute : sameSecond;
      expect(sameTime(parsed.records[i]?.timestamp ?? null, original[i]!.timestamp)).toBe(true);
    }
  });
});
