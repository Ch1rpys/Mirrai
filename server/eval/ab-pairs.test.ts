import { describe, expect, it } from "vitest";
import {
  CHOICE_MIN_PAIRS,
  featuresOfLine,
  fingerprintFromPersona,
  matchesChoicePair,
  pendingChoiceOf,
  shouldOfferChoice,
  trainRerankWeights,
  type ChoiceFeatures,
} from "./ab-pairs";

function feats(length: number): ChoiceFeatures {
  return { ll: 0, length, surprise: 0.1, residue: 0, act: 0, real: 0.5 };
}

/**
 * A fingerprint and a discriminator with the shape `measureStyleProfile`
 * and B8.1 write. The values are arbitrary; only their presence matters
 * here — a line measured against them gets a non-default surprise and a
 * discriminator score that is not 0.5.
 */
function measuredProfile() {
  return {
    version: 1 as const,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "300:300",
    fingerprint: {
      samples: 300,
      length: { median: 8, p90: 12, p95: 20, histogram: [] },
      turnChars: { median: 10, p95: 24 },
      endings: {
        period: 0.2,
        ellipsis: 0,
        question: 0.1,
        exclaim: 0,
        tilde: 0.1,
        emoji: 0,
        particle: 0.5,
        other: 0.1,
      },
      particles: { "呀": 0.8, none: 0.2 },
      punctuation: {
        commaPerChar: 0.1,
        spaceAsComma: 0,
        ellipsisForms: { unicode: 0, dots: 0, cjkDots: 0 },
        exclaimRuns: [],
        questionRuns: [],
        halfWidthRate: 0.5,
        markCount: 40,
      },
      laugh: { rate: 0, forms: {}, haRuns: [] },
      reduplication: {},
      emoji: { rate: 0, perLine: 0, top: [] },
      kaomoji: { rate: 0 },
      latin: { rate: 0, abbreviations: {} },
      typoFix: { starRate: 0 },
      script: { traditionalRate: 0 },
      address: {},
    },
    discriminator: {
      model: { bias: 0.4, ngrams: [{ gram: "好", weight: 2 }], dense: {} },
    },
  };
}

describe("the A/B choice pairs", () => {
  it("offers a pair on the eighth web turn when the switch is on", () => {
    expect(
      shouldOfferChoice({ chatCount: 8, settings: { layers: { abPairs: true } } }),
    ).toBe(true);
    expect(
      shouldOfferChoice({ chatCount: 8, settings: { layers: { abPairs: true } } }, "web"),
    ).toBe(true);
  });

  it("does not offer a pair when the switch is off, the count is not a multiple of eight, or the turn is on a channel", () => {
    expect(shouldOfferChoice({ chatCount: 8 })).toBe(false);
    expect(
      shouldOfferChoice({ chatCount: 7, settings: { layers: { abPairs: true } } }),
    ).toBe(false);
    expect(
      shouldOfferChoice({ chatCount: 0, settings: { layers: { abPairs: true } } }),
    ).toBe(false);
    expect(
      shouldOfferChoice(
        { chatCount: 8, settings: { layers: { abPairs: true } } },
        "wechat",
      ),
    ).toBe(false);
    expect(
      shouldOfferChoice(
        { chatCount: 8, settings: { layers: { abPairs: true } } },
        "feishu",
      ),
    ).toBe(false);
  });

  it("counts characters as the length feature", () => {
    expect(featuresOfLine("好的呀", {}).length).toBe(3);
  });

  it("accepts either order of the two offered lines", () => {
    expect(matchesChoicePair("a", "b", ["a", "b"])).toBe(true);
    expect(matchesChoicePair("b", "a", ["a", "b"])).toBe(true);
    expect(matchesChoicePair("a", "c", ["a", "b"])).toBe(false);
  });

  it("reads a pending pair off message metadata", () => {
    const pending = pendingChoiceOf({
      pendingChoice: {
        options: ["好的呀", "好的。"],
        features: [feats(3), feats(3)],
        sampledAct: "acknowledge",
      },
    });
    expect(pending?.options).toEqual(["好的呀", "好的。"]);
    expect(pending?.sampledAct).toBe("acknowledge");
  });

  it("trains a negative length weight when the user always picks the shorter line", () => {
    const pairs = Array.from({ length: CHOICE_MIN_PAIRS }, (_, i) => ({
      chosen: feats(4 + (i % 3)),
      rejected: feats(28 + i),
    }));
    const weights = trainRerankWeights(pairs, "always-short");
    expect(weights).not.toBeNull();
    expect(weights!.length).toBeLessThan(0);
  });

  it("reads the effective profile, so a disabled fingerprint or discriminator adds no feature", () => {
    const styleProfile = measuredProfile();

    // Control: nothing is turned off, so both measurements are read.
    const readable = fingerprintFromPersona({ styleProfile, settings: {} });
    expect(readable.fingerprint).not.toBeNull();
    expect(readable.discriminator).not.toBeNull();
    const withMeasurements = featuresOfLine("好的呀", readable);
    expect(withMeasurements.surprise).not.toBe(0);
    expect(withMeasurements.real).not.toBe(0.5);

    /*
     * The user said「不用这一项」for the fingerprint and the
     * discriminator (C10.6). The pair's features must be produced from
     * the effective profile — the same one the rest of the generation
     * path reads — not from the stored one. Before the fix this call
     * read `persona.styleProfile` directly and returned the disabled
     * fingerprint anyway.
     */
    const disabled = fingerprintFromPersona({
      styleProfile,
      settings: { disabledProfiles: ["fingerprint", "discriminator"] },
    });
    expect(disabled).toEqual({ fingerprint: null, discriminator: null });
    const withoutMeasurements = featuresOfLine("好的呀", disabled);
    expect(withoutMeasurements.surprise).toBe(0);
    expect(withoutMeasurements.real).toBe(0.5);
  });

  it("leaves the other profile keys alone when only two are disabled", () => {
    const profile = fingerprintFromPersona({
      styleProfile: measuredProfile(),
      settings: { disabledProfiles: ["fingerprint"] },
    });
    // Disabling one key must not take the other measurement with it.
    expect(profile.fingerprint).toBeNull();
    expect(profile.discriminator).not.toBeNull();
  });
});
