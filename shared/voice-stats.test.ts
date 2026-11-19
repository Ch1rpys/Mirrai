import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { estimateSpeechSeconds, measureVoice, normalizeVoiceStats } from "./voice-stats";

/**
 * How often the fixture sends a voice note.
 *
 * The design is five percent of the warm turns, each twelve seconds.
 * The state is written back from the fixture's own truth before
 * measuring: the measurement reads the emotion labels, not the truth.
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

describe("measuring voice notes", () => {
  it("has the rate and the length the fixture was designed with", () => {
    const stats = measureVoice(rows());
    expect(stats).not.toBeNull();
    expect(stats!.byState.warm!.rate).toBeGreaterThanOrEqual(0.02);
    expect(stats!.byState.warm!.rate).toBeLessThanOrEqual(0.08);
    expect(stats!.durationSec.median).toBe(12);
    expect(stats!.samples).toBeGreaterThan(0);
    expect(stats!.rate).toBeGreaterThan(0);
    expect(stats!.afterMyVoiceRate === null || typeof stats!.afterMyVoiceRate === "number").toBe(true);
  });

  it("has no measurement with fewer than ten voice notes", () => {
    const all = rows();
    let kept = 0;
    const few = all.filter((row) => {
      if (row.kind !== "voice") return true;
      kept += 1;
      return kept <= 9;
    });
    expect(measureVoice(few)).toBeNull();
  });

  it("reads the duration from the token when the meta does not carry it", () => {
    const stats = measureVoice([
      ...rows().filter((row) => row.kind !== "voice"),
      ...Array.from({ length: 10 }, (_, index) => ({
        role: "assistant" as const,
        kind: "voice",
        content: "[voice:20]",
        timestamp: new Date(`2023-01-0${(index % 9) + 1}T20:00:00Z`),
        emotion: "warm",
        meta: null,
      })),
    ]);
    expect(stats?.durationSec.median).toBe(20);
  });

  it("keeps a stored measurement and refuses a broken one", () => {
    const stats = measureVoice(rows())!;
    expect(normalizeVoiceStats(stats)?.samples).toBe(stats.samples);
    expect(normalizeVoiceStats({ samples: 3 })).toBeNull();
    expect(normalizeVoiceStats("nope")).toBeNull();
  });

  it("estimates four characters a second", () => {
    expect(estimateSpeechSeconds("在的呀")).toBe(1);
    expect(estimateSpeechSeconds("一二三四五六七八九")).toBe(3);
  });
});
