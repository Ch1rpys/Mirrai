/**
 * The emotion trigger words, shared by the server and the client.
 *
 * The heuristic behind `computeEmotionalState` is only a fallback for when
 * the model is unavailable; it is deliberately conservative so it never fights
 * the model's judgement. The words live here so that the server and the
 * client speak about the same triggers — the plan (§6.2) asks for the table
 * to be a shared artefact in the shape `{ zh: [...], en: [...] }`.
 *
 * The patterns are the canonical copy: they are what the heuristic matches
 * against. The flat word lists are derived from them, so the two can never
 * drift apart.
 */
import { toSimplified } from "./han-normalize";
import { contentLocale, type Locale } from "./locale";

/** The emotional states a trigger can point at. */
export type EmotionTriggerState =
  | "nostalgic"
  | "playful"
  | "melancholy"
  | "happy"
  | "distant";

/** The states, in the order the heuristic tries them. */
export const EMOTION_TRIGGER_STATES: readonly EmotionTriggerState[] = [
  "nostalgic",
  "playful",
  "melancholy",
  "happy",
  "distant",
];

/**
 * The trigger patterns, per language.
 *
 * These are the words the server already used; they are copied here exactly,
 * so a persona's emotional state does not change when the heuristic starts
 * reading them from this module.
 */
export const EMOTION_TRIGGER_PATTERNS: {
  zh: Record<EmotionTriggerState, RegExp>;
  en: Record<EmotionTriggerState, RegExp>;
} = {
  zh: {
    nostalgic: /想你|思念|好久|那时候|记得吗|以前|想起|回忆|怀念|当年|从前|旧照片|老照片/,
    playful: /哈哈|笑死|好玩|有意思|逗|搞笑|打趣|贫嘴|乐死|笑疯|笑喷|调皮/,
    melancholy: /难过|伤心|哭|委屈|不开心|抑郁|低落|孤独|郁闷|沮丧|心酸|失落/,
    happy: /开心|高兴|棒|太好了|耶|爱你|快乐|幸福|兴奋|满足/,
    distant: /随便|无所谓|算了|不想说|爱怎样|爱咋咋地|随你便|随你吧|随你了|懒得|不想理|别问/,
  },
  en: {
    nostalgic:
      /miss (you|those|them|him|her|it)|i miss you|remember when|\bremember\b|used to|reminds me of|nostalg|old photos|back then|those days|thinking about (us|then|the past)|memories/,
    playful:
      /haha|lol|that'?s funny|\bfunny\b|joking|kidding|joke|crack me up|so much fun|having fun|hilarious|playful/,
    melancholy:
      /\bsad|crying|upset|hurt|heartbroken|lonely|depressed|miserable|hopeless|feeling down|feeling low|feel down|feel low|feeling empty|empty inside|gloomy/,
    happy:
      /\bhappy\b|great|awesome|i love you|so glad|\bglad\b|wonderful|thrilled|excited|amazing|fantastic|best day|\blove it\b|hooray/,
    distant:
      /whatever|doesn'?t matter|forget it|not talking|don'?t care|leave me alone|never mind|suit yourself|not interested|stop asking/,
  },
};

/**
 * Expands the alternation groups in a pattern into flat variants.
 *
 * A pattern is not only a list of alternatives: it can carry a group of them
 * (`miss (you|those|them)`) and a word boundary (`\bsad`). The flat word list
 * is derived from the pattern — the tests hold the two together — so the
 * groups are expanded and the boundaries dropped rather than handed out as
 * regex fragments.
 */
function expandGroups(source: string): string[] {
  const group = /\(([^()]*)\)/.exec(source);
  if (!group) return [source];
  const [full, inner] = group;
  const expanded: string[] = [];
  for (const option of inner.split("|")) {
    expanded.push(...expandGroups(source.replace(full, option)));
  }
  return expanded;
}

/**
 * Splits a pattern's alternatives into plain words.
 *
 * The optional apostrophe (`that'?s funny`) matches two spellings, so it is
 * expanded into both rather than left as a regex fragment.
 */
function wordsOf(pattern: RegExp): string[] {
  const words: string[] = [];
  for (const variant of expandGroups(pattern.source)) {
    for (const alternative of variant.split("|")) {
      const trimmed = alternative.trim().replace(/\\b/g, "").replace(/^\?:/, "");
      if (!trimmed) continue;
      const parts = trimmed.split("'?");
      if (parts.length === 2) {
        words.push(parts[0] + parts[1], parts[0] + "'" + parts[1]);
      } else {
        words.push(trimmed);
      }
    }
  }
  return words;
}

/**
 * The trigger words, per language.
 *
 * The order follows the patterns: the states come first, the alternatives
 * within a state keep the order they are written in.
 */
export const EMOTION_TRIGGER_WORDS: { zh: string[]; en: string[] } = {
  zh: EMOTION_TRIGGER_STATES.flatMap((state) => wordsOf(EMOTION_TRIGGER_PATTERNS.zh[state])),
  en: EMOTION_TRIGGER_STATES.flatMap((state) => wordsOf(EMOTION_TRIGGER_PATTERNS.en[state])),
};

/**
 * The state the triggers point at, or null when none of them match.
 *
 * The order of the states decides which one wins, exactly as the server's
 * heuristic does.
 */
export function matchEmotionTrigger(
  text: string,
  locale: Locale = "zh",
): EmotionTriggerState | null {
  /**
   * Traditional Chinese is read as simplified before matching.
   *
   * The trigger words are written in simplified Chinese — 「难过」, 「想你」 —
   * and a person who writes traditional Chinese writes them as 「難過」,
   * 「想你」. A regex is a substring match and cannot know the two are the
   * same word, so the mood went unrecognised. The normalisation is applied
   * whatever the interface language is: the words are the words.
   */
  const haystack = toSimplified(text ?? "").toLowerCase();
  const patterns = EMOTION_TRIGGER_PATTERNS[contentLocale(locale)];
  for (const state of EMOTION_TRIGGER_STATES) {
    if (patterns[state].test(haystack)) return state;
  }
  return null;
}
