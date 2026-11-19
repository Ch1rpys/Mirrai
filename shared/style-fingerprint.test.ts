import { describe, expect, it } from "vitest";
import {
  endingClassOf,
  fingerprintHighlights,
  lastParticleOf,
  lineSurprise,
  measureFingerprint,
  styleDistance,
  type EndingClass,
  type FingerprintRow,
} from "./style-fingerprint";
import { buildXiaomanRecords, shanghaiDate } from "../server/test-fixtures/xiaoman";

function fixtureRows(): FingerprintRow[] {
  return buildXiaomanRecords().map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
    speaker: row.speaker,
  }));
}

function xiaomanPeriods() {
  return [
    {
      id: "p1",
      from: shanghaiDate(2022, 3, 1).toISOString(),
      to: shanghaiDate(2023, 6, 10).toISOString(),
    },
    {
      id: "p2",
      from: shanghaiDate(2023, 7, 5).toISOString(),
      to: shanghaiDate(2025, 1, 1).toISOString(),
    },
  ];
}

describe("endingClassOf", () => {
  const cases: Array<[string, EndingClass]> = [
    ["好的。。。", "ellipsis"],
    ["好的...", "ellipsis"],
    ["好的…", "ellipsis"],
    ["好的。", "period"],
    ["好的.", "period"],
    ["好？", "question"],
    ["好?", "question"],
    ["好！", "exclaim"],
    ["好!", "exclaim"],
    ["好呀~", "tilde"],
    ["好呀～", "tilde"],
    ["好😊", "emoji"],
    ["好🎉", "emoji"],
    ["好呀", "particle"],
    ["好啦", "particle"],
    ["好的", "other"],
    ["在的", "other"],
  ];

  it.each(cases)("%j is %s", (line, expected) => {
    expect(endingClassOf(line)).toBe(expected);
  });
});

describe("lastParticleOf", () => {
  it("peels trailing marks before reading the last character", () => {
    expect(lastParticleOf("好呀~")).toBe("呀");
    expect(lastParticleOf("好的。")).toBe("none");
    expect(lastParticleOf("好呀")).toBe("呀");
  });
});

describe("measureFingerprint", () => {
  it("returns null when there are fewer than forty text lines", () => {
    const rows: FingerprintRow[] = Array.from({ length: 39 }, (_, i) => ({
      role: "assistant",
      content: `在的呀${i}`,
      kind: "text",
    }));
    expect(measureFingerprint(rows)).toBeNull();
  });

  it("matches the designed habits of the fixture", () => {
    const rows = fixtureRows();
    const fp = measureFingerprint(rows, {
      addressForms: ["陈树", "树树"],
      periods: xiaomanPeriods(),
    });
    expect(fp).not.toBeNull();
    const taText = rows.filter((row) => row.role === "assistant" && (row.kind ?? "text") === "text");
    const distantShare =
      taText.filter((row) => row.emotion === "distant").length / Math.max(taText.length, 1);
    expect(Math.abs((fp?.endings.period ?? 0) - distantShare * 0.9)).toBeLessThanOrEqual(0.02);
    expect(taText.filter((row) => lastParticleOf(row.content) === "呢")).toHaveLength(0);
    expect(fp?.particles["呢"]).toBe(0);
    const haRuns = fp?.laugh.haRuns ?? [];
    expect(haRuns[4]).toBeGreaterThan(0);
    expect(haRuns[2]).toBe(0);
    expect(haRuns[3]).toBe(0);
    expect(haRuns.slice(5)).toEqual(Array(haRuns.length - 5).fill(0));
    expect(fp?.punctuation.ellipsisForms.unicode).toBe(0);
    expect(fp?.emoji.rate).toBe(0);
  });

  it("splits the fixture by state", () => {
    const fp = measureFingerprint(fixtureRows(), {
      addressForms: ["陈树", "树树"],
    });
    expect(fp?.perState?.distant?.endings.period).toBeGreaterThanOrEqual(0.85);
    expect(fp?.perState?.distant?.endings.period).toBeLessThanOrEqual(0.95);
    expect(fp?.perState?.warm?.endings.period).toBe(0);
    expect(fp?.perState?.distant?.address["陈树"]).toBeGreaterThan(0);
    expect(fp?.perState?.warm?.address["陈树"]).toBe(0);
  });

  it("splits the fixture by period", () => {
    const fp = measureFingerprint(fixtureRows(), { periods: xiaomanPeriods() });
    expect(fp?.perPeriod?.p1?.length.median).toBeGreaterThanOrEqual(9);
    expect(fp?.perPeriod?.p1?.length.median).toBeLessThanOrEqual(11);
    expect(fp?.perPeriod?.p2?.length.median).toBeGreaterThanOrEqual(5);
    expect(fp?.perPeriod?.p2?.length.median).toBeLessThanOrEqual(7);
  });
});

describe("styleDistance", () => {
  it("is small when the generated lines are the person's own", () => {
    const rows = fixtureRows();
    const fp = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
    expect(fp).not.toBeNull();
    const ta = rows
      .filter((row) => row.role === "assistant" && (row.kind ?? "text") === "text")
      .slice(0, 200)
      .map((row) => row.content);
    const close = styleDistance(ta, fp!);
    expect(close.total).toBeLessThan(0.1);
    const withPeriod = styleDistance(
      ta.map((line) => `${line}。`),
      fp!,
    );
    expect(withPeriod.endings).toBeGreaterThan(0.5);
    expect(withPeriod.total).toBeGreaterThan(close.total);
    const long = styleDistance(
      ta.map(() => "字".repeat(80)),
      fp!,
    );
    expect(long.length).toBe(1);
  });
});

describe("lineSurprise", () => {
  it("treats a period line as more surprising in warm than in distant", () => {
    const fp = measureFingerprint(fixtureRows(), { addressForms: ["陈树", "树树"] });
    expect(fp?.perState?.warm).toBeTruthy();
    expect(fp?.perState?.distant).toBeTruthy();
    expect(lineSurprise("哦。", fp!.perState!.warm!)).toBeGreaterThan(
      lineSurprise("哦。", fp!.perState!.distant!),
    );
  });
});

describe("fingerprintHighlights", () => {
  it("keeps the rare-period line of the fixture", () => {
    const fp = measureFingerprint(fixtureRows(), { addressForms: ["陈树", "树树"] });
    expect(fp).not.toBeNull();
    const ids = fingerprintHighlights(fp!).map((line) => line.id);
    expect(ids).toContain("almostNoPeriod");
    expect(ids).toContain("laughFourHa");
    expect(ids).toContain("topParticles");
  });

  it("drops a claim that does not have a clear majority", () => {
    const fp = measureFingerprint(
      Array.from({ length: 40 }, (_, i) => ({
        role: "assistant" as const,
        content: i % 2 === 0 ? "好的。" : "行。",
        kind: "text",
      })),
    );
    expect(fp).not.toBeNull();
    const ids = fingerprintHighlights(fp!).map((line) => line.id);
    expect(ids).not.toContain("almostNoPeriod");
    expect(ids).not.toContain("laughFourHa");
    expect(ids).not.toContain("topParticles");
  });
});
