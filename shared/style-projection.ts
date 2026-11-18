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

const HAN_COMMA_RE = /(\p{Script=Han})，(\p{Script=Han})/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HA_RUN_RE = /哈{2,}/g;
const EXCLAIM_RUN_RE = /[！!]+/g;
const ELLIPSIS_PROTECT_RE = /。{2,}|\.{3,}|…+|⋯+/g;

const FULL_TO_HALF: Record<string, string> = { "？": "?", "！": "!", "，": "," };
const HALF_TO_FULL: Record<string, string> = { "?": "？", "!": "！", ",": "，" };

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
      return text.replace(HA_RUN_RE, () => "哈".repeat(sampleRunLength(fp.laugh.haRuns, rng, 2)));
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
  const withoutIdeographic = protectedText.replace(/。/g, "");
  const withoutDot = withoutIdeographic.replace(/[^\n]+/g, stripTrailingAsciiDot);
  return withoutDot.replace(/\u0000(\d+)\u0000/g, (_, index) => kept[Number(index)] ?? "");
}

function stripTrailingAsciiDot(line: string): string {
  if (!line.endsWith(".")) return line;
  const before = line.slice(0, -1);
  if (/\d$/u.test(before)) return line;
  if (/[A-Za-z]$/u.test(before)) return line;
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
  const winner = (
    [
      ["unicode", forms.unicode],
      ["dots", forms.dots],
      ["cjkDots", forms.cjkDots],
    ] as const
  ).sort((a, b) => b[1] - a[1])[0];
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

function markRunTotal(runs: number[]): number {
  return runs.reduce((sum, count, length) => sum + count * length, 0);
}

function maxRunLength(runs: number[]): number {
  let max = 0;
  for (let length = 0; length < runs.length; length++) {
    if ((runs[length] ?? 0) > 0) max = length;
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
