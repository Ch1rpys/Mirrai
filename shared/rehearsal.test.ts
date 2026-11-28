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

  it("recognises the manual's list in the words people actually type (C3.2)", () => {
    // The manual names the class — 还爱不爱, 原不原谅, 要不要复合,
    // 愿不愿意, 会不会回来, 是不是不要我了, and their English
    // counterparts. The first table only caught the phrasings written
    // down; these are the same questions in other words.
    for (const line of [
      "你爱不爱我",
      "你原不原谅我",
      "你要不要复合",
      "你愿不愿意再给我一次机会",
      "你还会不会回来",
      "你是不是已经不想要我了",
      "do you love me",
      "can you forgive me",
      "will you come back",
      "do you still want me",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("recognises the phrasings the acceptance found missed (C3.2)", () => {
    // Marriage proposals, "give me another chance" demands, and the
    // English "is it over" family. The room used to generate three
    // possibilities for these instead of refusing before any model call.
    for (const line of [
      "你会不会娶我",
      "我们结婚吧",
      "你愿意嫁给我吗",
      "我想和你结婚",
      "能不能给我一次机会",
      "再给我一次机会好吗",
      "你会等我吗",
      "你还会回来吗",
      "你还在乎我吗",
      "我们和好吧",
      "原谅我吧",
      "is it over",
      "give me another chance",
      "will you wait for me",
      "do you still care",
      "do you want me back",
      "would you take me back",
      "can we get back together",
      "are we over",
      "will you marry me",
      "let's get married",
    ]) {
      expect(isCommitmentQuestion(line), line).toBe(true);
    }
  });

  it("does not treat an ordinary question as a verdict", () => {
    for (const line of [
      "我今天很想你",
      "对不起 那天我不该那样说",
      "你今天忙吗",
      "晚安",
      // The widened table must not swallow ordinary words: a wedding is
      // something one attends, "love" takes an object, and "回来" is
      // followed by another verb in a schedule question.
      "今天去参加朋友的婚礼",
      "我们参加婚礼吧",
      "他在婚礼上哭了",
      "I love this song",
      "I love this movie",
      "你会回来吃饭吗",
      "你什么时候回来",
      "你愿意给我带杯咖啡吗",
      "我好喜欢这首歌",
    ]) {
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
      "我们分手吧",
      "我不会离开你",
      "我会娶你",
      "我们结婚吧",
      "我永远都在",
      "i forgive you",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("catches the second-gate phrasings that answer for the person (C3.2)", () => {
    /**
     * The first gate refuses the question; the second stops the model
     * from promising in the retry. The retry guard used to know only the
     * manual's own examples, so the same promise in other words got
     * through. These all decide something only the real person may
     * decide.
     */
    for (const reply of [
      "我会原谅你",
      "我决定原谅你",
      "我愿意再试一次",
      "我同意和好",
      "我决定分手",
      "我们重新开始吧",
      "我不恨你了",
      "我会等你",
      "我一直陪着你",
      "我给你一次机会",
      "我依然爱你",
      "我们在一起吧",
      "我们分开吧",
      "我们还是做朋友吧",
      "I'll give you another chance",
      "I'll wait for you",
      "I still have feelings for you",
      "we can start over",
      "let's try again",
      "I'm not angry anymore",
      "I'll always love you",
      "I'll marry you",
      "let's get married",
      "I promise",
    ]) {
      expect(containsCommitment(reply), reply).toBe(true);
    }
  });

  it("lets an ordinary reply through", () => {
    for (const reply of [
      "嗯",
      "我在",
      "今天好累",
      "我也想你了",
      "晚安",
      "I love this song",
      "今天去参加朋友的婚礼",
      "我最近在学做饭",
      "这首歌真好听",
    ]) {
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
