import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureFingerprint } from "./style-fingerprint";
import { describeFingerprint } from "./fingerprint-prose";

const rows = buildXiaomanRecords()
  .filter((row) => row.role === "assistant" && row.kind === "text")
  .map((row) => ({
    role: "assistant" as const,
    content: row.content,
    timestamp: row.timestamp,
    emotion: row.truth.state,
  }));
const fingerprint = measureFingerprint(rows)!;

describe("the fingerprint in words", () => {
  it("says how a line ends, from the measured endings", () => {
    const lines = describeFingerprint(fingerprint);
    const ends = lines.find((line) => line.metric.includes("endings.period"));
    expect(ends).toBeTruthy();
    expect(ends!.text).toContain("句号");
    expect(ends!.text).toContain("不高兴");
    expect(ends!.value).toBe(fingerprint.endings.period);
  });

  it("mentions the particle they never use", () => {
    const lines = describeFingerprint(fingerprint);
    expect(lines.some((line) => line.text.includes("呢"))).toBe(true);
    expect(fingerprint.particles["呢"]).toBe(0);
  });

  it("ties every sentence to a number in the fingerprint", () => {
    const valueAt = (path: string): unknown => {
      let current: unknown = fingerprint;
      for (const part of path.split(".")) {
        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    };
    const lines = describeFingerprint(fingerprint);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      const paths = line.metric.split(" / ");
      expect(paths.length).toBeGreaterThan(0);
      for (const path of paths) {
        expect(Number.isFinite(valueAt(path)), `${line.text} -> ${path}`).toBe(true);
      }
      // The primary path is the number the sentence states.
      expect(valueAt(paths[0]!)).toBe(line.value);
    }
  });

  it("says nothing when there is no fingerprint", () => {
    expect(describeFingerprint(null)).toEqual([]);
  });
});
