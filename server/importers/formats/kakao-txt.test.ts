import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseKakaoTxt } from "./kakao-txt";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/kakao-txt/sample.txt"),
  "utf8",
);

describe("kakao-txt", () => {
  it("reads the mobile comma line, a PC bracket line, and a continuation", async () => {
    const parsed = await parseKakaoTxt(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗\n还是说已经睡了",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records.find((row) => row.content === "他说：先这样")).toBeTruthy();
    expect(parsed.records.find((row) => row.content === "早" && row.speaker === "小满")?.timestamp?.toISOString()).toBe(
      "2022-03-02T00:15:00.000Z",
    );
  });

  it("reads a Mac CSV with Date,User,Message", async () => {
    const csv = ["Date,User,Message", "2022-03-01 20:00:00,小满,在吗", "2022-03-01 20:00:05,阿树,在的呀"].join("\n");
    const parsed = await parseKakaoTxt(csv, { timeZone: "Asia/Shanghai" });
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("kakao-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
