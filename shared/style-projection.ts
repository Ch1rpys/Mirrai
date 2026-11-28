/**
 * Deterministic punctuation projection.
 *
 * Each rule fires only when the fingerprint has counted enough of that
 * habit. Nothing here invents words, numbers, or "more human" noise.
 */
import type { StyleFingerprintCore } from "./style-fingerprint";

export type ProjectionRule =
  | "strip_period"
  | "strip_tilde"
  | "laugh_runs"
  | "ellipsis_form"
  | "exclaim_runs"
  | "comma_to_space"
  | "strip_emoji"
  | "punct_width";

/**
 * `strip_emoji` runs first: every other rule works on the characters it
 * leaves behind. It used to run last, so removing an emoji could expose a
 * trailing tilde or period, join two `哈` into one run, or reveal a comma
 * now sitting between two Han characters — after the rule that would have
 * acted on them had already run. One pass was not a fixed point (B3.4).
 *
 * The rest keep this order because no later rule creates input for an
 * earlier one: `laugh_runs` keeps a run a run and runs after the only rule
 * that can split one, `ellipsis_form` only emits tokens `strip_period`
 * protects, `exclaim_runs` caps a length `punct_width` does not change,
 * and `comma_to_space` already reads both comma widths before
 * `punct_width` rewrites them.
 */
export const PROJECTION_RULES: ProjectionRule[] = [
  "strip_emoji",
  "strip_period",
  "strip_tilde",
  "laugh_runs",
  "ellipsis_form",
  "exclaim_runs",
  "comma_to_space",
  "punct_width",
];

export interface ProjectionResult {
  text: string;
  applied: ProjectionRule[];
}

/**
 * A comma between two Han characters — either width.
 *
 * The full-width one only used to match, so a full-width preference turn
 * of `punct_width` reintroduced a `，` that the next pass turned into a
 * space: the projection never reached a fixed point. Both widths are the
 * same habit, so both count as the thing `comma_to_space` learned.
 */
const HAN_COMMA_RE = /(\p{Script=Han})[,，](\p{Script=Han})/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
// i18n:allow-input — the laugh character counted in the records, not copy.
const LAUGH_CHAR = "哈";
const HA_RUN_RE = new RegExp(`${LAUGH_CHAR}{2,}`, "g");
const EXCLAIM_RUN_RE = /[！!]+/g;
const ELLIPSIS_PROTECT_RE = /。{2,}|\.{3,}|…+|⋯+/g;

const FULL_TO_HALF: Record<string, string> = { "？": "?", "！": "!", "，": "," };
const HALF_TO_FULL: Record<string, string> = { "?": "？", "!": "！", ",": "，" };

// i18n:allow-input — English abbreviations whose trailing period is not a
// sentence end; matched against the model's own line, not shown as copy.
const COMMON_ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "vs",
  "etc",
  "no",
  "vol",
  "fig",
  "pp",
  "inc",
  "ltd",
  "co",
  "corp",
  "bros",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

/**
 * How many times the ordered pipeline may run before the text counts as
 * settled.
 *
 * `strip_period` and `strip_tilde` can expose each other: `好~。` ends on a
 * period, stripping it leaves `~` at the end, and `好。~` is the same pair
 * the other way round. Neither order is a fixed point for both sentences,
 * so the ordered pipeline is iterated instead of trusting one pass; the
 * other pairs settle in the first pass. Each pass removes at most one
 * trailing mark per bubble, so the cap is set above any plausible chain
 * of them; the loop is cheap and stops as soon as a pass changes
 * nothing, so ordinary text takes one or two passes.
 */
const MAX_PROJECTION_PASSES = 16;

export function projectStyle(
  text: string,
  fp: StyleFingerprintCore,
  rng: () => number,
): ProjectionResult {
  const applied: ProjectionRule[] = [];
  let current = text;
  for (let pass = 0; pass < MAX_PROJECTION_PASSES; pass++) {
    let changed = false;
    const bubbles = current.split("\n");
    const out = bubbles.map((bubble) => {
      let next = bubble;
      for (const rule of PROJECTION_RULES) {
        /**
         * `laugh_runs` runs on the first pass only. It draws from `rng`; a
         * second draw in the same call would advance the sequence and
         * re-sample runs it has already sampled, so the call would stop
         * being deterministic and the next call would not land on the same
         * fixed point. No later rule creates a `哈` run, so once is enough
         * once emoji are gone.
         */
        if (pass > 0 && rule === "laugh_runs") continue;
        if (!ruleApplies(rule, fp)) continue;
        const projected = applyRule(rule, next, fp, rng);
        if (projected !== next) {
          changed = true;
          if (!applied.includes(rule)) applied.push(rule);
          next = projected;
        }
      }
      return next;
    });
    current = out.join("\n");
    if (!changed) break;
  }
  return { text: current, applied };
}

function ruleApplies(rule: ProjectionRule, fp: StyleFingerprintCore): boolean {
  switch (rule) {
    case "strip_period":
      return fp.samples >= 100 && fp.endings.period < 0.03;
    case "strip_tilde":
      return fp.samples >= 100 && fp.endings.tilde < 0.01;
    case "laugh_runs":
      return haRunCount(fp.laugh.haRuns) >= 10;
    case "ellipsis_form":
      return dominantEllipsis(fp) != null;
    case "exclaim_runs":
      return markRunTotal(fp.punctuation.exclaimRuns) >= 10;
    case "comma_to_space":
      return (
        fp.samples >= 200 &&
        fp.punctuation.spaceAsComma >= 0.6 &&
        fp.punctuation.commaPerChar < 0.002
      );
    case "strip_emoji":
      return fp.samples >= 200 && fp.emoji.rate < 0.005;
    case "punct_width": {
      const marks = fp.punctuation.markCount ?? 0;
      const rate = fp.punctuation.halfWidthRate;
      return marks >= 30 && (rate >= 0.9 || rate <= 0.1);
    }
  }
}

