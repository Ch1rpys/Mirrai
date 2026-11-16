import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseWechatCsv } from "./wechat-csv";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/wechat-csv/sample.csv"),
  "utf8",
);

describe("wechat-csv", () => {
  it("reads IsSender, a quoted multiline body, and native types", async () => {
    const parsed = await parseWechatCsv(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      fromMe: false,
      content: "在吗",
      kind: "text",
    });
    expect(parsed.records[1]).toMatchObject({
      speaker: "阿树",
      fromMe: true,
      content: "在的呀\n还没睡",
    });
    expect(parsed.records.find((row) => row.kind === "image")?.fromMe).toBe(false);
    expect(parsed.records.find((row) => row.kind === "sticker")?.fromMe).toBe(true);
    expect(parsed.records.find((row) => row.kind === "voice")).toBeTruthy();
    expect(parsed.records.find((row) => row.kind === "recall")).toBeTruthy();
    expect(parsed.records.find((row) => row.kind === "pat")).toBeTruthy();
    expect(parsed.records.find((row) => row.kind === "link")?.content).toContain("example.com");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.csv", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("wechat-csv");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
