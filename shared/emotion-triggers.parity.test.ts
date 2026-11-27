/**
 * The English triggers, held to the same standard as the Chinese ones.
 *
 * The trigger table in `emotion-triggers.ts` is what the local heuristic
 * uses when the model is unavailable: it decides the persona's mood (and
 * therefore the imperfection profile, the colour in the lobby, and what the
 * graduation gate counts as a positive emotion). It had been written in
 * Chinese first and the English half grew afterwards, so the English list
 * was never actually tried against the way an English-speaking person types.
 *
 * "六个状态" is the app's six emotional states, not five triggers plus a
 * mystery: five of them (nostalgic, playful, melancholy, happy, distant)
 * have trigger patterns, and the sixth — `warm` — is the state the heuristic
 * falls back to when *no* trigger matches (see `computeEmotionalState`:
 * `matchEmotionTrigger(...) ?? (current || "warm")`). So a sentence is
 * "warm" exactly when `matchEmotionTrigger` returns null and the current
 * state says nothing else. The helper below spells that out, and the
 * samples for `warm` are sentences that must match nothing at all.
 *
 * The sentences are written as a person would type them, not as the
 * patterns are written: that is the point of the test. The gaps it found
 * were real — "Remember our trip?", "You're so funny", "I'm depressed",
 * "Leave me alone" and capitalised "I love you" all fell through to `warm`.
 */
import { describe, expect, it } from "vitest";
import {
  EMOTION_TRIGGER_STATES,
  matchEmotionTrigger,
  type EmotionTriggerState,
} from "./emotion-triggers";

/** The app's six states: the five triggers, plus the fallback. */
type SixState = EmotionTriggerState | "warm";

/** What the heuristic would decide for this sentence. */
function stateOf(text: string, locale: "zh" | "en"): SixState {
  return matchEmotionTrigger(text, locale) ?? "warm";
}

/** Every state, with eight sentences in each language. */
const SAMPLES: Record<SixState, { zh: string[]; en: string[] }> = {
  warm: {
    zh: [
      "今天吃了面",
      "外面在下雨",
      "我刚下班",
      "地铁上人很多",
      "周末去爬山",
      "这个菜有点咸",
      "帮我拿一下快递",
      "明天要开会",
    ],
    en: [
      "I had noodles for lunch",
      "It is raining outside",
      "The bus was late",
      "I just got home",
      "I need to buy groceries",
      "The meeting moved to three",
      "My phone battery died",
      "See you tomorrow",
    ],
  },
  nostalgic: {
    zh: [
      "突然好想你",
      "我经常思念你",
      "好久没联系了",
      "那时候真好啊",
      "你还记得吗",
      "以前我们常去那家店",
      "看到这首歌就想起你",
      "翻到我们的旧照片",
    ],
    en: [
      "I miss you so much",
      "I remember when we first met",
      "We used to go there every summer",
      "That song reminds me of you",
      "I keep thinking about those days",
      "Remember our trip to the beach?",
      "I really miss those times",
      "Looking at our old photos",
    ],
  },
  playful: {
    zh: [
      "哈哈哈哈哈",
      "笑死我了",
      "这个游戏好好玩",
      "你说话真有意思",
      "别逗我了",
      "太搞笑了",
      "我们互相打趣一下",
      "你太贫嘴了",
    ],
    en: [
      "haha that's hilarious",
      "lol",
      "You're so funny",
      "Just joking",
      "I'm kidding",
      "That was a good joke",
      "You crack me up",
      "This is so much fun",
    ],
  },
  melancholy: {
    zh: [
      "今天好难过",
      "心里很伤心",
      "我想哭",
      "觉得好委屈",
      "我有点不开心",
      "最近很抑郁",
      "心情很低落",
      "感觉好孤独",
    ],
    en: [
      "I feel so sad",
      "I've been crying all night",
      "I'm really upset",
      "That hurt me",
      "I feel heartbroken",
      "I'm feeling down today",
      "I feel so lonely",
      "I'm depressed",
    ],
  },
  happy: {
    zh: [
      "今天好开心",
      "我很高兴",
      "你太棒了",
      "太好了",
      "耶",
      "我很爱你",
      "今天真快乐",
      "超级幸福",
    ],
    en: [
      "I'm so happy",
      "That's great",
      "You're awesome",
      "I love you",
      "I'm so glad",
      "This is wonderful",
      "I'm thrilled",
      "Best day ever",
    ],
  },
  distant: {
    zh: [
      "随便吧",
      "无所谓",
      "算了",
      "不想说",
      "你爱怎样就怎样",
      "随你便",
      "我懒得说了",
      "别问了，不想理你",
    ],
    en: [
      "whatever",
      "it doesn't matter",
      "forget it",
      "I'm not talking about it",
      "I don't care",
      "Leave me alone",
      "Never mind",
      "Suit yourself",
    ],
  },
};

