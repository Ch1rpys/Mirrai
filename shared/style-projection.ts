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

export const PROJECTION_RULES: ProjectionRule[] = [
  "strip_period",
  "strip_tilde",
  "laugh_runs",
  "ellipsis_form",
  "exclaim_runs",
  "comma_to_space",
  "strip_emoji",
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

export function projectStyle(
  text: string,
  fp: StyleFingerprintCore,
  rng: () => number,
): ProjectionResult {
  const applied: ProjectionRule[] = [];
  const bubbles = text.split("\n");
  const out = bubbles.map((bubble) => {
    let next = bubble;
    for (const rule of PROJECTION_RULES) {
      if (!ruleApplies(rule, fp)) continue;
      const projected = applyRule(rule, next, fp, rng);
      if (projected !== next) {
        if (!applied.includes(rule)) applied.push(rule);
        next = projected;
      }
    }
    return next;
  });
  return { text: out.join("\n"), applied };
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
