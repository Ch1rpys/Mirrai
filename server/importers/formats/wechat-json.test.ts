import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseWechatJson } from "./wechat-json";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/wechat-json/sample.json"),
  "utf8",
);

describe("wechat-json", () => {
  it("reads sender/content/time under the field names the collectors already knew", async () => {
    const parsed = await parseWechatJson(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records.length).toBe(12);
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
    expect(parsed.records[1]).toMatchObject({ speaker: "阿树", content: "在的呀\n还没睡" });
    expect(parsed.records[2].speaker).toBe("小满");
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.json", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("wechat-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
