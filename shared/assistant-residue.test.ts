import { describe, expect, it } from "vitest";
import {
  EXEMPLAR_DICE_CEILING,
  exemplarDice,
  lengthCeiling,
  scoreResidue,
} from "./assistant-residue";

describe("assistant residue", () => {
  it("flags a question ending, a formula, a list, and a line that is too long", () => {
    const listed = scoreResidue("1. 先呼吸\n2. 再喝水\n3. 然后睡", { ceiling: 10 });
    expect(listed.listed).toBe(true);
    expect(listed.tooLong).toBe(true);
    expect(scoreResidue("你还好吗？").questionEnding).toBe(true);
    expect(scoreResidue("我理解你现在很难过。").emotionCliche).toBe(true);
  });

  it("needs a real sample before it names a length ceiling", () => {
    expect(lengthCeiling([1, 2, 3])).toBeNull();
    expect(lengthCeiling([4, 5, 6, 7, 8, 9, 10, 12, 40])).toBeGreaterThan(0);
  });

  it("throws out a candidate that is copying an exemplar", () => {
    const dice = exemplarDice("今天真的好开心呀", "今天真的好开心呀");
    expect(dice).toBeGreaterThan(EXEMPLAR_DICE_CEILING);
    expect(exemplarDice("风有点大", "今天真的好开心呀")).toBeLessThan(0.5);
  });
});
