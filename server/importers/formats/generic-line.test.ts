import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGenericLine } from "./generic-line";

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, "../../test-fixtures/exports/generic-line/sample.txt"),
  "utf8",
);

describe("parseGenericLine", () => {
  it("reads a bracketed timestamp, a speaker, and a continuation line", async () => {
    const text = [
      "[2022-03-01 20:00:00] 小满：在吗",
      "还是说已经睡了",
      "[2022-03-01 20:00:05] 阿树：在的",
    ].join("\n");
    const parsed = await parseGenericLine(text, { timeZone: "Asia/Shanghai" });
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗 还是说已经睡了",
      kind: "text",
      lineNo: 1,
    });
    expect(parsed.records[0].timestamp?.toISOString()).toBe("2022-03-01T12:00:00.000Z");
    expect(parsed.records[1]).toMatchObject({
      speaker: "阿树",
      content: "在的",
      lineNo: 3,
    });
    expect(parsed.speakers.map((row) => row.name).sort()).toEqual(["小满", "阿树"].sort());
  });

  it("maps a whole-message placeholder onto a kind", async () => {
    const parsed = await parseGenericLine(
      "[2022-03-01 20:00:00] 小满：[图片]\n[2022-03-01 20:00:05] 阿树：[语音通话] 时长 00:43:12",
      { timeZone: "Asia/Shanghai" },
    );
    expect(parsed.records[0]).toMatchObject({ kind: "image", content: "[image]" });
    expect(parsed.records[1]).toMatchObject({
      kind: "call",
      content: "[call:voice:2592]",
      meta: { mode: "voice", durationSec: 2592 },
    });
  });

  it("strips a leading BOM and skips a file that names nobody", async () => {
    const withBom = `\uFEFF[2022-03-01 20:00:00] 小满：在吗`;
    const parsed = await parseGenericLine(withBom);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].speaker).toBe("小满");

    const prose = await parseGenericLine("just a paragraph\nof two lines");
    expect(prose.records).toHaveLength(0);
    expect(prose.skipped).toBe(2);
  });

  it("reads the hand-written sample, including a continuation and a colon in the content", async () => {
    const parsed = await parseGenericLine(SAMPLE, { timeZone: "Asia/Shanghai" });
    expect(parsed.records.length).toBeGreaterThanOrEqual(10);
    expect(parsed.records[0]).toMatchObject({
      speaker: "小满",
      content: "在吗 还是说已经睡了",
    });
    const withColon = parsed.records.find((row) => row.content.includes("他说：先这样"));
    expect(withColon?.speaker).toBe("小满");
    const fakeHeader = parsed.records.find((row) =>
      row.content.includes("[2022-03-01 20:02:00] 这不是新消息"),
    );
    expect(fakeHeader?.speaker).toBe("小满");
    expect(fakeHeader?.content).toBe("内容里写着 [2022-03-01 20:02:00] 这不是新消息");
  });
});
