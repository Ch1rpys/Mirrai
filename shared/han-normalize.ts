/**
 * Traditional Chinese, read as if it were simplified.
 *
 * The safety rules — the crisis vocabulary, the distress signals, the
 * emotion triggers, the speech-act rules, the fact clues — are written in
 * simplified Chinese, because that is how the product was written and how
 * its records are stored. A person who types traditional Chinese writes the
 * same words in different characters: 「難過」 instead of 「难过」, 「結束生命」
 * instead of 「结束生命」.
 *
 * A substring does not care that the two are the same word, so a crisis
 * sentence written in traditional Chinese used to match nothing: the persona
 * answered in character and the support resources never appeared. The
 * matching is a *word* match, so every input is normalised into the
 * characters the word lists are written in before anything is matched.
 *
 * The conversion is done with OpenCC's traditional→simplified table (the
 * ~110 KB `t2cn` build — small enough to travel with the client, which
 * labels speech acts and emotions locally). The larger
 * simplified→traditional table is only ever used by the server and by the
 * dictionary generator, so it does not enter the client bundle.
 *
 * This is applied regardless of the interface language: a traditional
 * sentence is still a traditional sentence when the interface is English.
 */
import { Converter } from "opencc-js/t2cn";

/**
 * The converter, built on first use.
 *
 * Building it loads the table into a trie, which is real work at module-load
 * time — and this module is imported by the client as well (the emotion and
 * speech-act rules run locally). A client that never matches Chinese text
 * should not pay for the table on first paint, so the build waits until a
 * string is actually converted.
 */
let convert: ((text: string) => string) | null = null;

/** The converter, built if it has not been. */
function converter(): (text: string) => string {
  if (!convert) convert = Converter({ from: "t", to: "cn" });
  return convert;
}

/** Whether the text contains any Han character at all. */
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * The spellings OpenCC leaves behind that the word lists write another way.
 *
 * 「著」 is a correct simplified character in its own right (著名, 著作), so
 * the traditional→simplified table keeps it — but it is also the older
 * spelling of 「着」, and the crisis vocabulary is written with 「着」:
 * 「活著沒意義」 and 「活着没意义」 are the same sentence, and only the second
 * one matched. The fold is limited to the words the word lists actually
 * carry, so a word like 「著名」 is not disturbed.
 */
// i18n:allow-input — matched against what the user typed.
const VARIANTS: Array<[RegExp, string]> = [[/活著/g, "活着"]];

/** Folds the variant characters a table conversion leaves behind. */
function foldVariants(text: string): string {
  let out = text;
  for (const [pattern, replacement] of VARIANTS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * The text in simplified characters.
 *
 * Text with no Han characters — English, numbers, punctuation — is returned
 * unchanged without touching the table. The conversion is otherwise
 * character-level: it does not touch punctuation, Latin words or emoji, so
 * the caller can keep matching on the same string.
 */
export function toSimplified(text: string): string {
  if (!text) return "";
  if (!HAN.test(text)) return text;
  return foldVariants(converter()(text));
}
