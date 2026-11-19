import { describe, expect, it } from "vitest";
import { projectStyle, type ProjectionRule } from "./style-projection";
import {
  measureFingerprint,
  type FingerprintRow,
  type StyleFingerprintCore,
} from "./style-fingerprint";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { seededRandom } from "../server/_core/behavior-profile";

function core(overrides: Partial<StyleFingerprintCore> = {}): StyleFingerprintCore {
  const {
    punctuation,
    laugh,
    emoji,
    endings,
    ...rest
  } = overrides;
  return {
    samples: 0,
    length: { median: 0, p90: 0, p95: 0, histogram: [] },
    turnChars: { median: 0, p95: 0 },
    endings: {
      period: 0.5,
      ellipsis: 0,
      question: 0,
      exclaim: 0,
      tilde: 0.5,
      emoji: 0,
      particle: 0,
      other: 0,
      ...endings,
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
      ...punctuation,
    },
    laugh: { rate: 0, forms: {}, haRuns: [], ...laugh },
    reduplication: {},
    emoji: { rate: 0.2, perLine: 0.2, top: [], ...emoji },
    kaomoji: { rate: 0 },
    latin: { rate: 0, abbreviations: {} },
    typoFix: { starRate: 0 },
    script: { traditionalRate: 0 },
    address: {},
    ...rest,
  };
}

function apply(
  text: string,
  fp: StyleFingerprintCore,
  seed = "proj",
): { text: string; applied: ProjectionRule[] } {
  return projectStyle(text, fp, seededRandom(seed));
}

describe("strip_period", () => {
  const ready = core({ samples: 100, endings: { period: 0 } as StyleFingerprintCore["endings"] });

  it("strips a trailing ideographic period", () => {
    expect(apply("好的。", ready).text).toBe("好的");
    expect(apply("好的。", ready).applied).toContain("strip_period");
  });

  it("strips a trailing ascii period that is not an abbreviation", () => {
    expect(apply("好的.", ready).text).toBe("好的");
  });

  it("does not fire when there are too few samples", () => {
    const fp = core({ samples: 99, endings: { period: 0 } as StyleFingerprintCore["endings"] });
    expect(apply("好的。", fp).applied).not.toContain("strip_period");
    expect(apply("好的。", fp).text).toBe("好的。");
  });

  it("leaves ellipsis, decimals, and abbreviations alone", () => {
    expect(apply("好的...", ready).text).toBe("好的...");
    expect(apply("好的…", ready).text).toBe("好的…");
    expect(apply("3.5", ready).text).toBe("3.5");
    expect(apply("3。5", ready).text).toBe("3。5");
    expect(apply("e.g.", ready).text).toBe("e.g.");
    expect(apply("Mr.", ready).text).toBe("Mr.");
    expect(apply("Dr.", ready).text).toBe("Dr.");
    expect(apply("etc.", ready).text).toBe("etc.");
    expect(apply("Jan.", ready).text).toBe("Jan.");
    expect(apply("See you.", ready).text).toBe("See you");
    expect(apply("https://a.b/c.", ready).text).toBe("https://a.b/c.");
  });
});

describe("strip_tilde", () => {
  const ready = core({ samples: 100, endings: { tilde: 0 } as StyleFingerprintCore["endings"] });

  it("strips a trailing tilde", () => {
    expect(apply("好呀~", ready).text).toBe("好呀");
    expect(apply("好呀～", ready).text).toBe("好呀");
    expect(apply("好呀~", ready).applied).toContain("strip_tilde");
  });

  it("does not fire when they actually end on a tilde", () => {
    const fp = core({ samples: 100, endings: { tilde: 0.2 } as StyleFingerprintCore["endings"] });
    expect(apply("好呀~", fp).text).toBe("好呀~");
  });

  it("does not fire without enough samples", () => {
    const fp = core({ samples: 40, endings: { tilde: 0 } as StyleFingerprintCore["endings"] });
    expect(apply("好呀~", fp).applied).not.toContain("strip_tilde");
  });
});

describe("laugh_runs", () => {
  const ready = core({
    laugh: { rate: 0.2, forms: {}, haRuns: [0, 0, 0, 0, 12] },
  });

  it("rewrites a short run to a sampled length", () => {
    const result = apply("哈哈", ready, "ha");
    expect(result.text).toMatch(/^哈{2,}$/);
    expect(result.applied).toContain("laugh_runs");
    expect(result.text).not.toBe("哈哈");
  });

  it("does not fire when there are fewer than ten runs", () => {
    const fp = core({ laugh: { rate: 0.1, forms: {}, haRuns: [0, 0, 0, 0, 9] } });
    expect(apply("哈哈", fp).text).toBe("哈哈");
  });

  it("leaves a single 哈 alone", () => {
    expect(apply("哈", ready).text).toBe("哈");
  });
});

