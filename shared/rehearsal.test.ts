import { describe, expect, it } from "vitest";
import {
  containsCommitment,
  isCommitmentQuestion,
  topRehearsalActs,
} from "./rehearsal";

describe("isCommitmentQuestion", () => {
  it("recognises the questions only the person can answer", () => {
    for (const line of [
      "你还爱我吗",
      "能原谅我吗",
      "我们还能复合吗",
      "你愿不愿意再试一次",
      "你会不会回来",
      "你是不是不要我了",
      "do you still love me",
      "will you forgive me",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("does not treat an ordinary question as a verdict", () => {
    for (const line of ["我今天很想你", "对不起 那天我不该那样说", "你今天忙吗", "晚安"]) {
      expect(isCommitmentQuestion(line), line).toBe(false);
    }
  });
});

describe("containsCommitment", () => {
  it("catches a reply that promises or decides", () => {
    for (const reply of [
      "我原谅你",
      "我们复合吧",
      "我答应你",
      "我还爱你",
      "我不爱你了",
      "i forgive you",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("lets an ordinary reply through", () => {
    for (const reply of ["嗯", "我在", "今天好累", "我也想你了", "晚安"]) {
      expect(containsCommitment(reply), reply).toBe(false);
    }
  });
});

describe("topRehearsalActs", () => {
  it("takes the three most likely acts above the floor", () => {
    const result = topRehearsalActs({
      acknowledge: 40,
      comfort: 30,
      deflect: 20,
      tease: 5,
      silence: 5,
    });
    expect(result.map((entry) => entry.act)).toEqual(["acknowledge", "comfort", "deflect"]);
    expect(result.every((entry) => entry.share >= 0.1)).toBe(true);
  });

  it("does not add up past one after rounding", () => {
    const result = topRehearsalActs({ acknowledge: 34, comfort: 33, silence: 33 });
    const total = result.reduce((sum, entry) => sum + entry.share, 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it("returns nothing for an empty distribution", () => {
    expect(topRehearsalActs(null)).toEqual([]);
    expect(topRehearsalActs({})).toEqual([]);
    expect(topRehearsalActs({ silence: 0 })).toEqual([]);
  });
});
