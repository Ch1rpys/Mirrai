/**
 * Turning what people told us into memories (C7.4).
 *
 * The owner presses one button; every submitted account is read, the
 * model is asked what it says about the person, and every statement is
 * checked against the words that were actually submitted. A quote that
 * is not a literal substring is dropped, so a statement without its own
 * words never becomes a memory.
 *
 * Nothing here writes the persona: statements land in `memories` with
 * `source: "oral"`, and one person's account is what the persona says
 * about them next to what the chat already holds. When two accounts
 * disagree about the same key, both rows stay active and the existing
 * conflict panel (v5 G2) asks the owner which one is true.
 */
import type { Persona } from "../../drizzle/schema";
import { copy } from "@shared/copy";
import { asMaterial } from "@shared/material";
import {
  oralClaimKey,
  parseOralStatements,
  type OralAccountForExtraction,
  type OralStatement,
} from "@shared/oral";
import { extractJsonArray } from "../_core/json";
import { llmService } from "../llm";
import type { LLMMessage } from "../llm/types";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import * as db from "../db";
import type { Locale } from "@shared/copy";

/** The accounts the extraction reads. */
export interface OralExtractionParams {
  persona: Persona;
  userId: number;
  accounts: OralAccountForExtraction[];
  locale?: Locale;
}

export interface OralExtractionResult {
  created: number;
  /** Statements the model gave that could not be used. */
  dropped: number;
  /** Statements that were already held — an account was added, the rest did not change. */
  repeated: number;
  /** Whether the answer could be read at all. */
  readable: boolean;
  /** The keys two tellers disagree on. */
  conflictKeys: string[];
}

/**
 * The messages for one extraction.
 *
 * Exported so the fence test can hold the accounts without a provider:
 * what people told us is material, like the records, and it must not
 * read as an instruction.
 */
export function buildOralMessages(params: {
  accounts: OralAccountForExtraction[];
  locale?: Locale;
}): LLMMessage[] {
  const locale = params.locale ?? "zh";
  const block = params.accounts
    .map((account) => `[${account.tellerName}]\n${account.body}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: copy(locale, "prompts.oralExtract"),
    },
    {
      role: "user",
      content: asMaterial(block, locale),
    },
  ];
}

/**
 * The memory a statement becomes.
 *
 * The title is the statement; the description carries the teller and
 * their own words, so the panel can show where a claim came from and
 * two accounts of the same thing can be read side by side.
 */
export function oralMemoryRow(
  statement: OralStatement,
  locale: Locale,
): {
  title: string;
  description: string;
  factKey: string;
} {
  return {
    title: statement.text,
    description: copy(locale, "oral.memoryNote", {
      teller: statement.tellerName,
      quote: statement.quote,
    }),
    factKey: statement.key,
  };
}

/**
 * Asks the model what the accounts say, and stores what can be checked.
 *
 * Returns zeros without calling the model when there is nothing
 * submitted — the button is allowed to be pressed on an empty list.
 */
export async function extractOralMemories(
  params: OralExtractionParams,
): Promise<OralExtractionResult> {
  const { persona, userId, accounts } = params;
  const locale = params.locale ?? "zh";
  const empty: OralExtractionResult = {
    created: 0,
    dropped: 0,
    repeated: 0,
    readable: true,
    conflictKeys: [],
  };
  if (accounts.length === 0) return empty;

  const messages = buildOralMessages({ accounts, locale });

  let answer: string | null = null;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId,
      providerName: persona.llmProvider ?? undefined,
    });
    if (resolved.provider) {
      answer = await resolved.provider.invoke(messages, { purpose: "extract" });
    } else {
      answer = await llmService.invoke({
        messages,
        options: { purpose: "extract" },
      });
    }
  } catch (error) {
    console.warn(
      "[Oral] The accounts could not be read:",
      (error as Error)?.message ?? error,
    );
    return { ...empty, readable: false };
  }

  const parsedAnswer = extractJsonArray(answer);
  if (parsedAnswer === null) {
    // An answer that cannot be read is not "there was nothing"; saying
    // so is the difference between "nothing new" and "the model did not
    // answer in the right shape".
    return { ...empty, readable: false };
  }

  const parsed = parseOralStatements(parsedAnswer, accounts);
  const existing = await db.getOralMemories(persona.id, persona.userId);
  const held = new Set(
    existing.map((row) => oralClaimKey(row.factKey, row.title)),
  );
  const keysSeen = new Map<string, Set<string>>();
  let created = 0;
  let repeated = 0;
  const conflictKeys: string[] = [];

  for (const statement of parsed.statements) {
    const row = oralMemoryRow(statement, locale);
    const claim = oralClaimKey(row.factKey, row.title);
    if (held.has(claim)) {
      repeated += 1;
      continue;
    }
    /**
     * The same key with different words is a disagreement, and both
     * sides stay — the conflict panel is where the owner decides. The
     * same key with the same words is the same claim and is not
     * written twice.
     */
    const texts = keysSeen.get(statement.key) ?? new Set<string>();
    if (texts.has(row.title.toLowerCase())) {
      repeated += 1;
      continue;
    }
    texts.add(row.title.toLowerCase());
    keysSeen.set(statement.key, texts);

    await db.createMemory({
      personaId: persona.id,
      userId: persona.userId,
      title: row.title.slice(0, 200),
      description: row.description,
      category: "memory",
      subject: "them",
      factKey: row.factKey,
      source: "oral",
      importance: 2,
      status: "active",
    } as any);
    held.add(claim);
    created += 1;
  }

  /**
   * Which keys now have more than one active claim.
   *
   * Read from what is stored, not from what this run produced: a
   * disagreement found last week is still a disagreement today.
   */
  const active = await db.getOralMemories(persona.id, persona.userId);
  const byKey = new Map<string, Set<string>>();
  for (const row of active) {
    if (row.status === "superseded" || !row.factKey) continue;
    const set = byKey.get(row.factKey) ?? new Set<string>();
    set.add(row.title.toLowerCase());
    byKey.set(row.factKey, set);
  }
  for (const [key, titles] of byKey) {
    if (titles.size > 1) conflictKeys.push(key);
  }

  return {
    created,
    dropped: parsed.dropped,
    repeated,
    readable: true,
    conflictKeys,
  };
}
