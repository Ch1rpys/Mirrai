/**
 * The wording assistant (C3.6).
 *
 * It gives the user three ways to say a sentence they already wrote —
 * more direct, softer, shorter. It never replaces their words on its
 * own: the suggestions are shown beside the original, and a sentence
 * only changes when the user adopts one and saves.
 *
 * The rules are here rather than in the router so they can be tested on
 * their own, and so the prompt is easy to find when the fencing test
 * walks the messages.
 */
import { copy } from "./copy";
import { asMaterial } from "./material";
import type { Locale } from "./copy";

export type WordingKind = "direct" | "soft" | "short";

export interface WordingSuggestion {
  kind: WordingKind;
  text: string;
}

export interface WordingMessage {
  role: "system" | "user";
  content: string;
}

/**
 * The messages the model is given.
 *
 * The sentence is material: it is something the user wrote, not an
 * instruction to the model. A sentence that reads like an order must
 * stay inside the fence.
 */
export function buildWordingMessages(
  text: string,
  locale: Locale,
): WordingMessage[] {
  return [
    { role: "system", content: copy(locale, "prompts.wordingAssistant") },
    {
      role: "user",
      content: copy(locale, "prompts.wordingAssistantUser", {
        material: asMaterial(text, locale),
      }),
    },
  ];
}

/** The number of characters, which is what the length limits are about. */
function lengthOf(text: string): number {
  return Array.from(text).length;
}

// i18n:allow-input — the numerals a person may type, matched, not read.
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  "〇": 0,
  一: 1,
  "二": 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** The value of a Chinese numeral such as 「三」「十二」「两百五十」. */
// i18n:allow-input — the numeral words are matched, not shown.
function chineseValue(run: string): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const char of run) {
    if (char in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[char]!;
      seen = true;
      continue;
    }
    if (char === "十" || char === "百" || char === "千" || char === "万") {
      if (!seen) return null;
      const unit = char === "十" ? 10 : char === "百" ? 100 : char === "千" ? 1_000 : 10_000;
      total += (current || 1) * unit;
      current = 0;
      continue;
    }
    return null;
  }
  return seen ? total + current : null;
}

/**
 * Every number that appears in a sentence, as its value.
 *
 * The check used to read only ASCII digits, so a suggestion that wrote
 * a number as words slipped past it (C3.6). Chinese numerals count when
 * a time or counting word follows them — 「三点」 is a number, 「一起」
 * is not.
 */
function numbersIn(text: string): string[] {
  const ascii = Array.from(text.matchAll(/\d+(?:[.,]\d+)?/g)).map((match) =>
    match[0].replace(/,/g, ""),
  );
  const chinese: string[] = [];
  // i18n:allow-input — the words that follow a numeral, not copy.
  const spelled = /[零〇一二两三四五六七八九十百千万]+(?=[点號号日月年岁週周天次块元角分])/g;
  for (const match of text.matchAll(spelled)) {
    const value = chineseValue(match[0]);
    if (value !== null) chinese.push(String(value));
  }
  return [...ascii, ...chinese];
}

/**
 * Keeps the suggestions that obey the rules.
 *
 * A suggestion that is empty, is the original, adds a number the user
 * never wrote, or is too long for what it claims to be is dropped —
 * separately, so one bad suggestion does not lose the other two. The
 * numbers are the hard one: a date or an amount that appears only in
 * the suggestion was invented, and invented facts are the thing this
 * feature must not add.
 */
export function selectWordingSuggestions(
  original: string,
  raw: unknown,
): WordingSuggestion[] {
  const source = original.trim();
  if (!source || !raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const originalLength = lengthOf(source);
  const originalNumbers = new Set(numbersIn(source));
  const out: WordingSuggestion[] = [];

  for (const kind of ["direct", "soft", "short"] as const) {
    const value = record[kind];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (text === source) continue;

    const limit = kind === "short"
      ? Math.floor(originalLength * 0.8)
      : Math.floor(originalLength * 1.3);
    if (lengthOf(text) > limit) continue;

    const invented = numbersIn(text).some((number) => !originalNumbers.has(number));
    if (invented) continue;

    out.push({ kind, text });
  }

  return out;
}