function applyRule(
  rule: ProjectionRule,
  text: string,
  fp: StyleFingerprintCore,
  rng: () => number,
): string {
  switch (rule) {
    case "strip_period":
      return stripPeriod(text);
    case "strip_tilde":
      return text.replace(/[～~]+$/u, "");
    case "laugh_runs":
      return text.replace(HA_RUN_RE, () =>
        LAUGH_CHAR.repeat(sampleRunLength(fp.laugh.haRuns, rng, 2)),
      );
    case "ellipsis_form": {
      const form = dominantEllipsis(fp);
      return form ? rewriteEllipsis(text, form) : text;
    }
    case "exclaim_runs":
      return capExclaimRuns(text, maxRunLength(fp.punctuation.exclaimRuns));
    case "comma_to_space":
      return commasToSpaces(text);
    case "strip_emoji":
      return text.replace(EMOJI_RE, "");
    case "punct_width":
      return rewriteWidth(text, fp.punctuation.halfWidthRate >= 0.9 ? "half" : "full");
  }
}

function stripPeriod(text: string): string {
  const kept: string[] = [];
  const protectedText = text.replace(ELLIPSIS_PROTECT_RE, (match) => {
    kept.push(match);
    return `\u0000${kept.length - 1}\u0000`;
  });
  /**
   * Only the end of each bubble.
   *
   * The manual's rule is "the single 。 at the end of every bubble". This
   * used to delete every ideographic period that was not beside a digit,
   * so a two-sentence reply lost the full stop in the middle of itself —
   * a change to the sentence, not to the habit.
   */
  const withoutIdeographic = protectedText
    .split("\n")
    .map((line) => line.replace(/。$/, (mark, offset, source) => {
      const prev = source[offset - 1] ?? "";
      if (/\d/u.test(prev)) return mark;
      return "";
    }))
    .join("\n");
  const withoutDot = withoutIdeographic.replace(/[^\n]+/g, stripTrailingAsciiDot);
  return withoutDot.replace(/\u0000(\d+)\u0000/g, (_, index) => kept[Number(index)] ?? "");
}

function stripTrailingAsciiDot(line: string): string {
  if (!line.endsWith(".")) return line;
  const before = line.slice(0, -1);
  if (/\d$/u.test(before)) return line;
  if (/https?:\/\/\S+$/i.test(before) || /www\.\S+$/i.test(before)) return line;
  const tail = before.match(/[A-Za-z.]+$/)?.[0] ?? "";
  if (tail.includes(".")) return line;
  if (/^[A-Z]{1,3}$/.test(tail)) return line;
  if (COMMON_ABBREVIATIONS.has(tail.toLowerCase())) return line;
  return before;
}

function rewriteEllipsis(text: string, form: "unicode" | "dots" | "cjkDots"): string {
  const token = form === "unicode" ? "…" : form === "dots" ? "..." : "。。。";
  return text
    .replace(/。{2,}/g, token)
    .replace(/⋯+/g, token)
    .replace(/…+/g, token)
    .replace(/\.{3,}/g, token);
}

function dominantEllipsis(
  fp: StyleFingerprintCore,
): "unicode" | "dots" | "cjkDots" | null {
  const forms = fp.punctuation.ellipsisForms;
  const total = forms.unicode + forms.dots + forms.cjkDots;
  if (total < 10) return null;
  const ranked: Array<["unicode" | "dots" | "cjkDots", number]> = [
    ["unicode", forms.unicode],
    ["dots", forms.dots],
    ["cjkDots", forms.cjkDots],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const winner = ranked[0];
  if (!winner || winner[1] / total < 0.8) return null;
  return winner[0];
}

function capExclaimRuns(text: string, maxLen: number): string {
  if (maxLen < 1) return text;
  return text.replace(EXCLAIM_RUN_RE, (run) => {
    const chars = Array.from(run);
    if (chars.length <= maxLen) return run;
    return (chars[0] ?? "！").repeat(maxLen);
  });
}

function commasToSpaces(text: string): string {
  let next = text;
  for (;;) {
    const replaced = next.replace(HAN_COMMA_RE, "$1 $2");
    if (replaced === next) return next;
    next = replaced;
  }
}

function rewriteWidth(text: string, side: "half" | "full"): string {
  const table = side === "half" ? FULL_TO_HALF : HALF_TO_FULL;
  return Array.from(text)
    .map((char) => table[char] ?? char)
    .join("");
}

function haRunCount(runs: number[]): number {
  return runs.reduce((sum, count, length) => sum + (length >= 2 ? count : 0), 0);
}

/**
 * The mark-run buckets are zero-based: bucket i counts runs of i + 1
 * marks (`bumpRun` in `style-fingerprint.ts` writes `length - 1`). These
 * two helpers used the index as the length, so a measured cap of three
 * was applied as two.
 */
function markRunTotal(runs: number[]): number {
  return runs.reduce((sum, count, index) => sum + count * (index + 1), 0);
}

function maxRunLength(runs: number[]): number {
  let max = 0;
  for (let index = 0; index < runs.length; index++) {
    if ((runs[index] ?? 0) > 0) max = index + 1;
  }
  return max;
}

function sampleRunLength(runs: number[], rng: () => number, minLen: number): number {
  const total = haRunCount(runs);
  if (total <= 0) return minLen;
  let cursor = rng() * total;
  for (let length = minLen; length < runs.length; length++) {
    cursor -= runs[length] ?? 0;
    if (cursor < 0) return length;
  }
  return Math.max(minLen, runs.length - 1);
}
