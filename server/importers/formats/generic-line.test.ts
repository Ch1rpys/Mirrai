import { describe, expect, it } from "vitest";
import { parseGenericLine } from "./generic-line";

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

  it("strips a leading BOM and skips a file that names nobody", async () => {
    const withBom = `\uFEFF[2022-03-01 20:00:00] 小满：在吗`;
    const parsed = await parseGenericLine(withBom);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].speaker).toBe("小满");

    const prose = await parseGenericLine("just a paragraph\nof two lines");
    expect(prose.records).toHaveLength(0);
    expect(prose.skipped).toBe(2);
  });
});
