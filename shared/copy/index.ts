/**
 * The server's own words.
 *
 * The interface was translated; the server was not. Every error toast,
 * every push notification, every reply in WeChat, every line of the
 * questionnaire — all of it was written in Chinese, so an English user
 * got an English app that answered in Chinese whenever anything went
 * wrong.
 *
 * This is the other half of the dictionary: the words the *server* says
 * to a person. It lives in `shared/` because both sides need it — the
 * server to pick a language, and the client to check that the two sides
 * agree.
 *
 * The rules:
 *
 *   - Every entry has both a `zh` and an `en`. An entry with only one
 *     is a half-finished translation, and the test says so.
 *   - `zh` is never Latin-only. If it is, the English string was pasted
 *     into the wrong file.
 *   - Placeholders are `{{name}}` in both languages, and the test
 *     checks that the two sides use the same set.
 */
import { ERRORS } from "./errors";
import { CHANNELS } from "./channels";
import { REMINDERS } from "./reminders";
import { SKILL_ENGINE } from "./skill-engine";
import { CONTENT } from "./content";
import { PROMPT } from "./prompt";
import { PROMPTS } from "./prompts";
import { LABELS } from "./labels";
import { SAFETY } from "./safety";
import { SCENES_COPY, BUILTIN_SCENE_SLUGS, BUILTIN_SCENE_DEFINITIONS } from "./scenes";
import { USER_SIDE } from "./user-side";
import { FIDELITY } from "./fidelity";
import { V5 } from "./v5";
import { V6 } from "./v6";
/**
 * The skill prompts, for their keys.
 *
 * They live in their own file because they are added to the table when
 * the pipeline is loaded — so they are not in `COPY` at the time this
 * module is read. Their keys are part of the key type all the same: a
 * typo in one of them is as wrong as a typo in any other.
 *
 * The import is of the type only, so nothing is read at runtime and
 * there is no cycle.
 */
import type { SKILL_PROMPTS } from "./skill-prompts";

export type CopyEntry = { zh: string; en: string };
export type CopyTable = Record<string, CopyEntry>;

/**
 * The whole table.
 *
 * It is not annotated as `CopyTable`. The annotation widened `CopyKey`
 * to `string`, so `copy()` accepted any key at all and a typo compiled
 * cleanly — and then rendered as the raw key in the interface or inside
 * a model's prompt. The individual tables are annotated, so the union is
 * still checked entry by entry; it is only the *merged* table that has
 * to keep its literal keys.
 *
 * And the key of `copy()` is the literal union, so a typo in a literal
 * call is a compile error. It was `CopyKey | string` — which is
 * `string`, so the union bought nothing at all.
 */
export const COPY = {
  ...ERRORS,
  ...CHANNELS,
  ...REMINDERS,
  ...SKILL_ENGINE,
  ...CONTENT,
  ...PROMPT,
  ...PROMPTS,
  ...LABELS,
  ...SAFETY,
  ...SCENES_COPY,
  ...USER_SIDE,
  ...FIDELITY,
  ...V5,
  ...V6,
} as const satisfies CopyTable;

export type CopyKey = keyof typeof COPY | keyof typeof SKILL_PROMPTS;

/**
 * The languages the *server's* words are written in.
 *
 * `zh-Hant` is not a third translation: it is the Chinese half in traditional
 * characters. It is produced at run time by a converter registered by the
 * server (`server/_core/traditional.ts`) — the simplified → traditional
 * table is over a megabyte and must not enter the client bundle, so
 * `shared/copy` takes the converter as an injection instead of importing it.
 */
/**
 * The languages, re-exported from the small module that defines them.
 *
 * It lives in `shared/locale.ts` so that client-side modules can use the
 * type and the helper without pulling the copy table into their graph.
 */
import { contentLocale, type ContentLocale, type Locale } from "../locale";
export { contentLocale };
export type { ContentLocale, Locale };

/** Converts a simplified sentence to traditional Chinese. */
export type TraditionalConverter = (text: string) => string;

let traditionalConverter: TraditionalConverter | null = null;

/**
 * The converted text, by copy key.
 *
 * The conversion is a table walk over the sentence, and the same sentence is
 * asked for on every page that shows it — so the result is kept per key. The
 * cache is cleared when the converter changes, because a cached sentence
 * without the converter would otherwise stay simplified for ever.
 */
const traditionalCache = new Map<string, string>();

/**
 * Gives the copy table a way to write traditional Chinese.
 *
 * The server registers OpenCC's simplified → traditional converter at
 * startup. Tests register the same converter themselves; the client never
 * registers one, because the ~1.1 MB table belongs on the server and the
 * client's own words are a generated dictionary (`client/src/i18n/zh-Hant.ts`).
 * Until a converter is registered, `zh-Hant` falls back to the simplified
 * text — which is what the interface did before the language existed.
 */
export function registerTraditionalConverter(converter: TraditionalConverter | null): void {
  traditionalConverter = converter;
  traditionalCache.clear();
}

/**
 * The skill-engine keys that are read by the person, not by the model.
 *
 * The `skillPrompts.*` namespace holds the distillation pipeline's prompts —
 * the contracts, the analysis instructions — and, beside them, the handful of
 * lines a person reads while the pipeline runs ("正在收集公开资料…", the
 * failure notices, the "your persona is ready" message). The prompts stay
 * simplified with every other instruction; these few are ordinary sentences
 * and are converted like the rest of the interface.
 */
const USER_FACING_SKILL_KEYS: ReadonlySet<string> = new Set([
  "skillPrompts.pipeline.personaReady",
  "skillPrompts.research.collecting",
  "skillPrompts.research.auditing",
  "skillPrompts.research.synthesizing",
  "skillPrompts.research.validating",
  "skillPrompts.research.trackFailed",
  "skillPrompts.research.mergeFailed",
  "skillPrompts.research.auditFailed",
  "skillPrompts.research.synthesisFailed",
  "skillPrompts.research.validationFailed",
]);

