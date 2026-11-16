import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat } from "../detect";
import { importSourceFrom } from "../normalize";
import { parseWechatTxt2Line } from "./wechat-txt-2line";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/wechat-txt-2line/sample.txt"),
  "utf8",
);

describe("wechat-txt-2line", () => {
  it("reads a header, a multiline body, a colon in the content, and a system line", async () => {
    const parsed = await parseWechatTxt2Line(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records.length).toBeGreaterThanOrEqual(10);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗\n还是说已经睡了",
      kind: "text",
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records.find((row) => row.content.includes("他说：先这样"))?.speaker).toBe("小满");
    const recalled = parsed.records.find((row) => row.kind === "recall");
    expect(recalled?.content).toBe("[recall]");
  });

  it("is detected from its sample with confidence of at least 0.6", () => {
    const hits = detectFormat(importSourceFrom("chat.txt", Buffer.from(SAMPLE, "utf8"), SAMPLE));
    expect(hits[0]?.id).toBe("wechat-txt-2line");
    expect(hits[0]?.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
