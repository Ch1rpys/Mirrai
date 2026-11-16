import { describe, expect, it } from "vitest";
import { parseTranscriptMessages } from "./micro-rules";
import { toMinerRows } from "./roles";

describe("toMinerRows", () => {
  it("maps the other named speaker to user when one of two is TA", () => {
    const parsed = parseTranscriptMessages("小满：在\n阿树：嗯", { personaName: "小满" });
    expect(toMinerRows(parsed, "小满").map((row) => row.role)).toEqual([
      "assistant",
      "user",
    ]);
  });

  it("leaves non-TA names as other when there are three named speakers", () => {
    const parsed = parseTranscriptMessages("小满：在\n阿树：嗯\n琪琪：哈", {
      personaName: "小满",
    });
    expect(toMinerRows(parsed, "小满").map((row) => row.role)).toEqual([
      "assistant",
      "other",
      "other",
    ]);
  });

  it("maps unnamed lines to other", () => {
    const parsed = parseTranscriptMessages("hello\nworld");
    expect(parsed.every((row) => row.role === "")).toBe(true);
    expect(toMinerRows(parsed, "小满").every((row) => row.role === "other")).toBe(true);
  });
});
