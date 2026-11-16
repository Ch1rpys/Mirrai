import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseLineTxt } from "./line-txt";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/line-txt/sample.txt"),
  "utf8",
);

describe("line-txt", () => {
  it("joins a date heading with tab-separated time/name/content, including a quoted body", async () => {
    const parsed = await parseLineTxt(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({ speaker: "小满", content: "在吗" });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records.find((row) => row.content.includes("在的呀"))?.content).toBe("在的呀\n还没睡");
    expect(parsed.records.find((row) => row.content === "他说：先这样")).toBeTruthy();
    expect(parsed.records.find((row) => row.content === "早" && row.speaker === "小满")?.timestamp?.toISOString()).toBe(
      "2022-03-02T00:15:00.000Z",
    );
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("line-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
