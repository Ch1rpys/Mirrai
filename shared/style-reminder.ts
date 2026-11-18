/**
 * Six of their usual lines, and a nudge when the last few drifted.
 *
 * The pool is measured; this file only picks the six and reads the
 * residue of the live replies.
 */
import { copy, type Locale } from "./copy";
import { scoreResidue } from "./assistant-residue";
import {
  endingClassOf,
  FINGERPRINT_STATES,
  lineSurprise,
  type EmotionalState,
  type StyleFingerprint,
  type StyleFingerprintCore,
} from "./style-fingerprint";
import type { SamplePool } from "./sample-pool";

export const STYLE_REMINDER_COUNT = 6;
export const STYLE_REMINDER_BATCH = 6;
export const REANCHOR_WINDOW = 8;
export const REANCHOR_RESIDUE = 0.3;
export const REANCHOR_SURPRISE_MULT = 1.5;
export const REANCHOR_PERIOD_RARE = 0.15;
export const REANCHOR_ISSUE_SHARE = 0.5;

export const REANCHOR_ISSUES = ["long", "question", "period", "cliche"] as const;
export type ReanchorIssue = (typeof REANCHOR_ISSUES)[number];

export const REANCHOR_ISSUE_COPY = {
  long: "prompt.reanchorIssueLong",
  question: "prompt.reanchorIssueQuestion",
  period: "prompt.reanchorIssuePeriod",
  cliche: "prompt.reanchorIssueCliche",
} as const satisfies Record<ReanchorIssue, "prompt.reanchorIssueLong" | "prompt.reanchorIssueQuestion" | "prompt.reanchorIssuePeriod" | "prompt.reanchorIssueCliche">;

function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copyItems = items.slice();
  for (let i = copyItems.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copyItems[i]!;
    copyItems[i] = copyItems[j]!;
    copyItems[j] = swap;
  }
  return copyItems;
}

export function styleReminderSeed(personaId: number, chatCount: number): string {
  const count = Number.isFinite(chatCount) ? Math.max(0, chatCount) : 0;
  return `${personaId}:${Math.floor(count / STYLE_REMINDER_BATCH)}`;
}

/**
 * Prefer the current mood's pool, fill from `any`, skip lines already
 * sitting in the exemplar section or the seed turns.
 */
export function pickStyleReminderLines(params: {
  pool: SamplePool;
  state?: string | null;
  rng: () => number;
  skip?: Iterable<string>;
  count?: number;
}): string[] {
  const skip = new Set(
    [...(params.skip ?? [])].map((line) => line.trim()).filter(Boolean),
  );
  const take = (lines: string[], seen: Set<string>): string[] => {
    const out: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || skip.has(trimmed) || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  };
  const seen = new Set<string>();
  const preferred = take(
    isEmotionalState(params.state) ? (params.pool[params.state] ?? []) : [],
    seen,
  );
  const any = take(params.pool.any ?? [], seen);
  const count = params.count ?? STYLE_REMINDER_COUNT;
  if (preferred.length >= count) return shuffle(preferred, params.rng).slice(0, count);
  const fill = shuffle(any, params.rng).slice(0, Math.max(0, count - preferred.length));
  return [...preferred, ...fill];
}

export function formatReanchorIssues(issues: ReanchorIssue[], locale: Locale): string {
  const joiner = locale === "en" ? ", " : "、";
  return issues.map((issue) => copy(locale, REANCHOR_ISSUE_COPY[issue])).join(joiner);
}

function assistantLines(
  history: Array<{ role?: string; content?: string | null }>,
): string[] {
  return history
    .filter((row) => row.role === "assistant")
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean)
    .slice(-REANCHOR_WINDOW);
}

/**
 * Whether the last eight replies have drifted far enough to say so.
 *
 * Residue uses the per-state core when there is one; the surprise cut
 * is the overall 75th percentile, which is what B3.2 stored.
 */
export function detectReanchor(params: {
  history: Array<{ role?: string; content?: string | null }>;
  fingerprint?: StyleFingerprint | null;
  core?: StyleFingerprintCore | null;
}): { issues: ReanchorIssue[]; rollingResidue: number; rollingSurprise: number } | null {
  const recent = assistantLines(params.history);
  if (recent.length < REANCHOR_WINDOW) return null;
  const core = params.core ?? params.fingerprint ?? null;
  if (!core?.endings || !core.length) return null;
  const ceiling = core.length.p90;
  const residues = recent.map((line) => scoreResidue(line, { ceiling }));
  const surprises = recent.map((line) => lineSurprise(line, core));
  const rollingResidue = residues.reduce((sum, row) => sum + row.rate, 0) / residues.length;
  const rollingSurprise = surprises.reduce((sum, value) => sum + value, 0) / surprises.length;
  const surpriseCut =
    typeof params.fingerprint?.surpriseP75 === "number"
      ? REANCHOR_SURPRISE_MULT * params.fingerprint.surpriseP75
      : Number.POSITIVE_INFINITY;
  if (rollingResidue < REANCHOR_RESIDUE && rollingSurprise < surpriseCut) return null;

  const share = (count: number) => count / recent.length >= REANCHOR_ISSUE_SHARE;
  const issues: ReanchorIssue[] = [];
  if (share(residues.filter((row) => row.tooLong).length)) issues.push("long");
  if (share(residues.filter((row) => row.questionEnding).length)) issues.push("question");
  const periodEnds = recent.filter((line) => endingClassOf(line) === "period").length;
  if (share(periodEnds) && (core.endings.period ?? 0) <= REANCHOR_PERIOD_RARE) {
    issues.push("period");
  }
  if (share(residues.filter((row) => row.emotionCliche).length)) issues.push("cliche");
  if (issues.length === 0) return null;
  return { issues, rollingResidue, rollingSurprise };
}
