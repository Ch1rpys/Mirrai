/**
 * What people remember about the person (C7.4).
 *
 * A family may know somebody from different sides: one remembers the
 * habit, another remembers a saying. The accounts are theirs; the only
 * thing taken from them is a statement that can be checked against the
 * words they actually submitted.
 *
 * The rule that makes this safe is in `parseOralStatements`: a quote
 * that is not a literal substring of a submitted account is dropped.
 * Not rewritten, not shortened to fit — dropped. An extracted
 * statement without its own words is a statement somebody made up, and
 * this feature exists because they are being remembered.
 */

/** The shapes a remembered thing can take. */
export const ORAL_KINDS = ["trait", "habit", "saying", "fact", "story"] as const;

export type OralKind = (typeof ORAL_KINDS)[number];

/** One submitted account, as the extraction reads it. */
export interface OralAccountForExtraction {
  id: number;
  tellerName: string;
  body: string;
}

/** One thing somebody told, with the words that support it. */
export interface OralStatement {
  kind: OralKind;
  /**
   * The stable key two tellers' statements meet on.
   *
   * It is ASCII and snake_case so that two accounts of the same thing —
   * "smokes", "likes_smoking" — can be normalised to one key by the
   * model, and so that it reads as an identifier rather than as prose.
   */
  key: string;
  /** The statement, in the app's own words. */
  text: string;
  /** The teller's own words. Always a substring of `body`. */
  quote: string;
  /** Which account the quote was found in. */
  accountId: number;
  /** Who told it. */
  tellerName: string;
}

export interface ParsedOralAnswer {
  statements: OralStatement[];
  /** How many the model gave that could not be used. */
  dropped: number;
}

/**
 * At most this many statements from one run.
 *
 * The model is asked for a small number; a runaway answer is trimmed
 * and the count of what was trimmed is reported, the same way the
 * memory extraction reports it.
 */
export const ORAL_MAX_STATEMENTS = 40;

/** The longest key a fact key may hold — the column is 120. */
const KEY_MAX = 60;

/**
 * The normal form of a key.
 *
 * The model is asked for lowercase ASCII snake_case. Anything else is
 * rejected rather than guessed at: a key that is not shared between two
 * accounts cannot show that they disagree, and a Chinese key would not
 * survive the same normalisation twice.
 */
export function normalizeOralKey(raw: unknown): string | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(key)) return null;
  return key.slice(0, KEY_MAX);
}

/** The longest statement or quote kept from one answer. */
const TEXT_MAX = 200;

function cleanText(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Reads the model's answer, keeping only what the accounts support.
 *
 * A statement is kept when its kind, key and text are usable and its
 * quote is a literal substring of one of the submitted accounts. The
 * teller is taken from the account the quote was found in — never from
 * the model's answer.
 */
export function parseOralStatements(
  raw: unknown,
  accounts: OralAccountForExtraction[],
): ParsedOralAnswer {
  const items = Array.isArray(raw) ? raw : [];
  const statements: OralStatement[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const item of items) {
    if (statements.length >= ORAL_MAX_STATEMENTS) {
      dropped += 1;
      continue;
    }
    const row = (item ?? {}) as Record<string, unknown>;
    const kind = cleanText(row.kind).toLowerCase();
    const key = normalizeOralKey(row.key);
    const text = cleanText(row.text);
    const quote = cleanText(row.quote);
    if (!ORAL_KINDS.includes(kind as OralKind) || !key || !text || !quote) {
      dropped += 1;
      continue;
    }
    const account = accounts.find((candidate) => candidate.body.includes(quote));
    if (!account) {
      dropped += 1;
      continue;
    }
    /**
     * The same run may say the same thing twice.
     *
     * Two statements meet on `key`; two statements that also say the
     * same thing are one statement.
     */
    const signature = `${key}\u0000${text.toLowerCase()}`;
    if (seen.has(signature)) {
      dropped += 1;
      continue;
    }
    seen.add(signature);
    statements.push({
      kind: kind as OralKind,
      key,
      text: text.slice(0, TEXT_MAX),
      quote: quote.slice(0, TEXT_MAX),
      accountId: account.id,
      tellerName: account.tellerName,
    });
  }

  return { statements, dropped };
}

/**
 * Whether two memories are the same claim.
 *
 * The extraction runs again when a family adds an account, and a run
 * that stores what it already holds turns one story into four.
 */
export function oralClaimKey(factKey: string | null | undefined, title: string): string {
  return `${String(factKey ?? "").trim().toLowerCase()}\u0000${cleanText(title).toLowerCase()}`;
}
