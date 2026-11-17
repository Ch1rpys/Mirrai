/**
 * The pairs a person is asked to tell apart, and the record of how they did.
 *
 * The evaluation already has the two lines. This file is the protocol:
 * which pairs to show, which way up they sit, how the sitting is scored,
 * and the markdown that leaves the room without taking the original
 * lines with it.
 */
import { createHash, randomBytes } from "node:crypto";
import { seededRandom } from "../_core/behavior-profile";
import { isFeedbackReason, type FeedbackReason } from "@shared/speech-acts";
import type { FeedbackRow } from "../skill-engine/feedback-aggregate";
import { copy, type Locale } from "@shared/copy";

export const BLIND_MIN_CHARS = 4;
export const BLIND_MAX_CHARS = 40;
export const BLIND_DEFAULT_GROUPS = 12;

export type BlindSubject = "self" | "friend";
export type BlindPick = "first" | "second" | "unsure";

export interface BlindScoreLine {
  caseId: number;
  expectedText?: string;
  generatedText?: string;
}

export interface BlindStoredGroup {
  caseId: number;
  real: string;
  fake: string;
  realFirst: boolean;
}

export interface BlindAnswer {
  group: number;
  pick: BlindPick;
  seconds: number;
  reason?: FeedbackReason | "";
}

export interface BlindSummary {
  n: number;
  pickedReal: number;
  pickedPersona: number;
  unsure: number;
  medianSeconds: number;
  reasons: Record<string, number>;
}

export function createBlindToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashBlindToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The pairs that are ordinary enough to show a person.
 *
 * A line that is two characters long is a grunt; a line that is a
 * paragraph is a letter. Neither is how somebody talks.
 */
export function eligibleBlindScores(scores: BlindScoreLine[]): BlindScoreLine[] {
  return scores.filter((score) => {
    const real = score.expectedText?.trim() ?? "";
    const fake = score.generatedText?.trim() ?? "";
    if (!real || !fake) return false;
    const chars = Array.from(real).length;
    return chars >= BLIND_MIN_CHARS && chars <= BLIND_MAX_CHARS;
  });
}

/**
 * Pick the groups for a sitting.
 *
 * For the person themselves, the earlier half is preferred: they will
 * remember a line they said last week, and remembering is cheating.
 */
export function pickBlindGroups(
  scores: BlindScoreLine[],
  options: {
    groups: number;
    subject: BlindSubject;
    occurredAt?: Map<number, Date | string | null>;
    seed: string;
  },
): BlindStoredGroup[] {
  const eligible = eligibleBlindScores(scores);
  if (eligible.length < options.groups) return [];
  const dated = [...eligible].sort((a, b) => {
    const left = timeOf(a.caseId, options.occurredAt);
    const right = timeOf(b.caseId, options.occurredAt);
    return left - right;
  });
  let pool = dated;
  if (options.subject === "self") {
    const half = Math.max(1, Math.floor(dated.length / 2));
    const preferred = dated.slice(0, half);
    pool = preferred.length >= options.groups ? preferred : dated;
  } else {
    const rng = seededRandom(`${options.seed}:shuffle`);
    pool = shuffle(dated, rng);
  }
  return pool.slice(0, options.groups).map((score) => ({
    caseId: score.caseId,
    real: score.expectedText!.trim(),
    fake: score.generatedText!.trim(),
    realFirst: true,
  }));
}

/** Flip each pair according to the sitting's id, so the truth is not always on top. */
export function arrangeBlindGroups(groups: BlindStoredGroup[], sessionId: number): BlindStoredGroup[] {
  const rng = seededRandom(`blind:${sessionId}`);
  return groups.map((group) => ({ ...group, realFirst: rng() < 0.5 }));
}

export function publicBlindGroups(groups: BlindStoredGroup[]): Array<{ first: string; second: string }> {
  return groups.map((group) =>
    group.realFirst
      ? { first: group.real, second: group.fake }
      : { first: group.fake, second: group.real },
  );
}

export function summariseBlindSitting(
  groups: BlindStoredGroup[],
  answers: BlindAnswer[],
): BlindSummary {
  const byGroup = new Map(answers.map((answer) => [answer.group, answer]));
  let pickedReal = 0;
  let pickedPersona = 0;
  let unsure = 0;
  const seconds: number[] = [];
  const reasons: Record<string, number> = {};
  for (let i = 0; i < groups.length; i++) {
    const answer = byGroup.get(i);
    if (!answer) continue;
    seconds.push(answer.seconds);
    if (answer.reason) reasons[answer.reason] = (reasons[answer.reason] ?? 0) + 1;
    if (answer.pick === "unsure") {
      unsure += 1;
      continue;
    }
    const pickedRealLine =
      (answer.pick === "first" && groups[i]!.realFirst) ||
      (answer.pick === "second" && !groups[i]!.realFirst);
    if (pickedRealLine) pickedReal += 1;
    else pickedPersona += 1;
  }
  const n = pickedReal + pickedPersona + unsure;
  return {
    n,
    pickedReal: n ? pickedReal / n : 0,
    pickedPersona: n ? pickedPersona / n : 0,
    unsure: n ? unsure / n : 0,
    medianSeconds: median(seconds),
    reasons,
  };
}

