import { describe, expect, it } from "vitest";
import {
  detectIndirectCrisis,
  hasMultipleReasons,
  hasPlanWithReason,
  INDIRECT_FAMILIES,
} from "./crisis-indirect";
import { detectCrisisExtended } from "./crisis-extended";

/**
 * The five positive examples per family, per language.
 *
 * Each family is one *kind* of statement. The examples below are the
 * ways it actually gets written: the same sentence with a different
 * pronoun, a different tense, a different amount of detail.
 */
const POSITIVES: Record<string, { zh: string[]; en: string[] }> = {
  cant_wake: {
    zh: ["不想醒来", "真的不想再醒来了", "一睡不醒也挺好", "睡过去就好了", "不想再面对明天"],
    en: [
      "I don't want to wake up",
      "I don't want to see tomorrow",
      "I wish I could sleep forever",
      "I want to sleep and never wake up",
      "I hope I never wake up again",
    ],
  },
  burden: {
    zh: ["没有我大家会更好", "我就是个累赘", "我只会拖累你们", "我活着只会给爸妈添麻烦", "要是从来没有我就好了"],
    en: [
      "everyone would be better off without me",
      "everybody would be better off if I wasn't here",
      "I'm just a burden to everyone around me",
      "I only drag everyone down",
      "I just cause trouble for everyone",
    ],
  },
  cant_go_on: {
    zh: ["我撑不下去了", "真的熬不住了", "我觉得我到极限了", "我没法继续下去了", "我已经到崩溃边缘了"],
    en: [
      "I can't go on",
      "I cannot take it anymore",
      "I can't take it anymore",
      "I'm at the end of my rope",
      "I've reached my limit",
    ],
  },
  disappear: {
    zh: ["我想消失", "我想从这个世界消失", "我不想存在了", "当我不存在就好", "我不属于这里"],
    en: [
      "I want to disappear",
      "I wish I didn't exist",
      "I wish I had never been born",
      "I want to be gone",
      "I wish I wasn't here",
    ],
  },
  farewell: {
    zh: ["以后你们要好好的", "以后照顾好自己", "这是我最后一次跟你说这些了", "我的东西都留给你吧", "以后别为我难过"],
    en: [
      "take care of yourself",
      "I've left instructions for everything",
      "this is the last time I'll write to you",
      "I won't be around anymore",
      "don't be sad for too long",
    ],
  },
  plan: {
    zh: ["安眠药已经买好了", "我已经选好了地方", "具体时间定在下周三", "今晚就动手", "我知道该怎么结束"],
    en: [
      "I bought the pills",
      "I've picked the place already",
      "I've set the date",
      "tonight's the night",
      "I know how I'd end it",
    ],
  },
};

