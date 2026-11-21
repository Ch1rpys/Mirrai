/**
 * What the user described about a person (C1.8).
 *
 * Somebody who has no chat logs can still be described: in an interview,
 * or by the family in the oral accounts of C7.4. What comes out of that is
 * not a measurement — it is a claim, and each claim has to carry the words
 * it was made from.
 *
 * The rule that makes this safe is in `parseDescribedStatements`: a quote
 * that is not a literal substring of one of the accounts is dropped. Not
 * rewritten, not nudged to fit — dropped. A described sentence without its
 * own words is a sentence somebody made up, and this path exists because
 * the person it describes is not here to correct it.
 */
import type { OralAccountForExtraction } from "./oral";

/**
 * The persona fields a described sentence can fill.
 *
 * It is a closed set so the model cannot invent a field, and it maps onto
 * the existing `personaData` fields so the rest of the app — the prompt,
 * the profile page, the card export — does not need a second shape.
 */
export const DESCRIBED_FIELDS = [
  "personality",
  "speakingStyle",
  "catchphrase",
  "address",
  "likes",
  "routine",
  "people",
  "story",
  "boundaries",
] as const;

export type DescribedField = (typeof DESCRIBED_FIELDS)[number];

/** One sentence about the person, with the words that support it. */
export interface DescribedStatement {
  /** The statement, in the app's own words. */
  text: string;
  /** Always this value: the sentence came from somebody's description. */
  source: "described";
  /** The teller's own words. Always a substring of an account. */
  quote: string;
  /** Which field of the persona this sentence fills. */
  field?: DescribedField;
  /** Who told it (C7.4): the family member or the user themself. */
  teller?: string;
  /** The account the quote was found in, when it came from a stored one. */
  accountId?: number;
}

/** At most this many statements from one description. */
export const DESCRIBED_MAX_STATEMENTS = 40;

/** The longest statement kept from one answer. */
const TEXT_MAX = 240;
/** The longest quote kept from one answer. */
const QUOTE_MAX = 300;
/** The column the account's teller name is stored in. */
const TELLER_MAX = 64;

function clean(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function isDescribedField(value: string): value is DescribedField {
  return (DESCRIBED_FIELDS as readonly string[]).includes(value);
}

function fieldOf(raw: unknown): DescribedField {
  const value = clean(raw).toLowerCase();
  return isDescribedField(value) ? value : "personality";
}

/**
 * Reads the model's answer, keeping only what the accounts support.
 *
 * A statement is kept when it has text and a quote, and the quote is a
 * literal substring of one of the accounts. The teller is taken from the
 * account the quote was found in — never from the model's answer.
 *
 * The substring check compares whitespace-normalised text on both sides.
 * The accounts are written by people, so a quote that spans a line break
 * in the original still has to match; the words themselves are checked
 * verbatim.
 */
export function parseDescribedStatements(
  raw: unknown,
  accounts: OralAccountForExtraction[],
): { statements: DescribedStatement[]; dropped: number } {
  const items = Array.isArray(raw) ? raw : [];
  const statements: DescribedStatement[] = [];
  const seen = new Set<string>();
  /**
   * Both sides are compared with the whitespace taken out.
   *
   * The quote is copied by a model, and the accounts are written by
   * people: the same words may run across a line break in one and a
   * space in the other. Removing the whitespace keeps the words verbatim
   * while making those two the same quote.
   */
  const compact = (text: string): string => clean(text).replace(/\s+/g, "");
  /**
   * What the person said, without the interviewer's questions.
   *
   * An interview transcript is stored as `问：…\n答：…` lines, and the
   * question is written by the model (and echoed by the client). If the
   * whole transcript counts as "the original words", a model can tie a
   * claim to its own question — a statement the person never made passes
   * the substring check. The answer lines are the evidence; a body with
   * no interview markers (a general oral account) is used whole, as
   * before.
   */
  const answerOnly = (body: string): string => {
    const lines = body.split("\n");
    const answers = lines
      .filter((line) => /^\s*答[：:]/.test(line))
      .map((line) => line.replace(/^\s*答[：:]\s*/, ""));
    return answers.length > 0 ? answers.join("\n") : body;
  };
  const normalisedAccounts = accounts.map((account) => ({
    account,
    body: compact(answerOnly(account.body)),
  }));
  let dropped = 0;

  for (const item of items) {
    if (statements.length >= DESCRIBED_MAX_STATEMENTS) {
      dropped += 1;
      continue;
    }
    const row = (item ?? {}) as Record<string, unknown>;
    const text = clean(row.text);
    const quote = clean(row.quote);
    if (!text || !quote) {
      dropped += 1;
      continue;
    }
    const match = normalisedAccounts.find((entry) =>
      entry.body.includes(compact(quote)),
    );
    if (!match) {
      dropped += 1;
      continue;
    }
    const field = fieldOf(row.field);
    /**
     * The same run may say the same thing twice. Two sentences that fill
     * the same field and say the same words are one sentence.
     */
    const signature = `${field}\u0000${text.toLowerCase()}`;
    if (seen.has(signature)) {
      dropped += 1;
      continue;
    }
    seen.add(signature);
    statements.push({
      text: text.slice(0, TEXT_MAX),
      source: "described",
      quote: quote.slice(0, QUOTE_MAX),
      field,
      teller: String(match.account.tellerName ?? "").trim().slice(0, TELLER_MAX) || undefined,
      accountId: match.account.id > 0 ? match.account.id : undefined,
    });
  }

  return { statements, dropped };
}

/**
 * Reads the statements stored in `personaData.described`.
 *
 * A stored statement without its quote is not kept: the quote is the only
 * thing that makes it checkable, and the profile page shows it as the
 * evidence for the sentence beside it.
 */
export function normalizeDescribedStatements(value: unknown): DescribedStatement[] {
  const items = Array.isArray(value) ? value : [];
  const out: DescribedStatement[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (out.length >= DESCRIBED_MAX_STATEMENTS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const text = clean(row.text);
    const quote = clean(row.quote);
    if (!text || !quote) continue;
    const field = fieldOf(row.field);
    const signature = `${field}\u0000${text.toLowerCase()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const teller = clean(row.teller).slice(0, TELLER_MAX);
    const accountId = Number(row.accountId);
    out.push({
      text: text.slice(0, TEXT_MAX),
      source: "described",
      quote: quote.slice(0, QUOTE_MAX),
      field,
      ...(teller ? { teller } : {}),
      ...(Number.isInteger(accountId) && accountId > 0 ? { accountId } : {}),
    });
  }
  return out;
}
