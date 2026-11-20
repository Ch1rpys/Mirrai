/**
 * The tokens a record search is built from.
 *
 * PostgreSQL's own text-search configurations cannot cut Chinese: the
 * `simple` configuration keeps a whole run of characters as one word,
 * and the language configurations assume spaces. The application does
 * the cutting instead and stores the result in a `tsvector`, which
 * PostgreSQL can index and query.
 *
 * A run of Han characters, kana, or hangul becomes every adjacent pair
 * of characters (`喜欢海` -> `喜欢`, `欢海`). A single character stays
 * itself. Latin letters and digits become lower-cased words.
 *
 * The rule lives here, in `shared/`, so the ingestion side and the query
 * side are guaranteed to produce the same tokens.
 */

const MAX_TOKENS = 2000;

/** The characters treated as one unbroken run per script. */
function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana and Katakana
    (codePoint >= 0xac00 && codePoint <= 0xd7af) // Hangul syllables
  );
}

function isLatinWord(codePoint: number): boolean {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) || // 0-9
    (codePoint >= 0x41 && codePoint <= 0x5a) || // A-Z
    (codePoint >= 0x61 && codePoint <= 0x7a) // a-z
  );
}

/**
 * The tokens of one piece of text, de-duplicated in the order seen.
 *
 * At most 2000 of them: a `tsvector` with every bigram of a long
 * message is large, and a search needs no more than this.
 */
export function searchTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };

  let cjkRun: number[] = [];
  let wordRun: number[] = [];

  const flushCjk = () => {
    if (cjkRun.length === 1) {
      push(String.fromCodePoint(cjkRun[0]!));
    } else {
      for (let i = 0; i + 1 < cjkRun.length; i++) {
        push(String.fromCodePoint(cjkRun[i]!, cjkRun[i + 1]!));
      }
    }
    cjkRun = [];
  };
  const flushWord = () => {
    if (wordRun.length > 0) {
      push(String.fromCodePoint(...wordRun).toLowerCase());
      wordRun = [];
    }
  };

  for (const character of text ?? "") {
    const codePoint = character.codePointAt(0)!;
    if (isCjk(codePoint)) {
      flushWord();
      cjkRun.push(codePoint);
    } else if (isLatinWord(codePoint)) {
      flushCjk();
      wordRun.push(codePoint);
    } else {
      flushCjk();
      flushWord();
    }
    if (out.length >= MAX_TOKENS) break;
  }
  flushCjk();
  flushWord();
  return out.slice(0, MAX_TOKENS);
}

/**
 * The tokens of a query.
 *
 * The same function as ingestion: a query cannot search for a token
 * that was never stored.
 */
export function queryLexemes(query: string): string[] {
  return searchTokens(query);
}

/**
 * A `to_tsquery` string from the tokens.
 *
 * Every token is quoted; a single quote or a backslash inside one is
 * doubled, per PostgreSQL's lexeme quoting rules
 * (https://www.postgresql.org/docs/current/datatype-textsearch.html).
 * An empty token list produces an empty string — never a query that
 * would match nothing silently.
 */
export function toTsQuery(lexemes: string[], op: "&" | "|"): string {
  if (lexemes.length === 0) return "";
  const joiner = op === "&" ? " & " : " | ";
  return lexemes
    .map((lexeme) => `'${lexeme.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`)
    .join(joiner);
}
