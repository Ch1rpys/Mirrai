import { describe, expect, it } from "vitest";
import {
  measureFingerprint,
  type FingerprintRow,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import type { SparseModel } from "../eval/discriminator";
import { pickRerankWinner } from "./rerank";

/**
 * A counted profile with a period habit and short lines, for the
 * discriminator ranking test. The fixture itself is period-less.
 */
function flatFingerprint(overrides: Partial<StyleFingerprintCore> = {}): StyleFingerprintCore {
  return {
    samples: 200,
    length: { median: 3, p90: 4, p95: 8, histogram: [] },
    turnChars: { median: 3, p95: 8 },
    endings: {
      period: 0.2,
      ellipsis: 0,
      question: 0,
      exclaim: 0,
      tilde: 0,
      emoji: 0,
      particle: 0,
      other: 0.8,
    },
    particles: {},
    punctuation: {
      commaPerChar: 0.01,
      spaceAsComma: 0,
      ellipsisForms: { unicode: 0, dots: 0, cjkDots: 0 },
      exclaimRuns: [],
      questionRuns: [],
      halfWidthRate: 0.5,
      markCount: 0,
    },
    laugh: { rate: 0, forms: {}, haRuns: [] },
    reduplication: {},
    emoji: { rate: 0, perLine: 0, top: [] },
    kaomoji: { rate: 0 },
    latin: { rate: 0, abbreviations: {} },
    typoFix: { starRate: 0 },
    script: { traditionalRate: 0 },
    address: {},
    ...overrides,
  };
}

function fixtureFingerprint() {
  const rows: FingerprintRow[] = buildXiaomanRecords().map((row) => ({
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    kind: row.kind,
    emotion: row.truth.state,
    speaker: row.speaker,
  }));
  const fp = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
  if (!fp) throw new Error("fixture fingerprint missing");
  return fp;
}

function fixtureTexts(): string[] {
  return buildXiaomanRecords()
    .filter((row) => row.role === "assistant" && row.kind === "text")
    .map((row) => row.content);
}

describe("picking among four lines", () => {
  it("drops the one that copied an exemplar", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "今天真的好开心呀" },
        { text: "还行" },
        { text: "嗯" },
        { text: "在" },
      ],
      trainingTexts: ["嗯", "在", "还行", "随便", "好", "行", "哦", "嗯嗯"],
      exemplars: ["今天真的好开心呀"],
    });
    expect(result?.text).not.toBe("今天真的好开心呀");
    expect(result?.scores.find((row) => row.text === "今天真的好开心呀")?.discarded).toBe("exemplar");
  });

  it("does not pick the longest complete line when they write short", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "我完全理解你现在的感受，我们可以一步一步来，先深呼吸，然后把今天的事情列成三条。" },
        { text: "嗯" },
        { text: "在" },
        { text: "哦" },
      ],
      trainingTexts: ["嗯", "在", "哦", "好", "行", "随便", "嗯嗯", "还行"],
    });
    expect(result?.text.length ?? 99).toBeLessThan(10);
  });

  it("prefers a short line near their median over a likelier long one", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯" },
        { text: "嗯" },
        { text: "在呢" },
        { text: "好" },
      ],
      trainingTexts: ["嗯", "好", "在", "哦", "行", "嗯嗯", "随便", "还行"],
    });
    expect((result?.text.length ?? 99) <= 4).toBe(true);
  });
});

describe("fingerprint rerank", () => {
  it("does not pick a period line or a long question on the fixture", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "好的。" },
        { text: "好的" },
        { text: "好的呀" },
        { text: "我觉得这样挺好的，你觉得呢？" },
      ],
      trainingTexts: fixtureTexts(),
      fingerprint: fixtureFingerprint(),
      fingerprintRerank: true,
    });
    expect(result?.text).not.toBe("好的。");
    expect(result?.text).not.toBe("我觉得这样挺好的，你觉得呢？");
  });

  it("prefers 嗯 when the sampled act is acknowledge", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "我今天去了图书馆" },
        { text: "天气不错呢" },
        { text: "嗯" },
        { text: "随便吧" },
      ],
      trainingTexts: fixtureTexts(),
      fingerprint: fixtureFingerprint(),
      fingerprintRerank: true,
      sampledAct: "acknowledge",
    });
    expect(result?.text).toBe("嗯");
    expect(result?.scores.find((row) => row.text === "嗯")?.act).toBe(0);
    expect(result?.scores.find((row) => row.text === "我今天去了图书馆")?.act).toBe(1);
  });

  it("ranks a line the discriminator calls real above a period line", () => {
    const discriminator: SparseModel = {
      bias: 0,
      dense: { "ending.period": -8 },
      ngrams: [],
    };
    const result = pickRerankWinner({
      candidates: [
        { text: "好的。" },
        { text: "好的呀" },
        { text: "在的" },
        { text: "嗯嗯" },
      ],
      trainingTexts: fixtureTexts(),
      fingerprint: fixtureFingerprint(),
      fingerprintRerank: true,
      discriminator,
    });
    const period = result?.scores.find((row) => row.text === "好的。");
    const winner = result?.scores.find((row) => row.index === result.index);
    expect(result?.text).not.toBe("好的。");
    expect(winner?.real ?? 0).toBeGreaterThan(period?.real ?? 1);
  });

  it("moves a real line above the period line the score prefers", () => {
    const fingerprint = flatFingerprint();
    const candidates = [
      { text: "行的。" },
      { text: "行" },
      { text: "好的呀" },
      { text: "在的" },
    ];
    const trainingTexts = ["好的。", "好的。", "好的。", "嗯", "在", "哦", "好", "行", "随便", "还行", "嗯嗯", "在的", "好的呀"];
    const without = pickRerankWinner({
      candidates,
      trainingTexts,
      fingerprint,
      fingerprintRerank: true,
    });
    const discriminator: SparseModel = {
      bias: 0,
      dense: { "ending.period": -8 },
      ngrams: [],
    };
    const withDiscriminator = pickRerankWinner({
      candidates,
      trainingTexts,
      fingerprint,
      fingerprintRerank: true,
      discriminator,
    });
    // The period line wins on the counted features alone; the
    // discriminator's "a period is fake" call pushes it below.
    expect(without?.text).toBe("行的。");
    expect(withDiscriminator?.text).not.toBe("行的。");
    const period = withDiscriminator?.scores.find((row) => row.text === "行的。");
    const winner = withDiscriminator?.scores.find((row) => row.index === withDiscriminator.index);
    expect(winner?.real ?? 0).toBeGreaterThan(period?.real ?? 1);
  });
});
