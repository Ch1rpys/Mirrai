import { describe, expect, it } from "vitest";
import { minePeriods } from "./periods";

function stretch(
  start: Date,
  theirs: string,
  count: number,
): Array<{ role: string; content: string; timestamp: Date | null }> {
  const out: Array<{ role: string; content: string; timestamp: Date | null }> = [];
  for (let i = 0; i < count; i++) {
    out.push({
      role: "user",
      content: "在吗",
      timestamp: new Date(start.getTime() + i * 60_000),
    });
    out.push({
      role: "assistant",
      content: theirs,
      timestamp: new Date(start.getTime() + i * 60_000 + 1_000),
    });
  }
  return out;
}

describe("mining two stretches", () => {
  it("gives each stretch its own action counts", () => {
    const early = stretch(new Date("2025-01-01T12:00:00Z"), "嗯嗯", 20);
    const late = stretch(new Date("2025-03-01T12:00:00Z"), "明天晚上七点见", 20);
    const periods = minePeriods({ messages: [...early, ...late] });

    expect(periods).toHaveLength(2);
    expect(periods[0].actProfileDelta?.unconditional.acknowledge).toBeGreaterThan(0);
    expect(periods[1].actProfileDelta?.unconditional.logistics).toBeGreaterThan(0);
    expect(periods[0].actProfileDelta?.unconditional).not.toEqual(
      periods[1].actProfileDelta?.unconditional,
    );
  });

  it("does not invent a stretch when the record never went quiet", () => {
    const messages = stretch(new Date("2025-01-01T12:00:00Z"), "嗯嗯", 40);
    expect(minePeriods({ messages })).toEqual([]);
  });
});
