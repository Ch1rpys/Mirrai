import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureQuirks, type QuirkRow } from "./quirks-profile";

describe("measureQuirks", () => {
  it("recovers the fixture's six typo-fix pairs, each wrong sitting in the previous line", () => {
    const rows = buildXiaomanRecords();
    const measured = measureQuirks(rows);
    const events = measured.typoFixes.reduce((sum, row) => sum + row.n, 0);
    expect(events).toBe(6);
    expect(measured.typoFixes.length).toBeGreaterThan(0);
    const byTime = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    for (const pair of measured.typoFixes) {
      const hits = byTime.filter((row) => (
        row.role === "assistant"
        && row.kind === "text"
        && row.content.trim() === `*${pair.right}`
      ));
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        const previous = [...byTime].reverse().find((row) => (
          row.role === "assistant"
          && row.kind === "text"
          && row.timestamp.getTime() < hit.timestamp.getTime()
          && row.content.includes(pair.wrong)
        ));
        expect(previous, pair.wrong).toBeTruthy();
        expect(previous!.content.includes(pair.wrong)).toBe(true);
      }
    }
  });

  it("sets recallRate from six recall rows and zero from four", () => {
    const six = linesWithKind("recall", 6);
    const four = linesWithKind("recall", 4);
    const measuredSix = measureQuirks(six);
    const measuredFour = measureQuirks(four);
    expect(measuredSix.recallRate).toBeCloseTo(6 / 10, 5);
    expect(measuredFour.recallRate).toBe(0);
  });

  it("fills patAfter from six taps and leaves it empty from four", () => {
    const six = patLines(6, "在吗");
    const four = patLines(4, "在吗");
    const measuredSix = measureQuirks(six);
    const measuredFour = measureQuirks(four);
    expect(measuredSix.patAfter.ask?.pats).toBe(6);
    expect(measuredSix.patAfter.ask?.turns).toBe(10);
    expect(measuredFour.patAfter).toEqual({});
  });
});

/** Twenty rows: ten user/assistant pairs, `count` of the assistant rows tagged. */
function linesWithKind(kind: "recall" | "pat", count: number): QuirkRow[] {
  const rows: QuirkRow[] = [];
  const start = Date.parse("2024-06-03T12:00:00.000Z");
  for (let i = 0; i < 10; i++) {
    rows.push({
      role: "user",
      content: "在吗",
      timestamp: new Date(start + i * 120_000),
      kind: "text",
    });
    const tagged = i < count;
    rows.push({
      role: "assistant",
      content: tagged && kind === "recall" ? "[recall]" : "在",
      timestamp: new Date(start + i * 120_000 + 5_000),
      kind: tagged ? kind : "text",
    });
  }
  return rows;
}

function patLines(pats: number, userText: string): QuirkRow[] {
  const rows: QuirkRow[] = [];
  const start = Date.parse("2024-06-03T12:00:00.000Z");
  for (let i = 0; i < 10; i++) {
    rows.push({
      role: "user",
      content: userText,
      timestamp: new Date(start + i * 120_000),
      kind: "text",
    });
    rows.push({
      role: "assistant",
      content: i < pats ? "[pat]" : "在",
      timestamp: new Date(start + i * 120_000 + 5_000),
      kind: i < pats ? "pat" : "text",
    });
  }
  return rows;
}
