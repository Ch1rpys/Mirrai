import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseQqTxt } from "./qq-txt";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/qq-txt/sample.txt"),
  "utf8",
);

describe("qq-txt", () => {
  it("skips the QQ banner and reads a header with a one-digit hour", async () => {
    const parsed = await parseQqTxt(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗\n还是说已经睡了",
    });
    expect(parsed.records.find((row) => row.content === "他说：先这样")?.timestamp?.toISOString()).toBe(
      "2022-03-01T00:00:12.000Z",
    );
    expect(parsed.records.some((row) => row.content.includes("消息记录"))).toBe(false);
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("qq-txt");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
