import { describe, expect, it } from "vitest";
import {
  CHOICE_MIN_PAIRS,
  featuresOfLine,
  matchesChoicePair,
  pendingChoiceOf,
  shouldOfferChoice,
  trainRerankWeights,
  type ChoiceFeatures,
} from "./ab-pairs";

function feats(length: number): ChoiceFeatures {
  return { ll: 0, length, surprise: 0.1, residue: 0, act: 0, real: 0.5 };
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
});
