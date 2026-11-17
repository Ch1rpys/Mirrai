import { describe, expect, it } from "vitest";
import { CHUNK_MAX_CHARS, chunkRecords } from "./chunks";
import { isTextRecord } from "@shared/records";
import { buildXiaomanRecords, shanghaiDate } from "../test-fixtures/xiaoman";

const TIME_ZONE = "Asia/Shanghai";
const SILENCE_START = shanghaiDate(2023, 6, 10);
const SILENCE_END = shanghaiDate(2023, 7, 5);

describe("chunkRecords", () => {
  it("does not let a block cross 小满's silence in June 2023", () => {
    const chunks = chunkRecords(buildXiaomanRecords(), { timeZone: TIME_ZONE });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const before = chunk.rows.some(
        (row) => row.timestamp && row.timestamp.getTime() < SILENCE_START.getTime(),
      );
      const after = chunk.rows.some(
        (row) => row.timestamp && row.timestamp.getTime() >= SILENCE_END.getTime(),
      );
      expect(before && after).toBe(false);
    }
  });

  it("keeps every block at or under maxChars", () => {
    const chunks = chunkRecords(buildXiaomanRecords(), { timeZone: TIME_ZONE });
    expect(chunks.length).toBeGreaterThan(12);
    for (const chunk of chunks) {
      expect(chunk.chars).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.chars).toBeGreaterThan(0);
      expect(chunk.hash).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("hashes the same blocks the same way twice", () => {
    const rows = buildXiaomanRecords();
    const first = chunkRecords(rows, { timeZone: TIME_ZONE });
    const second = chunkRecords(rows, { timeZone: TIME_ZONE });
    expect(second.map((chunk) => chunk.hash)).toEqual(first.map((chunk) => chunk.hash));
    expect(new Set(first.map((chunk) => chunk.hash)).size).toBe(first.length);
  });

  it("puts every spoken line into exactly one block", () => {
    const rows = buildXiaomanRecords();
    const spoken = rows.filter((row) => row.role === "user" || row.role === "assistant");
    const chunks = chunkRecords(rows, { timeZone: TIME_ZONE });
    const packed = chunks.reduce((sum, chunk) => sum + chunk.rows.length, 0);
    expect(packed).toBe(spoken.length);
    // The handbook's "文本行" is the spoken record. Non-text lines are
    // in the blocks too, rendered, so the sum is the spoken count, not
    // only kind === "text".
    expect(spoken.filter((row) => isTextRecord(row)).length).toBeLessThan(packed);
  });
});
