import { describe, expect, it } from "vitest";
import { CHUNK_MAX_CHARS, chunkRecords, selectChunks } from "./chunks";
import { estimateDistillation } from "./estimate";
import { isTextRecord } from "@shared/records";
import { buildXiaomanRecords, shanghaiDate } from "../test-fixtures/xiaoman";

const TIME_ZONE = "Asia/Shanghai";
const SILENCE_START = shanghaiDate(2023, 6, 10);
const SILENCE_END = shanghaiDate(2023, 7, 5);

describe("chunkRecords", () => {
  const rows = buildXiaomanRecords();
  const chunks = chunkRecords(rows, { timeZone: TIME_ZONE });

  it("does not let a block cross 小满's silence in June 2023", () => {
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
    expect(chunks.length).toBeGreaterThan(12);
    for (const chunk of chunks) {
      expect(chunk.chars).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.chars).toBeGreaterThan(0);
      expect(chunk.hash).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("hashes the same blocks the same way twice", () => {
    const second = chunkRecords(rows, { timeZone: TIME_ZONE });
    expect(second.map((chunk) => chunk.hash)).toEqual(chunks.map((chunk) => chunk.hash));
    expect(new Set(chunks.map((chunk) => chunk.hash)).size).toBe(chunks.length);
  });

  it("puts every spoken line into exactly one block", () => {
    const spoken = rows.filter((row) => row.role === "user" || row.role === "assistant");
    const packed = chunks.reduce((sum, chunk) => sum + chunk.rows.length, 0);
    expect(packed).toBe(spoken.length);
    // The handbook's "文本行" is the spoken record. Non-text lines are
    // in the blocks too, rendered, so the sum is the spoken count, not
    // only kind === "text".
    expect(spoken.filter((row) => isTextRecord(row)).length).toBeLessThan(packed);
  });
});

describe("estimateDistillation", () => {
  const chunks = chunkRecords(buildXiaomanRecords(), { timeZone: TIME_ZONE });

  it("counts the same blocks deep mode would map", () => {
    const estimate = estimateDistillation(chunks, "deep");
    expect(estimate.chunks).toBe(chunks.length);
    expect(estimate.mapCalls).toBe(chunks.length);
    expect(estimate.calls).toBeGreaterThan(estimate.mapCalls);
  });

  it("caps fast mode at twelve blocks", () => {
    expect(chunks.length).toBeGreaterThan(12);
    const estimate = estimateDistillation(chunks, "fast");
    expect(estimate.chunks).toBe(12);
    expect(estimate.mapCalls).toBe(12);
  });
});

describe("selectChunks", () => {
  const rows = buildXiaomanRecords();
  const chunks = chunkRecords(rows, { timeZone: TIME_ZONE });
  const seed = `distill:1:${chunks.length}`;

  it("keeps the first block and the last three when the budget is twelve", () => {
    expect(chunks.length).toBeGreaterThan(12);
    const selected = selectChunks(chunks, 12, seed);
    expect(selected).toHaveLength(12);
    const hashes = new Set(selected.map((chunk) => chunk.hash));
    expect(hashes.has(chunks[0].hash)).toBe(true);
    expect(hashes.has(chunks[chunks.length - 1].hash)).toBe(true);
    expect(hashes.has(chunks[chunks.length - 2].hash)).toBe(true);
    expect(hashes.has(chunks[chunks.length - 3].hash)).toBe(true);
    expect(new Set(selected.map((chunk) => chunk.periodId)).size).toBeGreaterThanOrEqual(2);
    expect(selected.some((chunk) => chunk.dayPart === "day")).toBe(true);
    expect(selected.some((chunk) => chunk.dayPart === "night")).toBe(true);
    const again = selectChunks(chunks, 12, seed);
    expect(again.map((chunk) => chunk.hash)).toEqual(selected.map((chunk) => chunk.hash));
  });

  it("returns every block when the budget is larger than the log", () => {
    expect(selectChunks(chunks, chunks.length + 5, seed)).toEqual(chunks);
    expect(selectChunks(chunks, "all", seed)).toEqual(chunks);
  });

  it("keeps a labelled mood in the sample once their lines carry one", () => {
    const at = (index: number) => new Date(Date.parse("2024-01-01T04:00:00Z") + index * 60_000);
    const chunks = Array.from({ length: 12 }, (_, index) => {
      const stamp = at(index);
      // The first block and the last three are kept whatever happens.
      // Those four are warm, so a draw that ignores mood can spend its
      // spare seats on more warm blocks and never touch a distant one.
      const mood = index >= 6 && index <= 8 ? "distant" : index === 5 ? null : "warm";
      return {
        index,
        hash: `mood${index}`,
        from: stamp,
        to: stamp,
        periodId: "p",
        dayPart: "day" as const,
        chars: 4,
        rows: [
          {
            id: index * 2 + 1,
            role: "user" as const,
            content: "嗯",
            timestamp: stamp,
            kind: "text",
            emotion: index === 5 ? "distant" : null,
          },
          {
            id: index * 2 + 2,
            role: "assistant" as const,
            content: "在",
            timestamp: new Date(stamp.getTime() + 1000),
            kind: "text",
            emotion: mood,
          },
        ],
      };
    });
    const seed = "distill:1:12";
    const labelled = selectChunks(chunks, 6, seed);
    const distant = labelled.filter((chunk) =>
      chunk.rows.some((row) => row.role === "assistant" && row.emotion === "distant"),
    );
    expect(distant.length).toBeGreaterThan(0);
    const unlabelled = chunks.map((chunk) => ({
      ...chunk,
      rows: chunk.rows.map((row) => ({ ...row, emotion: null })),
    }));
    expect(selectChunks(unlabelled, 6, seed).map((chunk) => chunk.hash)).not.toEqual(
      labelled.map((chunk) => chunk.hash),
    );
  });

  it("puts the latest selected block inside the last five percent of the record", () => {
    const times = rows
      .filter((row) => row.role === "user" || row.role === "assistant")
      .map((row) => row.timestamp.getTime())
      .sort((a, b) => a - b);
    const start = times[0];
    const end = times[times.length - 1];
    const cutoff = start + (end - start) * 0.95;
    const selected = selectChunks(chunks, 12, seed);
    const latest = selected.reduce((best, chunk) => {
      const at = chunk.to?.getTime() ?? 0;
      return at > best ? at : best;
    }, 0);
    expect(latest).toBeGreaterThanOrEqual(cutoff);
  });
});
