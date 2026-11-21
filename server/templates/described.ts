/**
 * Building a persona out of what people described (C1.8, C7.4).
 *
 * This is the path for somebody with no records. The material is an
 * interview, or the submitted oral accounts a family wrote — either way
 * the persona is not measured, it was *told*, and the model's job is to
 * turn that into sentences.
 *
 * Every sentence has to carry the words it was made from. The server
 * checks the quote against the accounts themselves; a sentence whose
 * quote is not a substring of what was actually said is dropped. That is
 * the same rule the oral extraction already uses, and it is the reason
 * this feature can be trusted: nothing that nobody said can get in.
 */
import { copy, type Locale } from "@shared/copy";
import { asMaterial } from "@shared/material";
import { extractJsonArray, extractJsonObject } from "../_core/json";
import { normalizePersonaData, type PersonaData } from "../_core/persona-schema";
import {
  parseDescribedStatements,
  type DescribedField,
  type DescribedStatement,
} from "@shared/described";
import type { OralAccountForExtraction } from "@shared/oral";
import type { LLMMessage } from "../llm/types";

/** How one statement's sentences are joined into the persona's prose. */
function joinSentences(texts: string[], locale: Locale): string {
  const cleaned = texts
    .map((text) => String(text ?? "").trim().replace(/[。.!！?？]+$/, ""))
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  return `${cleaned.join(locale === "en" ? ". " : "。")}${locale === "en" ? "." : "。"}`;
}

/** The by-field grouped sentences, in the order they were told. */
function byField(statements: DescribedStatement[]): Record<DescribedField, string[]> {
  const groups = {
    personality: [],
    speakingStyle: [],
    catchphrase: [],
    address: [],
    likes: [],
    routine: [],
    people: [],
    story: [],
    boundaries: [],
  } as Record<DescribedField, string[]>;
  for (const statement of statements) {
    const field = statement.field ?? "personality";
    groups[field].push(statement.text);
  }
  return groups;
}

/**
 * How the described sentences fill the persona's existing fields.
 *
 * The rest of the app reads `personality`, `speakingStyle`,
 * `catchphrases`, `nickname` and `memories`, so the sentences are
 * arranged into those — the described section itself keeps the quotes as
 * evidence. A field nobody described is left out, so the normaliser fills
 * it with an honest fallback rather than an invented one.
 */
export function fieldsFromDescribedStatements(
  statements: DescribedStatement[],
  locale: Locale = "zh",
): Partial<PersonaData> {
  const groups = byField(statements);
  const personality = joinSentences(
    [...groups.personality, ...groups.likes, ...groups.routine, ...groups.boundaries],
    locale,
  );
  const speakingStyle = joinSentences(groups.speakingStyle, locale);
  const memories = [...groups.story, ...groups.people]
    .map((text) => String(text ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const fields: Partial<PersonaData> = {};
  if (personality) fields.personality = personality;
  if (speakingStyle) fields.speakingStyle = speakingStyle;
  if (groups.catchphrase.length > 0) fields.catchphrases = groups.catchphrase;
  const nickname = groups.address[0]?.trim();
  if (nickname) fields.nickname = nickname;
  if (memories) fields.memories = memories;
  return fields;
}

/**
 * The messages the persona is written from.
 *
 * The instruction is the app's; the accounts are material and are fenced
 * like every other piece of somebody else's writing.
 */
export function buildDescribedMessages(params: {
  accounts: OralAccountForExtraction[];
  name: string;
  locale?: Locale;
}): LLMMessage[] {
  const locale = params.locale ?? "zh";
  const block = params.accounts
    .map((account) => `[${account.tellerName}]\n${account.body}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: copy(locale, "prompts.describedPersona", { name: params.name }),
    },
    { role: "user", content: asMaterial(block, locale) },
  ];
}

/** The statements the model's answer supports, and how many it lost. */
export interface DescribedGenerationResult {
  /** Whether the answer could be read at all — distinct from "nothing usable". */
  readable: boolean;
  statements: DescribedStatement[];
  /** Statements the model gave that could not be used. */
  dropped: number;
}

function itemsOf(answer: string | null | undefined): unknown[] | null {
  const array = extractJsonArray(answer);
  if (array !== null) return array;
  // A model that wrapped the array in an object still gave the answer.
  const object = extractJsonObject(answer);
  const wrapped = object?.statements;
  return Array.isArray(wrapped) ? wrapped : null;
}

/**
 * Asks the model for the sentences, and keeps the ones with their words.
 *
 * Returns zeros without calling the model when there is nothing to read:
 * the caller decides what that means for the person in front of it.
 */
export async function generateDescribedStatements(params: {
  accounts: OralAccountForExtraction[];
  name: string;
  locale?: Locale;
  invoke: (messages: LLMMessage[]) => Promise<string | null>;
}): Promise<DescribedGenerationResult> {
  const locale = params.locale ?? "zh";
  if (params.accounts.length === 0) {
    return { readable: true, statements: [], dropped: 0 };
  }
  const messages = buildDescribedMessages({
    accounts: params.accounts,
    name: params.name,
    locale,
  });
  let answer: string | null = null;
  try {
    answer = await params.invoke(messages);
  } catch {
    return { readable: false, statements: [], dropped: 0 };
  }
  const items = itemsOf(answer);
  if (items === null) {
    // An answer that cannot be read is not "there was nothing"; saying so
    // is the difference between "the model did not answer in the right
    // shape" and "nothing was described".
    return { readable: false, statements: [], dropped: 0 };
  }
  const parsed = parseDescribedStatements(items, params.accounts);
  return { readable: true, statements: parsed.statements, dropped: parsed.dropped };
}

export interface DescribedPersonaResult extends DescribedGenerationResult {
  /** The persona's fields, as the described sentences fill them. */
  fields: Partial<PersonaData>;
  /** Present only when the answer could be read. */
  personaData?: PersonaData;
}

/**
 * The whole path: accounts in, a persona with its described sentences out.
 *
 * `base` is the persona the user already had, for the case where the
 * accounts arrive later (C7.4): the described fields are written over it
 * and everything else is kept.
 */
export async function describedPersonaData(params: {
  accounts: OralAccountForExtraction[];
  name: string;
  locale?: Locale;
  base?: Record<string, unknown>;
  invoke: (messages: LLMMessage[]) => Promise<string | null>;
}): Promise<DescribedPersonaResult> {
  const locale = params.locale ?? "zh";
  const generated = await generateDescribedStatements({
    accounts: params.accounts,
    name: params.name,
    locale,
    invoke: params.invoke,
  });
  if (!generated.readable) {
    return { ...generated, fields: {} };
  }

  const fields = fieldsFromDescribedStatements(generated.statements, locale);
  /**
   * The fields nobody described get honest words.
   *
   * The usual normaliser fallbacks describe a gentle person with cute
   * filler words, which is a voice the user never described. For a
   * persona with no records that would be invented — so the fallback
   * here says what is actually true: the persona was written from a
   * description, and the empty fields could not be measured.
   */
  const fallback: Partial<PersonaData> = {
    personality: copy(locale, "labels.persona.describedFallback", { name: params.name }),
    speakingStyle: copy(locale, "labels.persona.describedSpeakingStyle"),
    catchphrases: [],
    nickname: params.name,
    attachmentStyle: copy(locale, "labels.persona.unknown"),
    summary: copy(locale, "labels.persona.describedFallback", { name: params.name }),
  };
  const personaData = normalizePersonaData(
    {
      ...(params.base ?? {}),
      ...fields,
      described: generated.statements,
    },
    { name: params.name, fallback, locale },
  );
  return { ...generated, fields, personaData };
}
