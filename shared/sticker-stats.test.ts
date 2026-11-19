import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureStickers, normalizeStickerStats } from "./sticker-stats";

/**
 * How often the fixture sends a sticker.
 *
 * The state is written back from the fixture's own truth before
 * measuring — the measurement reads the labels the distillation
 * writes, and the fixture's design values are per state.
 */
function rows() {
  return buildXiaomanRecords().map((row) => ({
    role: row.role,
    kind: row.kind,
    content: row.content,
    timestamp: row.timestamp,
    emotion: row.truth.state,
    meta: row.meta ?? null,
  }));
}

describe("measuring stickers", () => {
  it("has the rates the fixture was designed with, per mood", () => {
    const stats = measureStickers(rows());
    expect(stats).not.toBeNull();
    expect(stats!.byState.happy!.rate).toBeGreaterThanOrEqual(0.19);
    expect(stats!.byState.happy!.rate).toBeLessThanOrEqual(0.31);
    expect(stats!.byState.playful!.rate).toBeGreaterThanOrEqual(0.19);
    expect(stats!.byState.playful!.rate).toBeLessThanOrEqual(0.31);
    expect(stats!.byState.melancholy!.rate).toBeGreaterThanOrEqual(0.18);
    expect(stats!.byState.melancholy!.rate).toBeLessThanOrEqual(0.42);
    expect(stats!.byState.distant!.rate).toBe(0);
  });

  it("names the stickers the fixture uses", () => {
    const stats = measureStickers(rows())!;
    const top = stats.byState.happy!.top.map((entry) => entry.key);
    expect(top).toContain("狗狗探头");
    expect(stats.byState.melancholy!.top.map((entry) => entry.key)).toContain("猫猫叹气");
  });

  it("counts the turns, the runs and the solo stickers", () => {
    const stats = measureStickers(rows())!;
    const stickerRows = buildXiaomanRecords().filter(
      (row) => row.kind === "sticker" && row.role === "assistant",
    );
    expect(stats.samples).toBe(stickerRows.length);
    expect(stats.rate).toBeGreaterThan(0);
    expect(stats.rate).toBeLessThan(0.3);
    const runs = stats.runs.one + stats.runs.two + stats.runs.threePlus;
    expect(runs).toBeGreaterThan(0);
    expect(stats.soloRate).toBe(0);
  });

  it("has no measurement with fewer than ten stickers", () => {
    const many = rows();
    let seen = 0;
    const few = many.filter((row) => {
      if (row.kind !== "sticker") return true;
      seen += 1;
      return seen <= 9;
    });
    expect(measureStickers(few)).toBeNull();
  });

  it("keeps a manual rate the user typed, and drops a broken measurement", () => {
    const stats = measureStickers(rows())!;
    expect(normalizeStickerStats({ ...stats, manualRate: 0.1 })?.manualRate).toBe(0.1);
    expect(normalizeStickerStats({ samples: 3, rate: 0.1, soloRate: 0 })).toBeNull();
    expect(normalizeStickerStats("nonsense")).toBeNull();
  });
});
