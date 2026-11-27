import { beforeEach, describe, expect, it } from "vitest";
import {
  CRISIS_FLOOR,
  CRISIS_EXEMPLARS,
  SAFE_EXEMPLARS,
  SAFE_MARGIN,
  detectCrisisSemantic,
  maxCosine,
  resetCrisisSemanticCache,
  type SemanticEmbedFn,
} from "./crisis-semantic";
import { detectCrisisExtended } from "./crisis-extended";

/** A fake embedder whose vectors a test sets by hand. */
const CRISIS_SET = new Set<string>(CRISIS_EXEMPLARS);
const SAFE_SET = new Set<string>(SAFE_EXEMPLARS);

function fakeEmbed(userVector: number[] | null): SemanticEmbedFn {
  return async (texts) =>
    texts.map((text) => {
      if (CRISIS_SET.has(text)) return [1, 0, 0];
      if (SAFE_SET.has(text)) return [0, 1, 0];
      return userVector ?? [0, 1, 0];
    });
}

const nullEmbed: SemanticEmbedFn = async () => null;

describe("detectCrisisSemantic", () => {
  beforeEach(() => {
    resetCrisisSemanticCache();
  });

  it("raises a weak signal for a sentence between the groups", async () => {
    const result = await detectCrisisSemantic("我不想再醒来了", {
      embed: fakeEmbed([0.9, 0.4359, 0]),
      awaitCorpus: true,
    });
    expect(result.matched).toBe(true);
    expect(result.reason).toBe("matched");
    expect(result.crisisSimilarity).toBeGreaterThanOrEqual(CRISIS_FLOOR);
    expect(result.crisisSimilarity! - result.safeSimilarity!).toBeGreaterThanOrEqual(SAFE_MARGIN);
  });

  it("does not raise one just below the floor", async () => {
    const result = await detectCrisisSemantic("我不想再醒来了", {
      embed: fakeEmbed([0.69, 0.7238, 0]),
      awaitCorpus: true,
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("below_floor");
    expect(result.crisisSimilarity).toBeLessThan(CRISIS_FLOOR);
  });

  it("does not raise one that is close to both groups", async () => {
    // cosines 0.730 / 0.683: above the floor, but the gap is 0.047.
    const result = await detectCrisisSemantic("我不想再醒来了", {
      embed: fakeEmbed([0.73, 0.683, 0.0245]),
      awaitCorpus: true,
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("too_close");
  });

  it("is absent when the local model is not there", async () => {
    const result = await detectCrisisSemantic("我不想再醒来了", {
      embed: nullEmbed,
      awaitCorpus: true,
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("unavailable");
    expect(result.crisisSimilarity).toBeNull();
  });

  it("gives the same verdict as having no layer when the model is not there", async () => {
    const message = "我不想再醒来了";
    const withLayer = await detectCrisisExtended(message, {
      semantic: { embed: nullEmbed, awaitCorpus: true },
    });
    resetCrisisSemanticCache();
    const withoutLayer = await detectCrisisExtended(message, { semantic: false });
    expect(withLayer).toEqual(withoutLayer);
  });

  it("does not hold the turn when the model does not answer", async () => {
    let corpusDone = false;
    const stuckEmbed: SemanticEmbedFn = async (texts) => {
      if (texts.length > 1) {
        corpusDone = true;
        return texts.map((text) => (CRISIS_SET.has(text) ? [1, 0, 0] : [0, 1, 0]));
      }
      return new Promise<number[][]>(() => undefined);
    };
    const warm = await detectCrisisSemantic("我不想再醒来了", {
      embed: stuckEmbed,
      awaitCorpus: true,
      timeoutMs: 20,
    });
    expect(corpusDone).toBe(true);
    const started = Date.now();
    const result = await detectCrisisSemantic("我真的撑不住了", {
      embed: stuckEmbed,
      timeoutMs: 20,
    });
    const elapsed = Date.now() - started;
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("timeout");
    expect(elapsed).toBeLessThan(300);
    expect(warm.matched).toBe(false);
  });

  it("ignores an empty message", async () => {
    const result = await detectCrisisSemantic("   ", {
      embed: fakeEmbed([0.9, 0.4359, 0]),
      awaitCorpus: true,
    });
    expect(result.matched).toBe(false);
    expect(result.reason).toBe("unavailable");
  });

  it("measures similarity with the largest cosine in the group", () => {
    expect(maxCosine([1, 0, 0], [[0, 1, 0], [1, 0, 0]])).toBeCloseTo(1, 6);
    expect(maxCosine([0.6, 0.8, 0], [[1, 0, 0]])).toBeCloseTo(0.6, 6);
    expect(maxCosine([1, 0, 0], [])).toBe(-1);
  });
});
