import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { compareMetricCI, type EvalMetrics } from "./metrics";

const src = readFileSync(join(__dirname, "../../scripts/eval-run.ts"), "utf8");

function metricsWithOverlapCi(value: number, lo: number, hi: number): EvalMetrics {
  return {
    cases: 2,
    overlap: value,
    likelihoodGap: 0,
    lengthDistance: 0,
    emotionAccuracy: 0.8,
    emotionMatrix: {},
    perState: {},
    scores: [],
    ci: {
      overlap: [lo, hi],
      likelihoodGap: [0, 0],
      styleDistance: [0, 0],
      actMatch: [0, 0],
    },
  };
}

describe("pnpm eval --compare", () => {
  it("compares action sampling on and off", () => {
    expect(src).toContain('variant: "withoutAct"');
    expect(src).toContain("action sampling on vs off");
  });

  it("prints why a reranked line won", () => {
    expect(src).toContain("why it won");
  });

  it("includes style in the comparison", () => {
    expect(src).toContain('row("style"');
    expect(src).toContain("[eval] style");
    expect(src).toContain("tolerance-style");
  });

  it("calls overlapping intervals within noise", () => {
    const withThem = metricsWithOverlapCi(0.40, 0.35, 0.45);
    const withoutThem = metricsWithOverlapCi(0.41, 0.36, 0.46);
    expect(compareMetricCI(withThem, withoutThem, "overlap", "higher")).toBe("within noise");
  });

  it("calls a separated improvement better", () => {
    const withThem = metricsWithOverlapCi(0.55, 0.50, 0.60);
    const withoutThem = metricsWithOverlapCi(0.20, 0.15, 0.25);
    expect(compareMetricCI(withThem, withoutThem, "overlap", "higher")).toBe("better");
  });

  it("uses the last saved tolerances for the gate", () => {
    expect(src).toContain("resolveGateTolerances(flagTolerances, storedBaseline?.tolerances)");
  });

  it("runs a model audition", () => {
    expect(src).toContain("--audition");
    expect(src).toContain("[eval] audition:");
  });

  it("runs a multi-turn drift measurement", () => {
    expect(src).toContain("--drift");
    expect(src).toContain('variant: "drift"');
    expect(src).toContain("eval.drift.needUserSide");
    expect(src).toContain("[eval] drift windows:");
  });

  it("trains the discriminator on pairs from this persona version", () => {
    expect(src).toContain("--discriminator");
    expect(src).toContain("pairsFromEvalRuns(historical, version?.createdAt ?? null)");
    expect(src).toContain("metrics.discriminator = discriminatorForMetrics(trained)");
    expect(src).toContain("discriminator:");
  });
});