/**
 * Whether the key is an instruction to a model.
 *
 * Prompts are not converted. The manual is explicit about it, and there is a
 * practical reason as well: the model is told to answer in simplified
 * Chinese and the persona's own replies are whatever the records carry. The
 * namespaces below are the ones that hold model instructions — `prompt.*`
 * and `prompts.*` are the reply/classification instructions, and
 * `skillPrompts.*` is the distillation pipeline's table, except for the few
 * progress lines listed above.
 */
function isModelInstruction(key: string): boolean {
  if (key.startsWith("prompt.") || key.startsWith("prompts.")) return true;
  if (key.startsWith("skillPrompts.")) return !USER_FACING_SKILL_KEYS.has(key);
  return false;
}

/** The traditional text for a key, converted once and cached. */
function traditionalText(key: string, simplified: string): string {
  if (!traditionalConverter) return simplified;
  const cached = traditionalCache.get(key);
  if (cached !== undefined) return cached;
  const converted = traditionalConverter(simplified);
  traditionalCache.set(key, converted);
  return converted;
}

/**
 * The sentence a copy entry shows in a locale.
 *
 * `zh-Hant` reads the Chinese sentence and converts it — except for a model
 * instruction, which stays verbatim so the instructions the model receives
 * do not change with the reader's characters.
 */
function localiseEntry(
  locale: Locale | string | undefined,
  key: string,
  entry: CopyEntry,
): string {
  if (locale === "en") return entry.en ?? entry.zh;
  if (locale === "zh-Hant" && !isModelInstruction(key)) {
    return traditionalText(key, entry.zh);
  }
  return entry.zh;
}

/** Anything that can go wrong to look up. */
export function isCopyKey(key: string): key is Extract<CopyKey, string> {
  return Object.prototype.hasOwnProperty.call(COPY, key);
}

/**
 * The sentence, in the language asked for.
 *
 * The key is a literal, so a typo is a compile error. It used to be
 * `CopyKey | string` — which is `string`, so every typo compiled
 * cleanly and then showed up as `errors.someKey` in the interface, or
 * inside a model's prompt where nobody would ever see it.
 *
 * A key that is built at runtime goes through `copyKey` below.
 */
export function copy(
  locale: Locale | string | undefined,
  key: CopyKey,
  params?: Record<string, string | number>,
): string {
  const entry = (COPY as unknown as Record<string, CopyEntry | undefined>)[key];
  if (!entry) return key;
  return interpolate(localiseEntry(locale, key, entry), params);
}

/**
 * The sentence for a key that is not known until it is built.
 *
 * The key is checked at runtime instead of at compile time, so a key
 * that is wrong shows up as the key itself — which is how a missing
 * translation should look.
 */
export function copyKey(
  locale: Locale | string | undefined,
  key: string,
  params?: Record<string, string | number>,
): string {
  const entry = (COPY as unknown as Record<string, CopyEntry | undefined>)[key];
  if (!entry) return key;
  return interpolate(localiseEntry(locale, key, entry), params);
}

/** Fills `{{name}}` in. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * The built-in scenes, by the name the database row carries.
 *
 * The rows are seeded with the Chinese name, because that is what the
 * seeding has always used and the name identifies the scene. The
 * display copy lives in the copy table under the slug.
 */
export { BUILTIN_SCENE_SLUGS };

export interface LocalisableScene {
  name: string;
  description?: string | null;
  systemPromptOverlay?: string | null;
  starters?: string[] | null;
  isBuiltin?: boolean;
}

/**
 * Swaps a built-in scene's wording for the language the person is
 * reading.
 *
 * A scene the app ships should read in their language. A scene they
 * wrote themselves is left exactly as they wrote it.
 *
 * The starters are swapped by position, and only when the row carries the
 * same number of them as the copy table does. A row that has been edited
 * — or one from an older release — keeps its own wording rather than
 * having somebody else's line put in its place.
 */
export function localizeScene<T extends LocalisableScene>(scene: T, locale: Locale): T {
  if (!scene.isBuiltin) return scene;
  const slug = BUILTIN_SCENE_SLUGS[scene.name];
  if (!slug) return scene;

  const starters = scene.starters ?? [];
  const definition = BUILTIN_SCENE_DEFINITIONS.find((entry) => entry.slug === slug);
  const localisedStarters =
    definition && starters.length === definition.starters.length
      ? definition.starters.map((starter, index) =>
          // The starters are their own bilingual pairs rather than copy-table
          // entries, so the traditional conversion is asked for through the
          // same helper the copy table uses — with a made-up, stable key.
          localiseEntry(locale, `scenes.${slug}.starter.${index}`, starter),
        )
      : starters;

  return {
    ...scene,
    /**
     * The keys are built from the slug, so they are looked up at
     * runtime rather than checked at compile time.
     */
    name: copyKey(locale, `scenes.${slug}.name`),
    description: copyKey(locale, `scenes.${slug}.description`),
    systemPromptOverlay: copyKey(locale, `scenes.${slug}.overlay`),
    starters: localisedStarters,
  };
}

/**
 * Picks a language out of whatever a person typed.
 *
 * The channels are where this matters: the reply goes back to a phone,
 * and the person who wrote it is the only thing that says which language
 * they want it in.
 */
export function detectLocale(text: string | undefined | null): Locale {
  if (!text) return "zh";
  // A CJK character anywhere means Chinese; everything else is English.
  return /[一-鿿぀-ヿ]/.test(text) ? "zh" : "en";
}
