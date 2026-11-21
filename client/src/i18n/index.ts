/**
 * The internationalisation layer.
 *
 * The dictionary shape is the contract: `TranslationKey` is derived from the
 * Chinese dictionary, so a key that does not exist is a compile error rather
 * than a blank label at runtime.
 */
import { zh } from "./zh";
import { en } from "./en";
import { zhHant } from "./zh-Hant";

export { zh } from "./zh";
export { en } from "./en";
export { zhHant } from "./zh-Hant";

/**
 * The languages the interface speaks.
 *
 * Traditional Chinese is machine-converted from the simplified dictionary
 * (`pnpm i18n:hant`) rather than translated a second time, so the two stay
 * the same words in different characters. Any other language still needs a
 * person: adding one means adding a dictionary here, and the key-parity
 * test makes sure it covers every key.
 */
export type Locale = "zh" | "en" | "zh-Hant";

export const dictionaries = { zh, en, "zh-Hant": zhHant } as const;

/**
 * The namespaces the dictionaries carry.
 *
 * The Chinese dictionary is the registry: it lists the namespaces, and
 * `TranslationKey` is derived from the same shape, so a namespace that is
 * missing here is a compile error rather than a blank screen.
 */
export const NAMESPACES = Object.keys(zh) as Array<keyof typeof zh>;

/** Joins a prefix and a key with a dot. */
type Join<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}.${Key}`;

/**
 * Every dotted path in the dictionary.
 *
 * Arrays count as leaves: `landing.stats.items` is a valid key that resolves
 * to the array itself.
 */
type Leaves<T, Prefix extends string = ""> = T extends readonly any[]
  ? Prefix
  : T extends string | number | boolean
    ? Prefix
    : {
        [K in keyof T & string]: Leaves<T[K], Join<Prefix, K>>;
      }[keyof T & string];

export type TranslationKey = Leaves<typeof zh>;

export type TranslationParams = Record<string, string | number>;

/** A translated value: either text, or a list of items. */
export type TranslationValue = string | readonly any[];

/**
 * The signature of the `t` function the locale context exposes.
 *
 * A component that needs to translate a key it holds in a variable can use
 * this type instead of re-deriving it.
 */
export type Translate = <K extends TranslationKey>(
  key: K,
  params?: TranslationParams,
) => ValueAt<typeof zh, K>;

/**
 * Looks up a dotted key in a dictionary.
 *
 * Falls back to the Chinese text when a key is missing from a translation —
 * a half-finished translation shows Chinese rather than a raw key.
 */
function lookup(dictionary: unknown, key: string): TranslationValue | undefined {
  const parts = key.split(".");
  let current: unknown = dictionary;

  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current === "string") return current;
  if (Array.isArray(current)) return current as readonly any[];
  return undefined;
}

/** Replaces `{{name}}` placeholders. */
function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * The value a key resolves to.
 *
 * A key that points at a string resolves to that string; a key that points at
 * a list resolves to the list — so `t("landing.stats.items").map(...)` is
 * type-safe without a cast.
 */
export type ValueAt<T, K extends string> = K extends keyof T
  ? T[K]
  : K extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
      ? ValueAt<T[Head], Rest>
      : never
    : never;

/**
 * Translates a key.
 *
 * `locale` decides the dictionary; an unknown key falls back to Chinese and
 * then to the key itself, so nothing ever renders as `undefined`.
 */
export function translate<K extends TranslationKey>(
  locale: Locale,
  key: K,
  params?: TranslationParams,
): ValueAt<typeof zh, K> {
  const primary = lookup(dictionaries[locale], key);
  if (primary !== undefined) {
    return (
      typeof primary === "string" ? interpolate(primary, params) : primary
    ) as ValueAt<typeof zh, K>;
  }

  const fallback = lookup(dictionaries.zh, key);
  if (fallback !== undefined) {
    return (
      typeof fallback === "string" ? interpolate(fallback, params) : fallback
    ) as ValueAt<typeof zh, K>;
  }

  return key as unknown as ValueAt<typeof zh, K>;
}

/**
 * The locale names, in their own language.
 *
 * Each language names itself, which is the only way a name is readable to
 * the person looking for it — an English name for 繁體中文 is no use to
 * somebody who cannot read English.
 */
// i18n:allow-identifier — a language's own name, written in that language; it is the same in every interface.
export const LOCALE_NAMES: Record<Locale, string> = {
  zh: "中文",
  en: "English",
  "zh-Hant": "繁體中文",
};
