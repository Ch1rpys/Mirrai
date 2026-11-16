import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseColumnMap } from "./column-map";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/column-map/sample.csv"),
  "utf8",
);

describe("column-map", () => {
  it("guesses Time/Speaker/Content and keeps a quoted newline", async () => {
    const parsed = await parseColumnMap(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1].content).toBe("在的呀\n还没睡");
    expect(parsed.records.find((row) => row.content === "他说：先这样")).toBeTruthy();
  });

  it("uses an explicit column map, including fromMe", async () => {
    const text = ["a,b,c,d", "阿树,好,1,2022-03-01 20:00:20"].join("\n");
    const parsed = await parseColumnMap(text, {
      timeZone: "Asia/Shanghai",
      columnMap: { speaker: 0, content: 1, fromMe: 2, fromMeTrue: "1", time: 3 },
    });
    expect(parsed.records[0]).toMatchObject({ speaker: "阿树", content: "好", fromMe: true });
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.csv", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("column-map");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