describe("ellipsis_form", () => {
  const dots = core({
    punctuation: {
      ellipsisForms: { unicode: 0, dots: 20, cjkDots: 1 },
    } as StyleFingerprintCore["punctuation"],
  });

  it("rewrites other ellipses into the dominant form", () => {
    expect(apply("好的…", dots).text).toBe("好的...");
    expect(apply("好的。。。", dots).text).toBe("好的...");
    expect(apply("好的…", dots).applied).toContain("ellipsis_form");
  });

  it("does not fire when no form dominates", () => {
    const fp = core({
      punctuation: {
        ellipsisForms: { unicode: 8, dots: 8, cjkDots: 8 },
      } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的…", fp).text).toBe("好的…");
  });

  it("does not fire when there are fewer than ten ellipses", () => {
    const fp = core({
      punctuation: {
        ellipsisForms: { unicode: 0, dots: 9, cjkDots: 0 },
      } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的…", fp).text).toBe("好的…");
  });
});

describe("exclaim_runs", () => {
  const ready = core({
    punctuation: { exclaimRuns: [0, 0, 10] } as StyleFingerprintCore["punctuation"],
  });

  it("caps a run longer than they ever used", () => {
    expect(apply("好的！！！！", ready).text).toBe("好的！！");
    expect(apply("好的！！！！", ready).applied).toContain("exclaim_runs");
  });

  it("leaves a run within their max alone", () => {
    expect(apply("好的！！", ready).text).toBe("好的！！");
  });

  it("does not fire without enough marks", () => {
    const fp = core({
      punctuation: { exclaimRuns: [0, 0, 3] } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的！！！！", fp).text).toBe("好的！！！！");
  });
});

describe("comma_to_space", () => {
  const ready = core({
    samples: 200,
    punctuation: {
      spaceAsComma: 0.7,
      commaPerChar: 0.001,
    } as StyleFingerprintCore["punctuation"],
  });

  it("turns a Chinese comma between two Han characters into a space", () => {
    expect(apply("好的，知道了", ready).text).toBe("好的 知道了");
    expect(apply("好的，知道了", ready).applied).toContain("comma_to_space");
  });

  it("does not fire when they actually use commas", () => {
    const fp = core({
      samples: 200,
      punctuation: {
        spaceAsComma: 0.1,
        commaPerChar: 0.01,
      } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的，知道了", fp).text).toBe("好的，知道了");
  });

  it("leaves a comma next to a digit alone", () => {
    expect(apply("1，2", ready).text).toBe("1，2");
  });
});

describe("strip_emoji", () => {
  const ready = core({ samples: 200, emoji: { rate: 0, perLine: 0, top: [] } });

  it("strips an emoji", () => {
    expect(apply("好的😊", ready).text).toBe("好的");
    expect(apply("好的😊", ready).applied).toContain("strip_emoji");
  });

  it("does not fire when they use emoji", () => {
    const fp = core({ samples: 200, emoji: { rate: 0.05, perLine: 0.05, top: [] } });
    expect(apply("好的😊", fp).text).toBe("好的😊");
  });

  it("does not fire without enough samples", () => {
    const fp = core({ samples: 100, emoji: { rate: 0, perLine: 0, top: [] } });
    expect(apply("好的😊", fp).applied).not.toContain("strip_emoji");
  });
});

describe("punct_width", () => {
  const half = core({
    punctuation: { halfWidthRate: 0.95, markCount: 40 } as StyleFingerprintCore["punctuation"],
  });
  const full = core({
    punctuation: { halfWidthRate: 0.05, markCount: 40 } as StyleFingerprintCore["punctuation"],
  });

  it("unifies to half-width when they almost always use it", () => {
    expect(apply("好的，是吗？真的！", half).text).toBe("好的,是吗?真的!");
    expect(apply("好的，是吗？真的！", half).applied).toContain("punct_width");
  });

  it("unifies to full-width when they almost never use half-width", () => {
    expect(apply("好的,是吗?真的!", full).text).toBe("好的，是吗？真的！");
  });

  it("does not fire without thirty marks", () => {
    const fp = core({
      punctuation: { halfWidthRate: 0.95, markCount: 29 } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的？", fp).text).toBe("好的？");
  });
});

describe("the fixture fingerprint", () => {
  function fixtureCore(): { overall: StyleFingerprintCore; happy: StyleFingerprintCore; distant: StyleFingerprintCore } {
    const rows: FingerprintRow[] = buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      emotion: row.truth.state,
      speaker: row.speaker,
    }));
    const fp = measureFingerprint(rows, { addressForms: ["陈树", "树树"] });
    if (!fp?.perState?.happy || !fp.perState.distant) {
      throw new Error("fixture fingerprint missing per-state cores");
    }
    return { overall: fp, happy: fp.perState.happy, distant: fp.perState.distant };
  }

  it("projects 知道了。哈哈 the way the happy state writes", () => {
    const { happy } = fixtureCore();
    const result = apply("知道了。哈哈", happy, "xiaoman-happy");
    expect(result.applied).toContain("strip_period");
    expect(result.applied).toContain("laugh_runs");
    expect(result.text).toMatch(/^知道了哈{2,}$/);
    expect(result.text).not.toContain("。");
  });

  it("keeps a distant period", () => {
    const { distant } = fixtureCore();
    const result = apply("随便。", distant);
    expect(result.text).toBe("随便。");
    expect(result.applied).not.toContain("strip_period");
  });

  it("is idempotent on fifty fixture lines with the same seed", () => {
    const { overall } = fixtureCore();
    const lines = buildXiaomanRecords()
      .filter((row) => row.role === "assistant" && row.kind === "text")
      .map((row) => row.content);
    const rng = seededRandom("pick-50");
    const picked: string[] = [];
    for (const line of lines) {
      if (picked.length >= 50) break;
      if (rng() < 0.04) picked.push(line);
    }
    expect(picked.length).toBe(50);
    for (const line of picked) {
      const once = projectStyle(line, overall, seededRandom(line));
      const twice = projectStyle(once.text, overall, seededRandom(line));
      expect(twice.text).toBe(once.text);
    }
  });
});
