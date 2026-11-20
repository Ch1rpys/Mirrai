import { describe, expect, it } from "vitest";
import { mergeScreenshotPages, parseTimeBar } from "./screenshot-merge";

describe("merging screenshots", () => {
  it("keeps an overlapping message once at the seam", () => {
    const rows = mergeScreenshotPages(
      [
        [
          { side: "left", text: "在吗" },
          { side: "right", text: "在" },
          { side: "left", text: "晚上吃什么" },
        ],
        [
          { side: "left", text: "晚上吃什么" },
          { side: "right", text: "随便" },
        ],
      ],
      { date: "2024-06-01" },
    ).rows;
    expect(rows.map((row) => row.content)).toEqual(["在吗", "在", "晚上吃什么", "随便"]);
  });

  it("keeps a three-message overlap once at the seam", () => {
    const rows = mergeScreenshotPages(
      [
        [
          { side: "left", text: "A" },
          { side: "right", text: "B" },
          { side: "left", text: "C" },
        ],
        [
          { side: "left", text: "A" },
          { side: "right", text: "B" },
          { side: "left", text: "C" },
          { side: "right", text: "D" },
        ],
      ],
      { date: "2024-06-01" },
    ).rows;
    expect(rows.map((row) => `${row.role}:${row.content}`)).toEqual([
      "assistant:A",
      "user:B",
      "assistant:C",
      "user:D",
    ]);
  });

  it("applies a time bar to the messages after it, one second apart", () => {
    const merged = mergeScreenshotPages(
      [
        [
          { side: "center", text: "12:30", time: "12:30" },
          { side: "left", text: "嗨" },
          { side: "right", text: "在" },
          { side: "center", text: "12:31", time: "12:31" },
          { side: "left", text: "走吗" },
        ],
      ],
      { date: "2024-06-01", timeZone: "Asia/Shanghai" },
    );
    expect(merged.rows.map((row) => row.role)).toEqual(["assistant", "user", "assistant"]);
    expect(merged.rows[0]?.at?.toISOString()).toBe("2024-06-01T04:30:00.000Z");
    expect(merged.rows[1]?.at?.toISOString()).toBe("2024-06-01T04:30:01.000Z");
    expect(merged.rows[2]?.at?.toISOString()).toBe("2024-06-01T04:31:00.000Z");
    expect(merged.timeApprox).toBe(false);
    expect(merged.needsDate).toBe(false);
  });

  it("starts at noon, one minute apart, when there is no time bar", () => {
    const merged = mergeScreenshotPages(
      [
        [
          { side: "left", text: "在吗" },
          { side: "right", text: "在" },
        ],
      ],
      { date: "2024-06-01", timeZone: "Asia/Shanghai" },
    );
    expect(merged.timeApprox).toBe(true);
    expect(merged.rows[0]?.at?.toISOString()).toBe("2024-06-01T04:00:00.000Z");
    expect(merged.rows[1]?.at?.toISOString()).toBe("2024-06-01T04:01:00.000Z");
  });

  it("asks for a date when there is no time bar and no date", () => {
    const merged = mergeScreenshotPages([[{ side: "left", text: "在吗" }]]);
    expect(merged.needsDate).toBe(true);
    expect(merged.rows[0]?.at).toBeNull();
  });

  it("stores a sticker as its token, not as a sentence", () => {
    const merged = mergeScreenshotPages(
      [[{ side: "left", text: "狗狗探头", kind: "sticker" }]],
      { date: "2024-06-01" },
    );
    expect(merged.rows[0]?.content).toBe("[sticker:狗狗探头]");
    expect(merged.rows[0]?.kind).toBe("sticker");
  });

  it("reads a full date, a clock, and a Chinese half of the day", () => {
    expect(parseTimeBar("2024年6月1日 12:30", null, "Asia/Shanghai")?.toISOString()).toBe(
      "2024-06-01T04:30:00.000Z",
    );
    expect(parseTimeBar("晚上 8:05", "2024-06-01", "Asia/Shanghai")?.toISOString()).toBe(
      "2024-06-01T12:05:00.000Z",
    );
    expect(parseTimeBar("昨天 09:00", "2024-06-02", "Asia/Shanghai")?.toISOString()).toBe(
      "2024-06-01T01:00:00.000Z",
    );
    expect(parseTimeBar("没有时间", "2024-06-01", "Asia/Shanghai")).toBeNull();
  });
});
