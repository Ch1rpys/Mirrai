import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseTelegramJson } from "./telegram-json";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/telegram-json/sample.json"),
  "utf8",
);

describe("telegram-json", () => {
  it("reads string text, entity arrays, stickers, and a phone call", async () => {
    const parsed = await parseTelegramJson(SAMPLE);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗",
      kind: "text",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1].content).toBe("在的呀\n还没睡");
    expect(parsed.records[2].content).toBe("他说：先这样");
    expect(parsed.records.find((row) => row.kind === "sticker")?.content).toBe("[sticker:🐶]");
    expect(parsed.records.find((row) => row.kind === "voice")?.content).toBe("[voice:12]");
    expect(parsed.records.find((row) => row.kind === "image")?.meta).toEqual({ path: "photos/photo.jpg" });
    expect(parsed.records.find((row) => row.kind === "call")?.content).toBe("[call:voice:43]");
  });

  it("lists chats on a full takeout and keeps one when chatId is set", async () => {
    const takeout = JSON.stringify({
      chats: {
        list: [
          { id: 1, name: "小满", messages: [{ id: 1, type: "message", from: "小满", from_id: "user111", date_unixtime: "1646136000", text: "在吗" }] },
          { id: 2, name: "群", messages: [{ id: 2, type: "message", from: "阿树", from_id: "user222", date_unixtime: "1646136005", text: "大家好" }] },
        ],
      },
    });
    const listed = await parseTelegramJson(takeout);
    expect(listed.chats).toEqual([
      { id: "1", title: "小满", count: 1 },
      { id: "2", title: "群", count: 1 },
    ]);
    const one = await parseTelegramJson(takeout, { chatId: "2" });
    expect(one.records).toHaveLength(1);
    expect(one.records[0]?.content).toBe("大家好");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("result.json", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("telegram-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
