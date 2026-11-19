import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { measureDoubleText, type DoubleTextRow } from "./double-text";

function followUps(n: number): DoubleTextRow[] {
  const rows: DoubleTextRow[] = [];
  const start = Date.parse("2024-06-03T12:00:00.000Z");
  for (let i = 0; i < n; i++) {
    const at = start + i * 2 * 3_600_000;
    rows.push(
      { role: "user", content: "在吗", timestamp: new Date(at), kind: "text" },
      { role: "assistant", content: "在的", timestamp: new Date(at + 5_000), kind: "text" },
      {
        role: "assistant",
        content: i % 10 < 7 ? "人呢" : "？",
        timestamp: new Date(at + 8 * 60_000),
        kind: "text",
      },
    );
  }
  return rows;
}

describe("measureDoubleText", () => {
  it("recovers the fixture's thirty follow-ups", () => {
    const rows = buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
    }));
    const measured = measureDoubleText(rows);
    expect(measured).not.toBeNull();
    expect(measured!.samples).toBe(30);
    expect(measured!.lines[0]?.text).toBe("人呐");
    expect(measured!.lines[1]?.text).toBe("？");
    expect(measured!.lines[0]!.n / measured!.lines[1]!.n).toBeGreaterThan(7 / 3 - 0.4);
    expect(measured!.lines[0]!.n / measured!.lines[1]!.n).toBeLessThan(7 / 3 + 0.4);
    expect(measured!.waitSec.median).toBeGreaterThanOrEqual(540 - 90);
    expect(measured!.waitSec.median).toBeLessThanOrEqual(540 + 90);
  });

  it("returns null when there are only seven follow-ups", () => {
    expect(measureDoubleText(followUps(7))).toBeNull();
    expect(measureDoubleText(followUps(8))?.samples).toBe(8);
  });
});
