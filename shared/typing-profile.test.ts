import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import {
  burstTypingMs,
  delayTypingMs,
  measureTyping,
  type TypingRow,
} from "./typing-profile";

function burstPair(at: number, later: string, gapMs: number): TypingRow[] {
  return [
    { role: "user", content: "在吗", timestamp: new Date(at - 5_000), kind: "text" },
    { role: "assistant", content: "嗯", timestamp: new Date(at), kind: "text" },
    {
      role: "assistant",
      content: later,
      timestamp: new Date(at + gapMs),
      kind: "text",
    },
  ];
}

const seconds = { resolution: "second" as const };

describe("measureTyping", () => {
  it("recovers 200 ms per character from a burst designed that way", () => {
    const rows: TypingRow[] = [];
    const start = Date.parse("2024-06-03T12:00:00.123Z");
    for (let i = 0; i < 32; i++) {
      const at = start + i * 60_000;
      rows.push(...burstPair(at, "你好啊", 3 * 200));
    }
    const measured = measureTyping(rows, seconds);
    expect(measured).not.toBeNull();
    expect(measured!.msPerChar).toBeGreaterThanOrEqual(160);
    expect(measured!.msPerChar).toBeLessThanOrEqual(240);
    expect(measured!.pairs).toBe(32);
  });

  it("recovers the fixture's 200 ms-per-character bursts", () => {
    const rows = buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      speaker: row.speaker,
    }));
    const measured = measureTyping(rows, seconds);
    expect(measured).not.toBeNull();
    expect(measured!.msPerChar).toBeGreaterThanOrEqual(160);
    expect(measured!.msPerChar).toBeLessThanOrEqual(240);
  });

  it("returns null when the timestamps only have minutes", () => {
    const rows: TypingRow[] = [];
    const start = Date.parse("2024-06-03T12:00:00.000Z");
    for (let i = 0; i < 32; i++) {
      const at = start + i * 60_000;
      rows.push(
        { role: "user", content: "在吗", timestamp: new Date(at), kind: "text" },
        { role: "assistant", content: "嗯", timestamp: new Date(at + 60_000), kind: "text" },
        { role: "assistant", content: "好", timestamp: new Date(at + 120_000), kind: "text" },
      );
    }
    expect(measureTyping(rows, seconds)).toBeNull();
  });

  it("returns null when there is no second-resolution reply delay", () => {
    const rows: TypingRow[] = [];
    const start = Date.parse("2024-06-03T12:00:01.123Z");
    for (let i = 0; i < 32; i++) {
      const at = start + i * 8 * 3_600_000;
      rows.push(...burstPair(at, "你好啊", 3 * 200));
    }
    expect(measureTyping(rows, null)).toBeNull();
    expect(measureTyping(rows, { resolution: "minute" })).toBeNull();
  });
});

describe("typing durations", () => {
  const profile = {
    msPerChar: 200,
    burstGapMs: { p10: 400, p25: 600, p50: 800, p75: 1_200, p90: 2_000 },
    pairs: 40,
  };

  it("does not let the typing indicator outlast the delay", () => {
    const ms = delayTypingMs("嗯", profile, 500);
    expect(ms).toBe(500);
    expect(delayTypingMs("嗯", profile, 40_000)).toBe(800);
  });

  it("keeps a typing duration no longer than its gap", () => {
    let i = 0;
    const rng = () => {
      const values = [0, 0.5, 0.99];
      return values[i++] ?? 0.5;
    };
    const { gapsMs, typingMs } = burstTypingMs(["嗯", "好", "在"], profile, rng);
    expect(gapsMs).toHaveLength(2);
    expect(typingMs).toHaveLength(2);
    typingMs.forEach((ms, index) => {
      expect(ms).toBeLessThanOrEqual(gapsMs[index]!);
    });
  });
});
