import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseDiscordJson } from "./discord-json";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/discord-json/sample.json"),
  "utf8",
);

describe("discord-json", () => {
  it("reads author.name, ISO timestamps, stickers, and attachments", async () => {
    const parsed = await parseDiscordJson(SAMPLE);
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1].content).toBe("在的呀\n还没睡");
    expect(parsed.records.find((row) => row.kind === "sticker")?.content).toBe("[sticker:dog]");
    expect(parsed.records.find((row) => row.kind === "image")?.meta).toEqual({ path: "photo.jpg" });
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("channel.json", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("discord-json");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
