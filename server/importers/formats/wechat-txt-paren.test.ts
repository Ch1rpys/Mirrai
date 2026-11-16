import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseWechatTxtParen } from "./wechat-txt-paren";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/wechat-txt-paren/sample.txt"),
  "utf8",
);

describe("wechat-txt-paren", () => {
  it("reads a header with the body on the next lines and on the same line", async () => {
    const parsed = await parseWechatTxtParen(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records.length).toBeGreaterThanOrEqual(10);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗\n还是说已经睡了",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1]).toMatchObject({ speaker: "阿树", content: "在的呀" });
    expect(parsed.records.find((row) => row.content.includes("他说：先这样"))?.speaker).toBe("小满");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("wechat-txt-paren");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
