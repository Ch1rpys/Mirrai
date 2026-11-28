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

  it("leaves a period in the middle of a bubble alone", () => {
    // The manual's rule is "the single 。 at the end of each bubble". The
    // implementation used to delete every ideographic period that was not
    // beside a digit — so a two-sentence reply lost its first full stop.
    expect(apply("好的。知道了", ready).text).toBe("好的。知道了");
    expect(apply("第一句。第二句。", ready).text).toBe("第一句。第二句");
    expect(apply("好的。", ready).text).toBe("好的");
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
  /**
   * The buckets are the way `measureFingerprint` stores them: bucket i
   * counts runs of i + 1 marks. `[0, 0, 10]` is ten runs of three — the
   * fixture here used to read it as "max two", one off from what the
   * measurement writes, which is exactly why the cap was wrong on real
   * fingerprints.
   */
  const ready = core({
    punctuation: { exclaimRuns: [0, 0, 10] } as StyleFingerprintCore["punctuation"],
  });

  it("caps a run longer than they ever used", () => {
    expect(apply("好的！！！！", ready).text).toBe("好的！！！");
    expect(apply("好的！！！！", ready).applied).toContain("exclaim_runs");
  });

  it("leaves a run within their max alone", () => {
    expect(apply("好的！！！", ready).text).toBe("好的！！！");
  });

  it("reads the measured bucket as a run length", () => {
    const fp = core({
      punctuation: { exclaimRuns: [0, 0, 0, 10] } as StyleFingerprintCore["punctuation"],
    });
    expect(apply("好的！！！！！", fp).text).toBe("好的！！！！");
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
    /**
     * The manual's acceptance example is "知道了。哈哈" with `strip_period`
     * applied, while the manual's own rule for `strip_period` is "the
     * single 。 at the end of every bubble" — the two disagree on this
     * input. The acceptance report settled it on the rule text, so the
     * period in the middle of the bubble stays, and the same sentence with
     * a period at the end loses that one.
     */
    const result = apply("知道了。哈哈", happy, "xiaoman-happy");
    expect(result.applied).toContain("laugh_runs");
    expect(result.applied).not.toContain("strip_period");
    expect(result.text).toMatch(/^知道了。哈{2,}$/);
    const withTail = apply("知道了。哈哈。", happy, "xiaoman-happy");
    expect(withTail.applied).toContain("strip_period");
    expect(withTail.applied).toContain("laugh_runs");
    expect(withTail.text).toMatch(/^知道了。哈{2,}$/);
  });

  it("keeps a distant period", () => {
    const { distant } = fixtureCore();
    const result = apply("随便。", distant);
    expect(result.text).toBe("随便。");
    expect(result.applied).not.toContain("strip_period");
  });

  /**
   * B3.4: `strip_emoji` used to run last, so every rule before it worked on
   * text that still carried the emoji. Removing the emoji afterwards
   * exposed a trailing tilde, a trailing period, a joined `哈` run, or a
   * comma now sitting between two Han characters — after the rule that
   * would have acted on them had already run. The first pass then stopped
   * at a different text than the second pass, so the projection was not
   * idempotent. These are the acceptance report's reproductions against
   * the fixture's happy-state fingerprint.
   */
  it("reaches one fixed point when an emoji hid a trailing tilde", () => {
    const { happy } = fixtureCore();
    const once = apply("好的~😊", happy, "b34-emoji-tilde");
    expect(once.text).toBe("好的");
    expect(once.applied).toContain("strip_emoji");
    expect(once.applied).toContain("strip_tilde");
    const twice = apply(once.text, happy, "b34-emoji-tilde");
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it("reaches one fixed point when an emoji hid a trailing period", () => {
    const { happy } = fixtureCore();
    const once = apply("好的。😊", happy, "b34-emoji-period");
    expect(once.text).toBe("好的");
    expect(once.applied).toContain("strip_emoji");
    expect(once.applied).toContain("strip_period");
    const twice = apply(once.text, happy, "b34-emoji-period");
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it("reaches one fixed point when an emoji split a laugh run", () => {
    const { happy } = fixtureCore();
    // The happy state's only non-zero `haRuns` bucket is length four, so a
    // run sampled from it is four 哈: the first pass has one expected
    // answer. The second pass must use the same seed and draw four again.
    const once = apply("哈😊哈", happy, "b34-emoji-laugh");
    expect(once.text).toBe("哈哈哈哈");
    expect(once.applied).toContain("strip_emoji");
    expect(once.applied).toContain("laugh_runs");
    const twice = apply(once.text, happy, "b34-emoji-laugh");
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it("reaches one fixed point when an emoji separated a comma from Han", () => {
    const { happy } = fixtureCore();
    const once = apply("好的,😊知道了", happy, "b34-emoji-comma");
    expect(once.text).toBe("好的 知道了");
    expect(once.applied).toContain("strip_emoji");
    expect(once.applied).toContain("comma_to_space");
    const twice = apply(once.text, happy, "b34-emoji-comma");
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it("settles a period and a tilde that expose each other", () => {
    // `strip_period` removes a period the happy state never writes, which
    // can leave a `~` at the end; `strip_tilde` removes the tilde, which can
    // leave a `。` at the end. Neither order alone reaches a fixed point for
    // both sentences, so the pipeline settles them before returning.
    const { happy } = fixtureCore();
    for (const line of ["好的。~", "好的~。"]) {
      const once = apply(line, happy);
      expect(once.text, line).toBe("好的");
      const twice = apply(once.text, happy);
      expect(twice.text, line).toBe(once.text);
      expect(twice.applied, line).toEqual([]);
    }
  });

  it("is idempotent across the reachable punctuation-width and comma combinations", () => {
    // A persona who writes "好的 知道了" (spaces where commas would go) and
    // almost never uses half-width marks is a reachable fingerprint. With
    // the rules ordered the old way, the first pass produced a full-width
    // comma and the second pass turned it into a space — so the text kept
    // moving between two shapes.
    const spaceAndFull = core({
      samples: 221,
      endings: { period: 0 } as StyleFingerprintCore["endings"],
      punctuation: {
        spaceAsComma: 1,
        commaPerChar: 0.001,
        halfWidthRate: 0.05,
        markCount: 40,
      } as StyleFingerprintCore["punctuation"],
    });
    for (const line of ["好的,知道了", "好的，知道了", "行吧,那就这样"]) {
      const once = apply(line, spaceAndFull);
      const twice = apply(once.text, spaceAndFull);
      expect(twice.text, line).toBe(once.text);
      expect(twice.applied, line).toEqual([]);
    }

    // The same fixed point the other way round: half-width marks plus
    // spaces for commas.
    const spaceAndHalf = core({
      samples: 221,
      endings: { period: 0 } as StyleFingerprintCore["endings"],
      punctuation: {
        spaceAsComma: 1,
        commaPerChar: 0.001,
        halfWidthRate: 0.95,
        markCount: 40,
      } as StyleFingerprintCore["punctuation"],
    });
    for (const line of ["好的，知道了", "行吧，那就这样"]) {
      const once = apply(line, spaceAndHalf);
      const twice = apply(once.text, spaceAndHalf);
      expect(twice.text, line).toBe(once.text);
      expect(twice.applied, line).toEqual([]);
    }
  });

  it("settles a long chain of trailing marks in one call", () => {
    // Each pass strips at most one trailing mark per bubble, so a chain
    // that alternates the two strip rules needs several passes. The
    // manual promises the projection is a fixed point; the cap must be
    // above a pathological chain, not just above ordinary punctuation.
    const { happy } = fixtureCore();
    const chain = `好的${"。~".repeat(8)}`;
    const once = apply(chain, happy, "xiaoman-happy");
    const twice = apply(once.text, happy, "xiaoman-happy");
    expect(once.text).toBe("好的");
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it("is idempotent on fifty fixture lines, some of which the rules change", () => {
    const { happy } = fixtureCore();
    const lines = buildXiaomanRecords()
      .filter((row) => row.role === "assistant" && row.kind === "text")
      .map((row) => row.content);
    // A seeded Fisher–Yates shuffle, so the fifty lines are a random sample
    // of the whole fixture rather than "the first fifty that pass a gate".
    // The overall fingerprint changes none of these lines (every habit it
    // measured is already what the rules would write), so the sample uses
    // the happy core — the fingerprint the acceptance report reproduced
    // against — which is what makes the run exercise a rule at all.
    const rng = seededRandom("pick-50");
    const order = lines.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const picked = order.slice(0, 50).map((index) => lines[index]!);
    expect(picked.length).toBe(50);
    let changed = 0;
    for (const line of picked) {
      const once = projectStyle(line, happy, seededRandom(line));
      const twice = projectStyle(once.text, happy, seededRandom(line));
      if (once.text !== line) changed += 1;
      expect(twice.text, line).toBe(once.text);
      expect(twice.applied, line).toEqual([]);
    }
    // Zero would mean "idempotent" was a statement about the identity
    // function: at this fixture/fingerprint five of the fifty end on a
    // period the happy state never writes, and `strip_period` changes them.
    expect(changed).toBeGreaterThan(0);
  });
});