export function revealBlindGroups(
  groups: BlindStoredGroup[],
  answers: BlindAnswer[],
): Array<{ first: string; second: string; realIs: "first" | "second"; pick: BlindPick | null }> {
  const byGroup = new Map(answers.map((answer) => [answer.group, answer]));
  return groups.map((group, index) => ({
    first: group.realFirst ? group.real : group.fake,
    second: group.realFirst ? group.fake : group.real,
    realIs: group.realFirst ? ("first" as const) : ("second" as const),
    pick: byGroup.get(index)?.pick ?? null,
  }));
}

/**
 * The markdown a sitting leaves behind: numbers and reasons, no lines.
 */
export function exportBlindRecord(
  session: {
    personaId: number;
    subject: BlindSubject;
    startedAt: Date | string;
    groups: BlindStoredGroup[];
    answers: BlindAnswer[];
    summary: BlindSummary;
  },
  locale: Locale = "zh",
): string {
  const date = new Date(session.startedAt).toISOString().slice(0, 10);
  const lines = [
    "---",
    `date: ${date}`,
    `persona: ${session.personaId}`,
    "subjects: 1",
    `groups: ${session.summary.n}`,
    `hitRate: ${session.summary.pickedPersona}`,
    `pickedReal: ${session.summary.pickedReal}`,
    `unsure: ${session.summary.unsure}`,
    `subject: ${session.subject}`,
    "---",
    "",
    `| ${copy(locale, "eval.blind.export.group")} | ${copy(locale, "eval.blind.export.subject")} | ${copy(locale, "eval.blind.export.verdict")} | ${copy(locale, "eval.blind.export.seconds")} | ${copy(locale, "eval.blind.export.reason")} |`,
    "|---|---|---|---|---|",
  ];
  const byGroup = new Map(session.answers.map((answer) => [answer.group, answer]));
  for (let i = 0; i < session.groups.length; i++) {
    const answer = byGroup.get(i);
    const verdict = verdictOf(session.groups[i]!, answer, locale);
    const seconds = answer ? String(answer.seconds) : "";
    const reason = answer?.reason ?? "";
    lines.push(`| ${i} | ${session.subject} | ${verdict} | ${seconds} | ${reason} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function feedbackRowsFromBlindSessions(
  sessions: Array<{ id: number; groups?: unknown; answers?: unknown; finishedAt?: Date | string | null }>,
): FeedbackRow[] {
  const rows: FeedbackRow[] = [];
  for (const session of sessions) {
    if (!session.finishedAt) continue;
    const groups = asStoredGroups(session.groups);
    const answers = asAnswers(session.answers);
    for (const answer of answers) {
      if (!answer.reason || !isFeedbackReason(answer.reason)) continue;
      const group = groups[answer.group];
      if (!group) continue;
      rows.push({
        id: session.id * 1000 + answer.group,
        messageId: group.caseId,
        reason: answer.reason,
      });
    }
  }
  return rows;
}

export function asStoredGroups(value: unknown): BlindStoredGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.real !== "string" || typeof row.fake !== "string") return [];
    return [
      {
        caseId: typeof row.caseId === "number" ? row.caseId : 0,
        real: row.real,
        fake: row.fake,
        realFirst: row.realFirst === true,
      },
    ];
  });
}

export function asAnswers(value: unknown): BlindAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.group !== "number") return [];
    const pick = row.pick;
    if (pick !== "first" && pick !== "second" && pick !== "unsure") return [];
    const reason =
      typeof row.reason === "string" && isFeedbackReason(row.reason) ? row.reason : "";
    return [
      {
        group: row.group,
        pick,
        seconds: typeof row.seconds === "number" && Number.isFinite(row.seconds) ? row.seconds : 0,
        reason,
      },
    ];
  });
}

function verdictOf(
  group: BlindStoredGroup,
  answer: BlindAnswer | undefined,
  locale: Locale,
): string {
  if (!answer || answer.pick === "unsure") return copy(locale, "eval.blind.verdict.unsure");
  const pickedReal =
    (answer.pick === "first" && group.realFirst) ||
    (answer.pick === "second" && !group.realFirst);
  return pickedReal
    ? copy(locale, "eval.blind.verdict.real")
    : copy(locale, "eval.blind.verdict.persona");
}

function timeOf(caseId: number, occurredAt?: Map<number, Date | string | null>): number {
  const value = occurredAt?.get(caseId);
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
