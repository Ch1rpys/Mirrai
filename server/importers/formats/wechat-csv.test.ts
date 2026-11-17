import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { buildXiaomanRecords } from "../../test-fixtures/xiaoman";
import { renderFixture } from "../../test-fixtures/render";
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
    expect(parsed.records.find((row) => row.kind === "image")).toMatchObject({
      fromMe: false,
      content: "[image]",
    });
    expect(parsed.records.find((row) => row.kind === "sticker")).toMatchObject({
      fromMe: true,
      content: "[sticker]",
    });
    expect(parsed.records.find((row) => row.kind === "voice")).toMatchObject({
      content: "[voice:12]",
      meta: expect.objectContaining({ durationSec: 12 }),
    });
    expect(parsed.records.find((row) => row.kind === "recall")?.content).toBe("[recall]");
    expect(parsed.records.find((row) => row.kind === "pat")?.content).toBe("[pat]");
    expect(parsed.records.find((row) => row.kind === "link")?.content).toContain("example.com");
    expect(parsed.records.find((row) => row.kind === "call")).toMatchObject({
      content: "[call:voice:2592]",
      meta: expect.objectContaining({ mode: "voice", durationSec: 2592 }),
    });
  });

  it("keeps fixture stickers, voice notes, and calls through a round trip", async () => {
    const original = buildXiaomanRecords().filter(
      (row) => row.kind === "sticker" || row.kind === "voice" || row.kind === "call",
    );
    const text = renderFixture(buildXiaomanRecords(), "wechat-csv");
    const parsed = await parseWechatCsv(text, { timeZone: "Asia/Shanghai" });
    const got = parsed.records.filter(
      (row) => row.kind === "sticker" || row.kind === "voice" || row.kind === "call",
    );
    expect(got).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(got[i]?.kind, `${original[i]?.kind} ${i}`).toBe(original[i]?.kind);
      expect(got[i]?.content, `${original[i]?.kind} ${i}`).toBe(original[i]?.content);
      expect(got[i]?.meta, `${original[i]?.kind} ${i}`).toEqual(original[i]?.meta);
    }
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.csv", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("wechat-csv");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
