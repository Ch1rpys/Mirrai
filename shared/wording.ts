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
  locale: "zh" | "en",
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

/** Every number that appears in a sentence, as written. */
function numbersIn(text: string): string[] {
  return Array.from(text.matchAll(/\d+(?:[.,]\d+)?/g)).map((match) => match[0]);
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
