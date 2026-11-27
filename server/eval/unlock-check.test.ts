/**
 * The unlock check (B9.1 / B9.2).
 *
 * The two heavy approaches stay locked; what is tested here is the answer
 * to "are the conditions met yet?" — four conditions, each with its own
 * evidence, and "no data" never counts as a pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  UNLOCK_TA_LINES,
  evaluateUnlockCheck,
  formatUnlockCheck,
  guestSittings,
  tellCategory,
} from "./unlock-check";

const ROOT = resolve(import.meta.dirname, "../..");

function persona(overrides: Record<string, unknown> = {}) {
  return {
    settings: {},
    rerankEnabled: true,
    styleProfile: {},
    ...overrides,
  } as never;
}

/** A finished sitting by someone who is not the owner. */
function friendSitting(summary: Record<string, unknown>) {
  return { subject: "friend", summary } as never;
}

function ownerSitting(summary: Record<string, unknown>) {
  return { subject: "self", summary } as never;
}

/** Every condition met: rerank on, fooled 30% of the time, wording reasons, 1200 lines. */
function passingInput(overrides: Record<string, unknown> = {}) {
  return {
    persona: persona(),
    sessions: [
      friendSitting({
        n: 20,
        pickedReal: 0.6,
        pickedPersona: 0.3,
        unsure: 0.1,
        medianSeconds: 5,
        reasons: { word: 9, act: 3 },
      }),
    ],
    taTextLines: 1200,
    ...overrides,
  };
}

describe("guestSittings", () => {
  it("counts only the sittings someone else took", () => {
    const sessions = [
      ownerSitting({ n: 20, pickedPersona: 0.2, reasons: {} }),
      friendSitting({ n: 10, pickedPersona: 0.4, reasons: { word: 1 } }),
    ];
    expect(guestSittings(sessions)).toHaveLength(1);
    expect(guestSittings(sessions)[0]?.n).toBe(10);
  });

  it("drops a sitting with no usable summary", () => {
    expect(
      guestSittings([
        friendSitting({ n: 0, pickedPersona: 0, reasons: {} }),
        { subject: "friend", summary: null } as never,
        friendSitting({ n: 5, pickedPersona: 0.5, reasons: {} }),
      ]),
    ).toHaveLength(1);
  });
});

