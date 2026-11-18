import { describe, expect, it } from "vitest";
import { measureFingerprint, type FingerprintRow } from "@shared/style-fingerprint";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import type { SparseModel } from "../eval/discriminator";
import { pickRerankWinner } from "./rerank";

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
      trainingTexts: Array.from({ length: 40 }, (_, i) =>
        i % 3 === 0 ? "嗯" : i % 3 === 1 ? "好" : "在",
      ),
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
});