describe("the English triggers are enough", () => {
  for (const state of EMOTION_TRIGGER_STATES) {
    it(`recognises ${state} in both languages`, () => {
      for (const text of SAMPLES[state].zh) {
        expect(stateOf(text, "zh"), `zh: ${text}`).toBe(state);
      }
      for (const text of SAMPLES[state].en) {
        expect(stateOf(text, "en"), `en: ${text}`).toBe(state);
      }
    });
  }

  it("leaves a warm sentence alone in both languages", () => {
    // `warm` is the state with no trigger words: the heuristic reaches it
    // by finding no match at all.
    for (const text of SAMPLES.warm.zh) {
      expect(matchEmotionTrigger(text, "zh"), `zh: ${text}`).toBeNull();
    }
    for (const text of SAMPLES.warm.en) {
      expect(matchEmotionTrigger(text, "en"), `en: ${text}`).toBeNull();
    }
  });

  it("matches sad as a word, not as the start of one (C8.14)", () => {
    // The pattern was `\bsad` with no closing boundary: `saddle` moved
    // the persona's mood. The sad forms a person writes still match.
    expect(matchEmotionTrigger("I bought a new saddle", "en")).toBeNull();
    expect(matchEmotionTrigger("I am sad", "en")).toBe("melancholy");
    expect(matchEmotionTrigger("there is a sadness I cannot name", "en")).toBe("melancholy");
    expect(matchEmotionTrigger("she said it sadly", "en")).toBe("melancholy");
  });

  it("does not fire on ten ordinary English sentences", () => {
    /**
     * The list is deliberately mundane: work, travel, food, a phone, the
     * weather. None of it is an emotion, and none of it should move the
     * persona's mood — a heuristic that treats "the meeting moved to three"
     * as melancholy is worse than one that decides nothing.
     */
    const neutral = [
      "The weather is nice today",
      "I had noodles for lunch",
      "I'm on the bus",
      "I'll be there at six",
      "The meeting moved to three",
      "My phone battery died",
      "I bought a new book",
      "The train was late",
      "Work was busy today",
      "The movie starts at eight",
    ];
    for (const text of neutral) {
      expect(matchEmotionTrigger(text, "en"), `en: ${text}`).toBeNull();
      expect(stateOf(text, "en")).toBe("warm");
    }
  });

  it("recognises the same words written in traditional Chinese", () => {
    // The trigger words are simplified Chinese; a user writing traditional
    // Chinese writes the same words in different characters. The matching
    // runs on the simplified reading of the text, whatever the interface
    // language is.
    expect(stateOf("我今天很難過", "zh")).toBe("melancholy");
    expect(stateOf("我覺得好孤獨", "zh")).toBe("melancholy");
    expect(stateOf("今天真的好開心", "zh")).toBe("happy");
    expect(stateOf("你說話真有意思", "zh")).toBe("playful");
    expect(stateOf("以前我們常去那家店", "zh")).toBe("nostalgic");
    expect(stateOf("隨便吧，無所謂", "zh")).toBe("distant");
    expect(matchEmotionTrigger("外面在下雨", "zh")).toBeNull();
  });
});
