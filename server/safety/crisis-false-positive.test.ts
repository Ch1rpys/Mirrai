import { describe, expect, it } from "vitest";
import { detectCrisis } from "./crisis";
import { detectCrisisExtended } from "./crisis-extended";

/**
 * The words that contain a crisis word and mean nothing of the kind.
 *
 * v4 R4 found the app printing the hotline list at someone who said
 * "笑死我了". The keyword list is a substring match, so "死" inside an
 * exaggeration is the same string as "死" inside a wish.
 *
 * The bar: **none of these is a crisis.** A weak signal (the gentle
 * check-in) on at most three of them is allowed — some of them are, in
 * fact, a person saying they are worn out.
 */
const HARMLESS_ZH = [
  "热死了",
  "气死我了",
  "笑死我了",
  "累死我了",
  "饿死了",
  "渴死了",
  "困死了",
  "无聊死了",
  "尴尬死了",
  "烦死了",
  "吓死我了",
  "急死了",
  "甜死了",
  "咸死了",
  "辣死了",
  "美死了",
  "开心死了",
  "高兴死了",
  "冷死了",
  "闷死了",
  "忙死了",
  "挤死了",
  "脏死了",
  "臭死了",
  "香死了",
  "吵死了",
  "重死了",
  "疼死了",
  "想死你了",
  "想死我了",
  "想死你们了",
  "可把我累死了",
  "这题难到想死",
  "笑死个人",
  "我快热死了",
  "我要笑死了",
  "把我吓死了",
  "别气死了",
  "这歌好听死了",
  "我快饿死了",
];

const HARMLESS_EN = [
  "I'm dying to see you",
  "this is killing me lol",
  "dead tired",
  "I'm dead tired",
  "I almost died laughing",
  "I could die of embarrassment",
  "I'm gonna die of embarrassment",
  "my feet are killing me",
  "this heat is killing me",
  "I killed it at the interview",
  "kill the lights",
  "kill time before the train",
  "that joke was killer",
  "my phone died",
  "the battery is dead",
  "dead silence in the room",
  "the dead of night",
  "dead center",
  "dead last in the race",
  "a dead giveaway",
  "a dead ringer for his dad",
  "over my dead body",
  "drop dead gorgeous",
  "dead set on going",
  "dies laughing every time",
  "I'm dead serious",
  "brain dead after work",
  "I'm so dead if my mom finds out",
  "we're dead meat",
  "I'm dying of hunger",
  "I'm dying of boredom",
  "I'm dying for a coffee",
  "I'd die of laughter at that meme",
  "I'd rather die than give that speech",
  "I nearly died of shame",
  "I'm dead hungry",
  "the party was dead",
  "my phone's dead again",
  "I'm dying to know",
  "dead wrong about that",
];

/**
 * Every sentence the original keyword test asserts as a crisis.
 *
 * The new layers only ever make the answer more careful, so every one of
 * these must still come out as a crisis with both of them in front of
 * the keyword list.
 */
const KEYWORD_POSITIVES = [
  "I want to kill myself",
  "I think I might commit suicide",
  "我想死",
  "我不想活了，真的",
  "有点想死",
  "我不想再这样活下去了",
  "轻生",
  "I wish I were dead",
  "I don't want to live anymore",
  "I want to end it all",
  "I'd be better off without me",
  "there's no reason to live",
  "I don’t want to live",
  "我想死，真的",
  "我想\n死",
  "我要死",
  "我想去死",
  "让我死",
  "我要消失",
  "我想消失",
  "i wanna die",
  "I don't wanna live",
  "i dont wanna live anymore",
  "i'm cutting myself",
  "i wanna disappear",
  "我去死",
  "让我去死",
  "去死吧，我不想活了",
  "我想自殺",
  "他最近有輕生的念頭",
  "我開始自殘",
  "我想割腕",
  "我常常傷害自己",
  "我不想活了",
  "我真的活不下去了",
  "我不想再活下去了",
  "我要死",
  "讓我去死",
  "我想結束生命",
  "我想結束自己的生命",
  "我想了結自己",
  "一了百了，解脫了算了",
  "我想跳樓",
  "我想上吊",
  "我要跳河",
  "我想吃安眠藥",
  "我要燒炭",
  "我想離開這個世界",
  "我想離開人世",
  "我真的撐不下去了",
  "我熬不住了",
  "我撐不住了",
  "活著沒意義",
  "活著沒意思",
  "我生無可戀",
  "我見不到明天的太陽",
  "I want to kill myself，真的撐不下去了",
  "I don’t want to live，我想離開這個世界",
];

describe("the harmless ways of writing a death word", () => {
  it("never treats a Chinese exaggeration as a crisis", async () => {
    for (const text of HARMLESS_ZH) {
      expect(detectCrisis(text).crisis, `"${text}" must not be a crisis`).toBe(false);
      const extended = await detectCrisisExtended(text, { semantic: false });
      expect(extended.crisis, `"${text}" must not be a crisis`).toBe(false);
    }
  });

  it("never treats an English exaggeration as a crisis", async () => {
    for (const text of HARMLESS_EN) {
      expect(detectCrisis(text).crisis, `"${text}" must not be a crisis`).toBe(false);
      const extended = await detectCrisisExtended(text, { semantic: false });
      expect(extended.crisis, `"${text}" must not be a crisis`).toBe(false);
    }
  });

  it("raises at most three gentle check-ins across the whole list", async () => {
    const weak: string[] = [];
    for (const text of [...HARMLESS_ZH, ...HARMLESS_EN]) {
      const extended = await detectCrisisExtended(text, { semantic: false });
      if (extended.weakSignal) weak.push(text);
    }
    expect(weak.length, `weak signals: ${weak.join(" / ")}`).toBeLessThanOrEqual(3);
  });

  it("still hears the idiomatic meaning as ordinary conversation", () => {
    // "I missed you" is not distress at all: no keyword, no weak signal.
    expect(detectCrisis("想死你了")).toEqual({ crisis: false, weakSignal: false, matched: [] });
    expect(detectCrisis("我想死")).toMatchObject({ crisis: true });
  });
});

describe("the new layers only add care, never take it away", () => {
  it("keeps every keyword crisis a crisis", async () => {
    for (const text of KEYWORD_POSITIVES) {
      const extended = await detectCrisisExtended(text, { semantic: false });
      expect(extended.crisis, `"${text}" must still be a crisis`).toBe(true);
      expect(extended.raisedBy).toBe("keyword");
    }
  });

  it("decides the same verdict with the semantic layer unavailable", async () => {
    const message = "我想死";
    const without = await detectCrisisExtended(message, { semantic: false });
    const withBrokenLayer = await detectCrisisExtended(message, {
      semantic: { embed: async () => null, awaitCorpus: true },
    });
    expect(withBrokenLayer).toEqual(without);
  });
});
