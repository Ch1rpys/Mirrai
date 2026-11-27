/**
 * The shape a reply may take (B9.3).
 *
 * A constrained decoder can stop the model from answering with a list, and
 * stop it from writing ten paragraphs when the person writes one line. The
 * grammar here says only that: at most `maxLines` non-empty lines, and no
 * line starts like a list item (`-`, `*`, `#`, or a number followed by a
 * bullet mark). It says nothing about what the words are — that is the
 * prompt's job.
 *
 * It is GBNF, the format llama.cpp's server takes in the `grammar` request
 * field. Reference: <https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md>
 *
 * Two details of the format matter here:
 *
 * - There is no lookahead, so "a digit that is not a list number" is written
 *   as "a digit followed by a character that is not a bullet mark".
 * - `\-` is the escape for a literal hyphen inside a character class; the
 *   parser supports it (`parse_char` in `llama-grammar.cpp`).
 *
 * llama.cpp only. Ollama has no custom grammar, and there the existing
 * layers — the stop sequences of B2.7 and the projection of B3.4 — carry
 * this instead.
 */
export const GRAMMAR_MAX_LINES = 10;
export const GRAMMAR_DEFAULT_LINES = 3;

export interface ShapeGrammarInput {
  /** The most lines one reply may have. */
  maxLines?: number;
}

function normalizeMaxLines(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return GRAMMAR_DEFAULT_LINES;
  return Math.min(GRAMMAR_MAX_LINES, Math.max(1, Math.round(n)));
}

/**
 * The GBNF text for a reply of at most `maxLines` non-list lines.
 *
 * The trailing newline is allowed but not required, because that is how a
 * chat message usually ends.
 */
export function shapeGrammar(input: ShapeGrammarInput = {}): string {
  const maxLines = normalizeMaxLines(input.maxLines);
  const moreLines = `(nl line){0,${maxLines - 1}}`;
  return [
    "# at most " + maxLines + " lines, none starting like a list item",
    "root ::= line " + moreLines + " nl?",
    'nl ::= "\\n"',
    /**
     * A line may start with a number only when it is not a list marker.
     *
     * `digit` used to be a single character and `safe` refused the
     * punctuation right after it, so "12. " got through: the second
     * character was "2", not "." (B9.3).
     */
    "line ::= plain rest | digits | digits spacer rest",
    "plain ::= [^*#0-9\\n\\-]",
    "rest ::= [^\\n]*",
    "digits ::= [0-9]+",
    "spacer ::= [^.、)）\\n]",
  ].join("\n");
}