describe("detectIndirectCrisis", () => {
  it("covers every family with five positive examples in each language", () => {
    for (const family of INDIRECT_FAMILIES) {
      const examples = POSITIVES[family];
      expect(examples, `missing examples for ${family}`).toBeTruthy();
      for (const text of [...examples!.zh, ...examples!.en]) {
        const detection = detectIndirectCrisis(text);
        expect(
          detection.families,
          `"${text}" should belong to ${family}`,
        ).toContain(family);
      }
    }
  });

  it("keeps the keyword verdict for the sentence the older pass missed (C10.2)", async () => {
    // 「我很累，也不想活了」 is the one positive of the older suite the
    // re-assertion pass skipped: tiredness and the wish not to live in
    // one sentence.
    const result = await detectCrisisExtended("我很累，也不想活了", { semantic: false });
    expect(result.crisis).toBe(true);
    expect(result.matched.length).toBeGreaterThan(0);
  });

  it("raises at least a weak signal for one family", async () => {
    /**
     * Some of these sentences are also in the keyword list
     * ("不想再醒来", "撑不下去"). The keyword check is the stronger
     * verdict, and the point of the layer is that the person is *heard*
     * either way — so this asserts a signal, not which layer gave it.
     */
    for (const family of INDIRECT_FAMILIES) {
      const examples = POSITIVES[family];
      for (const text of [...examples!.zh, ...examples!.en]) {
        const result = await detectCrisisExtended(text, { semantic: false });
        expect(
          result.crisis || result.weakSignal,
          `"${text}" should raise at least a weak signal`,
        ).toBe(true);
      }
    }
  });

  it("leaves a single family that the keyword list does not know as a weak signal", async () => {
    const keywordFree = [
      "我就是个累赘",
      "我只会拖累你们",
      "以后你们要好好的",
      "以后别为我难过",
      "今晚就动手",
      "I'm just a burden to everyone around me",
      "I only drag everyone down",
      "take care of yourself",
      "tonight's the night",
      "I've picked the place already",
    ];
    for (const text of keywordFree) {
      const result = await detectCrisisExtended(text, { semantic: false });
      expect(result.crisis, `"${text}" should not be a crisis`).toBe(false);
      expect(result.weakSignal, `"${text}" should be a weak signal`).toBe(true);
    }
  });

  it("turns two different families into a crisis", async () => {
    const result = await detectCrisisExtended(
      "我觉得自己就是个累赘，以后你们要好好的",
      { semantic: false },
    );
    expect(result.indirectFamilies).toEqual(["burden", "farewell"]);
    expect(result.crisis).toBe(true);
    expect(result.weakSignal).toBe(false);
    expect(result.raisedBy).toBe("families");

    const english = await detectCrisisExtended(
      "I'm just a burden to everyone, and take care of yourself",
      { semantic: false },
    );
    expect(english.crisis).toBe(true);
    expect(english.raisedBy).toBe("families");
  });

  it("turns one family plus a plan into a crisis", async () => {
    const result = await detectCrisisExtended("我就是个累赘，地方我已经选好了", {
      semantic: false,
    });
    expect(result.indirectFamilies).toEqual(["burden", "plan"]);
    expect(result.crisis).toBe(true);
    expect(result.weakSignal).toBe(false);
    expect(result.raisedBy).toBe("plan");

    const english = await detectCrisisExtended(
      "I'm a burden to everyone. I've set the date.",
      { semantic: false },
    );
    expect(english.crisis).toBe(true);
    expect(english.raisedBy).toBe("plan");
  });

  it("keeps a plan on its own a weak signal", async () => {
    const result = await detectCrisisExtended("今晚就动手", { semantic: false });
    expect(result.crisis).toBe(false);
    expect(result.weakSignal).toBe(true);
    expect(result.raisedBy).toBeNull();
  });

  it("reads traditional Chinese as the same words", async () => {
    const result = await detectCrisisExtended("我不想再醒過來了", { semantic: false });
    expect(result.weakSignal).toBe(true);
    expect(result.indirectFamilies).toContain("cant_wake");
  });

  it("hears the hopeful ways of saying they do not want to wake up (C10.2)", async () => {
    const hopeful = [
      "我希望明天不用醒来",
      "真希望自己明天不用睁开眼睛",
      "我好像醒不过来了",
      "我不想再睁开眼睛",
    ];
    for (const text of hopeful) {
      const detection = detectIndirectCrisis(text);
      expect(detection.families, `"${text}" should belong to cant_wake`).toContain("cant_wake");
      const result = await detectCrisisExtended(text, { semantic: false });
      expect(result.crisis || result.weakSignal, `"${text}" should raise a signal`).toBe(true);
    }
    // The same shapes of sentence about ordinary life are not this family.
    for (const text of ["希望明天不用上班", "我希望明天不用早起", "他喝多了醒不过来"]) {
      expect(detectIndirectCrisis(text).families, `"${text}" should match no family`).toEqual([]);
      const result = await detectCrisisExtended(text, { semantic: false });
      expect(result.crisis, `"${text}" should not be a crisis`).toBe(false);
    }
  });

  it("does not fire on ordinary daily lines", async () => {
    const ordinary = [
      "今天加班到九点",
      "周末去看电影吧",
      "这家店的面很好吃",
      "地铁上人好多",
      "明天要早起开会",
      "我把衣服洗了",
      "天气转凉了，记得加件外套",
      "快递到了，放门口",
      "晚上想吃火锅",
      "刚看完一集电视剧",
      "我买了两张演唱会的票",
      "下个月去成都出差",
      "楼下新开了一家咖啡店",
      "我妈让我周末回家吃饭",
      "手机屏幕摔碎了",
      "这周的报告写完了",
      "我们组的新同事挺有意思",
      "今天路上堵了四十分钟",
      "我学会做番茄炒蛋了",
      "昨晚的球赛真精彩",
      "明天记得交水电费",
      "我新买的耳机音质不错",
      "周末打算爬山",
      "公司年会抽奖抽到个杯子",
      "我在地铁上看完了一本书",
      "今晚月亮很圆",
      "冰箱里还有半个西瓜",
      "我下午去拿了体检报告",
      "这次考试题不算难",
      "朋友推荐了一家理发店",
      "the meeting ran long today",
      "we should try that new noodle place",
      "I finally finished the report",
      "it rained all afternoon",
      "see you at the station at six",
      "my package arrived this morning",
      "the kids have a game on Saturday",
      "I'm going to the gym after work",
      "the coffee machine broke again",
      "let's book the tickets tonight",
    ];
    for (const text of ordinary) {
      expect(detectIndirectCrisis(text).families, `"${text}" should match no family`).toEqual([]);
      const result = await detectCrisisExtended(text, { semantic: false });
      expect(result.crisis, `"${text}" should not be a crisis`).toBe(false);
      expect(result.weakSignal, `"${text}" should not be a weak signal`).toBe(false);
    }
  });

  it("does not fire on an empty message", async () => {
    expect(detectIndirectCrisis("").families).toEqual([]);
    const result = await detectCrisisExtended("   ", { semantic: false });
    expect(result.crisis).toBe(false);
    expect(result.weakSignal).toBe(false);
  });

  it("keeps the combination helpers honest", () => {
    expect(hasMultipleReasons({ families: ["burden", "disappear"], planned: false })).toBe(true);
    expect(hasMultipleReasons({ families: ["burden"], planned: false })).toBe(false);
    expect(hasPlanWithReason({ families: ["burden", "plan"], planned: true })).toBe(true);
    expect(hasPlanWithReason({ families: ["plan"], planned: true })).toBe(false);
  });
});
