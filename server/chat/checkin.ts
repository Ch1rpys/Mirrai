/**
 * The reminder the persona agreed to bring up (C9.4).
 *
 * The `set_reminder` tool stores the user's own sentence and a moment.
 * This is the other half: when that moment arrives — and only if the
 * user has not written since — the persona says one line about it.
 *
 * It is written the way the persona's first words are written: the same
 * system prompt, a user message that says what this turn is, and the
 * sentence the user asked to be reminded about **inside a fence**. The
 * line is material, not an instruction: a reminder that says "ignore
 * your rules" is still just something the user once said.
 */
import type { Persona } from "../../drizzle/schema";
import { buildSystemPrompt } from "../_core/persona-utils";
import { invokeForUser } from "../llm";
import { asMaterial } from "@shared/material";
import { copy, type Locale } from "@shared/copy";

/** A check-in is one short question, not a letter. */
export const MAX_CHECK_IN_LENGTH = 120;

/**
 * The two messages the line is written from (C9.4).
 *
 * The reminder sentence the user once said is material: it goes inside
 * the fence, after the instruction, so a reminder that reads like an
 * order is still only something they said.
 */
export function buildCheckInMessages(params: {
  persona: Persona;
  reminderText: string;
  locale: Locale;
  now: Date;
}) {
  const systemPrompt = buildSystemPrompt(params.persona, {
    anchorSection: "",
    memorySection: "",
    userContext: "",
    locale: params.locale,
    now: params.now,
  });
  return [
    { role: "system" as const, content: systemPrompt },
    {
      role: "user" as const,
      content: [
        copy(params.locale, "prompts.checkInInstruction"),
        asMaterial(params.reminderText, params.locale),
      ].join("\n\n"),
    },
  ];
}

/**
 * Writes the line. Returns null when nothing answered — the sweep then
 * gives the item back and tries on a later tick.
 */
export async function composeCheckInMessage(params: {
  persona: Persona;
  userId: number;
  /** The user's own sentence, stored when the tool was called. */
  reminderText: string;
  locale: Locale;
  now: Date;
}): Promise<string | null> {
  const messages = buildCheckInMessages(params);
  const text = await invokeForUser({
    userId: params.userId,
    messages,
    options: { purpose: "reply", temperature: 0.6, maxTokens: 120 },
    personaId: params.persona.id,
  }).catch((error: unknown) => {
    console.warn("[CheckIn] The line could not be written:", (error as Error).message);
    return null;
  });
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_CHECK_IN_LENGTH);
}
