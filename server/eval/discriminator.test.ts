import { describe, expect, it } from "vitest";
import { isTextRecord } from "@shared/records";
import { measureFingerprint } from "@shared/style-fingerprint";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import {
  DISCRIMINATOR_MIN_PAIRS,
  pairsFromEvalRuns,
  pairsFromScores,
  scoreReal,
  splitPairFolds,
  trainDiscriminator,
  type DiscriminatorPair,
} from "./discriminator";

function fixtureTaLines(): string[] {
  return buildXiaomanRecords()
    .filter((row) => row.role === "assistant" && isTextRecord(row) && row.content.trim())
    .map((row) => row.content.trim());
}

function fixtureFingerprint() {
  return measureFingerprint(
    buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
    })),
  );
}

describe("the discriminator", () => {
  it("spots a period glued onto two hundred real lines", () => {
    const lines = fixtureTaLines().slice(0, 200);
    expect(lines.length).toBe(200);
    const pairs: DiscriminatorPair[] = lines.map((real) => ({ real, fake: `${real}。` }));
    const report = trainDiscriminator(pairs, fixtureFingerprint(), "period-tell");
    expect(report.insufficient).toBe(false);
    expect(report.auc).toBeGreaterThan(0.95);
    const top = report.tells.slice(0, 3);
    const period = top.find((tell) => tell.feature === "ending.period");
    expect(period).toBeDefined();
    expect(period?.side).toBe("persona");
  });

  it("cannot tell two random halves of the same pool apart", () => {
    const lines = fixtureTaLines().slice(0, 200);
    const rng = mulberry("mix-pool");
    const pairs: DiscriminatorPair[] = Array.from({ length: 200 }, () => ({
      real: lines[Math.floor(rng() * lines.length)]!,
      fake: lines[Math.floor(rng() * lines.length)]!,
    }));
    const report = trainDiscriminator(pairs, fixtureFingerprint(), "same-pool");
    expect(report.auc).toBeGreaterThanOrEqual(0.4);
    expect(report.auc).toBeLessThanOrEqual(0.6);
  });

  it("refuses to train on fifty-nine pairs", () => {
    const lines = fixtureTaLines().slice(0, 59);
    const pairs: DiscriminatorPair[] = lines.map((real) => ({ real, fake: `${real}。` }));
    const report = trainDiscriminator(pairs, fixtureFingerprint(), "too-few");
    expect(report.insufficient).toBe(true);
    expect(report.pairs).toBe(59);
    expect(report.pairs).toBeLessThan(DISCRIMINATOR_MIN_PAIRS);
    expect(report.tells).toEqual([]);
    expect(report.model.ngrams).toEqual([]);
  });

  it("gives the same AUC when the same pairs and seed run twice", () => {
    const lines = fixtureTaLines().slice(0, 80);
    const pairs: DiscriminatorPair[] = lines.map((real) => ({ real, fake: `${real}。` }));
    const first = trainDiscriminator(pairs, fixtureFingerprint(), "same-seed");
    const second = trainDiscriminator(pairs, fixtureFingerprint(), "same-seed");
    expect(first.auc).toBe(second.auc);
    expect(first.aucStd).toBe(second.aucStd);
  });

  it("keeps both lines of a pair on the same side of every fold", () => {
    const splits = splitPairFolds(80, "fold-lock");
    expect(splits).toHaveLength(5);
    const seen = new Set<number>();
    for (const { train, test } of splits) {
      const trainSet = new Set(train);
      const testSet = new Set(test);
      for (const index of test) {
        expect(trainSet.has(index)).toBe(false);
        seen.add(index);
      }
      for (const index of train) expect(testSet.has(index)).toBe(false);
      expect(train.length + test.length).toBe(80);
    }
    expect(seen.size).toBe(80);
  });

  it("turns each generated sample into a pair against the real line", () => {
    expect(
      pairsFromScores([
        {
          expectedText: "还行吧",
          generatedText: "ignored",
          generatedSamples: ["好的。", "嗯。"],
        },
      ]),
    ).toEqual([
      { real: "还行吧", fake: "好的。" },
      { real: "还行吧", fake: "嗯。" },
    ]);
  });

  it("drops runs from before this persona version", () => {
    const pairs = pairsFromEvalRuns(
      [
        {
          createdAt: "2020-01-01T00:00:00.000Z",
          metricsJson: { scores: [{ expectedText: "old", generatedText: "old-fake" }] },
        },
        {
          createdAt: "2026-06-01T00:00:00.000Z",
          metricsJson: { scores: [{ expectedText: "new", generatedText: "new-fake" }] },
        },
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(pairs).toEqual([{ real: "new", fake: "new-fake" }]);
  });

  it("scores a period-suffixed line as less real after training", () => {
    const lines = fixtureTaLines().slice(0, 80);
    const pairs: DiscriminatorPair[] = lines.map((real) => ({ real, fake: `${real}。` }));
    const { model } = trainDiscriminator(pairs, fixtureFingerprint(), "score-real");
    const real = lines[0]!;
    expect(scoreReal(model, real, fixtureFingerprint())).toBeGreaterThan(
      scoreReal(model, `${real}。`, fixtureFingerprint()),
    );
  });
});

function mulberry(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return t / 4294967296;
  };
}