describe("evaluateUnlockCheck", () => {
  it("is unlocked when all four conditions are met", () => {
    const report = evaluateUnlockCheck(passingInput());
    expect(report.conditions.map((condition) => condition.satisfied)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(report.unlocked).toBe(true);
  });

  it("is not unlocked when the cheap layers or rerank are off", () => {
    const report = evaluateUnlockCheck(
      passingInput({ persona: persona({ rerankEnabled: false }) }),
    );
    expect(report.conditions[0]?.satisfied).toBe(false);
    expect(report.unlocked).toBe(false);
  });

  it("is not unlocked while the persona still fools more than half", () => {
    const report = evaluateUnlockCheck(
      passingInput({
        sessions: [
          friendSitting({ n: 20, pickedPersona: 0.7, reasons: { word: 9, act: 3 } }),
        ],
      }),
    );
    expect(report.conditions[1]?.satisfied).toBe(false);
    expect(report.unlocked).toBe(false);
  });

  it("is not unlocked while the reasons are about the wrong action", () => {
    const report = evaluateUnlockCheck(
      passingInput({
        sessions: [
          friendSitting({ n: 20, pickedPersona: 0.3, reasons: { act: 6, word: 2 } }),
        ],
      }),
    );
    expect(report.conditions[2]?.satisfied).toBe(false);
    expect(report.unlocked).toBe(false);
  });

  it("is not unlocked below a thousand of their lines", () => {
    const report = evaluateUnlockCheck(
      passingInput({ taTextLines: UNLOCK_TA_LINES - 1 }),
    );
    expect(report.conditions[3]?.satisfied).toBe(false);
    expect(report.unlocked).toBe(false);
    // The threshold itself is enough.
    expect(
      evaluateUnlockCheck(passingInput({ taTextLines: UNLOCK_TA_LINES })).unlocked,
    ).toBe(true);
  });

  it("treats no blind sittings as no data, not as a pass", () => {
    const report = evaluateUnlockCheck(passingInput({ sessions: [] }));
    expect(report.conditions[1]?.satisfied).toBeNull();
    expect(report.conditions[2]?.satisfied).toBeNull();
    expect(report.unlocked).toBe(false);
    const lines = formatUnlockCheck(report, "zh");
    expect(lines[1]).toBe("应用内盲测：没有数据");
    expect(lines[2]).toBe("盲测理由：没有数据");
    expect(lines[6]).toBe("unlocked: false");
  });

  it("does not count the owner's own sittings", () => {
    const report = evaluateUnlockCheck(
      passingInput({
        sessions: [
          ownerSitting({
            n: 20,
            pickedPersona: 0.05,
            reasons: { word: 20 },
          }),
        ],
      }),
    );
    expect(report.conditions[1]?.satisfied).toBeNull();
    expect(report.unlocked).toBe(false);
  });

  it("puts the numbers into the printed lines", () => {
    const report = evaluateUnlockCheck(passingInput());
    const lines = formatUnlockCheck(report, "zh");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain("满足");
    expect(lines[0]).toContain("重排 开");
    expect(lines[1]).toContain("1 场");
    expect(lines[1]).toContain("30.0%");
    expect(lines[2]).toContain("「用词」9 条");
    expect(lines[3]).toContain("1200 条");
    expect(lines[6]).toBe("unlocked: true");
  });

  it("prints the discriminator as a reference, not as a condition", () => {
    const report = evaluateUnlockCheck(
      passingInput({
        persona: persona({
          styleProfile: {
            version: 1,
            measuredAt: "2026-01-01T00:00:00.000Z",
            recordsVersion: "1200:1200",
            discriminator: {
              pairs: 80,
              auc: 0.72,
              aucStd: 0.03,
              insufficient: false,
              tells: [
                { feature: "ending.period", weight: 0.9, side: "persona" },
                { feature: "呀", weight: -0.8, side: "real" },
              ],
            },
          },
        }),
      }),
    );
    const lines = formatUnlockCheck(report, "zh");
    expect(lines[4]).toContain("0.7200");
    expect(lines[5]).toContain("ending.period（归在句尾）");
    expect(lines[5]).toContain("呀（归在用词）");
    // The reference never changes the verdict.
    expect(report.unlocked).toBe(true);
  });

  it("says the discriminator was not trained when there is no report", () => {
    const report = evaluateUnlockCheck(
      passingInput({
        persona: persona({
          styleProfile: {
            version: 1,
            measuredAt: "",
            recordsVersion: "",
            discriminator: { pairs: 12, auc: 0, aucStd: 0, insufficient: true, tells: [] },
          },
        }),
      }),
    );
    const lines = formatUnlockCheck(report, "zh");
    expect(lines[4]).toBe("参考：判别器还没有量");
    expect(lines[5]).toBe("参考：判别器还没有特征权重");
  });

  it("prints the English lines too", () => {
    const report = evaluateUnlockCheck(passingInput({ sessions: [] }));
    const lines = formatUnlockCheck(report, "en");
    expect(lines[1]).toBe("In-app blind test: no data");
    expect(lines[2]).toBe("Blind-test reasons: no data");
    expect(lines[6]).toBe("unlocked: false");
  });
});

describe("tellCategory", () => {
  it("puts a tell into the family a person would recognise", () => {
    expect(tellCategory("ending.period")).toBe("ending");
    expect(tellCategory("particle")).toBe("particle");
    expect(tellCategory("chars")).toBe("length");
    expect(tellCategory("question")).toBe("punctuation");
    expect(tellCategory("newline")).toBe("layout");
    expect(tellCategory("呀")).toBe("wording");
    expect(tellCategory("好的")).toBe("wording");
  });
});

describe("the training machinery is not here", () => {
  it("has no adapter directory", () => {
    expect(existsSync(resolve(ROOT, "server/adapter"))).toBe(false);
  });

  it("has no training dependency", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    const training = names.filter((name) =>
      /(^|\/)(torch|transformers|peft|trl|onnx|onnxruntime|tensorflow|accelerate|bitsandbytes)(\/|$)/i.test(
        name,
      ),
    );
    expect(training).toEqual([]);
  });

  it("is wired into the eval command and answers from stored data", () => {
    const source = readFileSync(resolve(ROOT, "scripts/eval-run.ts"), "utf8");
    expect(source).toContain("--unlock-check");
    expect(source).toContain("evaluateUnlockCheck");
    expect(source).toContain("formatUnlockCheck");
    // It reads the blind sittings and the line count; it never opens a
    // provider.
    expect(source).toContain("listBlindSessions");
    expect(source).toContain("countRecords");
  });
});
