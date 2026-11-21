/**
 * The languages the app speaks, in one small place.
 *
 * This exists separately from `shared/copy/` because of who needs it:
 * `shared/emotion-triggers.ts` runs in the client too, and it needs the
 * locale *type* and the "which content language is this" helper — not the
 * server's copy table. Importing the helper from the copy module would pull
 * the whole table into that module graph. The copy module re-exports these,
 * so the rest of the app keeps one import path.
 *
 * `zh-Hant` is not a separate translation: it is the Chinese copy in
 * traditional characters (converted on the server, or a generated dictionary
 * in the client). `ContentLocale` is the subset the app has its own wording
 * for — simplified Chinese and English.
 */
export type Locale = "zh" | "en" | "zh-Hant";

/** The locales the app has its own words for. */
export type ContentLocale = "zh" | "en";

/** Normalises any interface locale to the content locale it reads. */
export function contentLocale(locale: Locale | string | undefined): ContentLocale {
  return locale === "en" ? "en" : "zh";
}
