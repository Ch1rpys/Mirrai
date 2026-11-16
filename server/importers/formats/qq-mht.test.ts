import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseQqMht } from "./qq-mht";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/qq-mht/sample.mht"),
  "utf8",
);

describe("qq-mht", () => {
  it("unpacks the HTML part and reads 昵称(QQ号) headers", async () => {
    const parsed = await parseQqMht(SAMPLE, { timeZone: "Asia/Shanghai" });
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
    const hits = detectFormat(importSourceFrom("chat.mht", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("qq-mht");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
