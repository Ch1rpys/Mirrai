/**
 * The small habits that are not the words themselves: a typo they
 * catch, a line they take back, a tap on the shoulder.
 *
 * None of this is invented. A pair is only kept when the corrected
 * word really sat in the line before it. A recall rate with fewer
 * than five takes-back is zero. A tap that happened four times is
 * not a habit yet.
 */
import { isTextRecord } from "./records";
import { splitScenes, toTurns } from "./scenes";
import { isUserAct, labelUserActByRule, USER_ACTS, type UserAct } from "./speech-acts";

export const QUIRK_RECALL_MIN = 5;
export const QUIRK_PAT_MIN = 5;
export const QUIRK_PAT_ACT_MIN = 3;
export const QUIRK_FIX_WINDOW_MS = 60_000;
export const QUIRK_FIX_MAX_RIGHT_CHARS = 12;

export interface TypoFix {
  wrong: string;
  right: string;
  n: number;
}

export interface PatAfter {
  pats: number;
  turns: number;
}

export interface QuirksProfile {
  typoFixes: TypoFix[];
  typoRate: number;
  recallRate: number;
  patAfter: Partial<Record<UserAct, PatAfter>>;
}

export interface QuirkRow {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
  act?: string | null;
  speaker?: string | null;
}

function at(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function contentOf(row: QuirkRow): string {
  return typeof row.content === "string" ? row.content : "";
}

function chars(text: string): string[] {
  return Array.from(text);
}

function levenshtein(a: string, b: string): number {
  const left = chars(a);
  const right = chars(b);
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const next = new Array<number>(right.length + 1);
  for (let i = 0; i < left.length; i++) {
    next[0] = i + 1;
    for (let j = 0; j < right.length; j++) {
      const cost = left[i] === right[j] ? 0 : 1;
      next[j + 1] = Math.min(prev[j + 1]! + 1, next[j]! + 1, prev[j]! + cost);
    }
    for (let j = 0; j <= right.length; j++) prev[j] = next[j]!;
  }
  return prev[right.length]!;
}

/**
 * The stretch of `previous` that is the same length as `right` and
 * at most two edits away. Identical stretches are not a typo.
 */
export function findWrong(previous: string, right: string): string | null {
  const needle = chars(right);
  const hay = chars(previous);
  if (needle.length === 0 || hay.length < needle.length) return null;
  let best: { slice: string; distance: number; at: number } | null = null;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    const slice = hay.slice(i, i + needle.length).join("");
    const distance = levenshtein(slice, right);
    if (distance < 1 || distance > 2) continue;
    if (!best || distance < best.distance || (distance === best.distance && i < best.at)) {
      best = { slice, distance, at: i };
    }
  }
  return best?.slice ?? null;
}

function starRight(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("*")) return null;
  const right = trimmed.slice(1).trim();
  if (!right || chars(right).length > QUIRK_FIX_MAX_RIGHT_CHARS) return null;
  return right;
}

function userActOf(row: QuirkRow): UserAct {
  if (isUserAct(row.act)) return row.act;
  return labelUserActByRule(contentOf(row)) ?? "other";
}

function isPat(row: QuirkRow): boolean {
  return row.kind === "pat" || contentOf(row).trim() === "[pat]";
}

function isRecall(row: QuirkRow): boolean {
  return row.kind === "recall" || contentOf(row).trim() === "[recall]";
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    n += 1;
    from = at + needle.length;
  }
  return n;
}

export function measureQuirks(rows: QuirkRow[]): QuirksProfile {
  const pairCounts = new Map<string, TypoFix>();
  for (let i = 1; i < rows.length; i++) {
    const current = rows[i]!;
    if (current.role !== "assistant" || !isTextRecord(current)) continue;
    const right = starRight(contentOf(current));
    if (!right) continue;
    const when = at(current.timestamp);
    let previous: QuirkRow | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const row = rows[j]!;
      if (row.role !== "assistant") continue;
      if (!isTextRecord(row)) continue;
      previous = row;
      break;
    }
    if (!previous) continue;
    const prevAt = at(previous.timestamp);
    if (when && prevAt && when.getTime() - prevAt.getTime() > QUIRK_FIX_WINDOW_MS) continue;
    if (when && prevAt && when.getTime() < prevAt.getTime()) continue;
    const wrong = findWrong(contentOf(previous), right);
    if (!wrong) continue;
    const key = `${wrong}\0${right}`;
    const existing = pairCounts.get(key);
    if (existing) existing.n += 1;
    else pairCounts.set(key, { wrong, right, n: 1 });
  }
  const typoFixes = [...pairCounts.values()].sort((a, b) => b.n - a.n || a.right.localeCompare(b.right));
  const typoEvents = typoFixes.reduce((sum, row) => sum + row.n, 0);
  const rights = new Set(typoFixes.map((row) => row.right));
  let rightMentions = 0;
  for (const right of rights) {
    for (const row of rows) {
      if (row.role !== "assistant" || !isTextRecord(row)) continue;
      rightMentions += countOccurrences(contentOf(row), right);
    }
  }
  const typoRate = rightMentions > 0 ? typoEvents / rightMentions : 0;

  let recallRows = 0;
  for (const row of rows) {
    if (row.role === "assistant" && isRecall(row)) recallRows += 1;
  }
  let taTurns = 0;
  for (const scene of splitScenes(rows)) {
    for (const turn of toTurns(scene)) {
      if (turn[0]?.role === "assistant") taTurns += 1;
    }
  }
  const recallRate = recallRows >= QUIRK_RECALL_MIN && taTurns > 0 ? recallRows / taTurns : 0;

  const patAfter: Partial<Record<UserAct, PatAfter>> = {};
  for (const act of USER_ACTS) patAfter[act] = { pats: 0, turns: 0 };
  let totalPats = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.role !== "user" || !isTextRecord(row)) continue;
    const act = userActOf(row);
    const bucket = patAfter[act]!;
    bucket.turns += 1;
    const next = rows[i + 1];
    if (next && next.role === "assistant" && isPat(next)) {
      bucket.pats += 1;
      totalPats += 1;
    }
  }
  const kept: Partial<Record<UserAct, PatAfter>> = {};
  if (totalPats >= QUIRK_PAT_MIN) {
    for (const act of USER_ACTS) {
      const row = patAfter[act]!;
      if (row.turns > 0) kept[act] = row;
    }
  }

  return {
    typoFixes,
    typoRate,
    recallRate,
    patAfter: kept,
  };
}

export function applyTypoFix(
  text: string,
  profile: QuirksProfile,
  rng: () => number,
): { text: string; star: string } | null {
  const pair = profile.typoFixes.find((item) => item.right && text.includes(item.right));
  if (!pair) return null;
  if (rng() >= profile.typoRate) return null;
  return {
    text: text.replace(pair.right, pair.wrong),
    star: `*${pair.right}`,
  };
}

export function shouldRecall(profile: QuirksProfile, rng: () => number): boolean {
  return profile.recallRate > 0 && rng() < profile.recallRate;
}

export function recallShowMs(rng: () => number): number {
  return Math.round(2_000 + rng() * 4_000);
}

export function rejectedCandidate(
  rerank: { text: string; scores: Array<{ text: string }> } | null | undefined,
  winner: string,
): string | null {
  if (!rerank) return null;
  const other = rerank.scores.find((row) => row.text && row.text !== winner);
  return other?.text ?? null;
}

export function shouldPat(userAct: UserAct, profile: QuirksProfile, rng: () => number): boolean {
  const row = profile.patAfter[userAct];
  if (!row || row.pats < QUIRK_PAT_ACT_MIN || row.turns <= 0) return false;
  return rng() < row.pats / row.turns;
}

export function normalizeQuirks(value: unknown): QuirksProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const typoFixes: TypoFix[] = [];
  if (Array.isArray(record.typoFixes)) {
    for (const raw of record.typoFixes) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const wrong = typeof (raw as { wrong?: unknown }).wrong === "string" ? (raw as { wrong: string }).wrong : "";
      const right = typeof (raw as { right?: unknown }).right === "string" ? (raw as { right: string }).right : "";
      const n = typeof (raw as { n?: unknown }).n === "number" ? (raw as { n: number }).n : 0;
      if (wrong && right && n > 0) typoFixes.push({ wrong, right, n });
    }
  }
  const typoRate = typeof record.typoRate === "number" && Number.isFinite(record.typoRate)
    ? Math.min(1, Math.max(0, record.typoRate))
    : 0;
  const recallRate = typeof record.recallRate === "number" && Number.isFinite(record.recallRate)
    ? Math.min(1, Math.max(0, record.recallRate))
    : 0;
  const patAfter: Partial<Record<UserAct, PatAfter>> = {};
  if (record.patAfter && typeof record.patAfter === "object" && !Array.isArray(record.patAfter)) {
    for (const act of USER_ACTS) {
      const row = (record.patAfter as Record<string, unknown>)[act];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const pats = typeof (row as { pats?: unknown }).pats === "number" ? (row as { pats: number }).pats : 0;
      const turns = typeof (row as { turns?: unknown }).turns === "number" ? (row as { turns: number }).turns : 0;
      if (turns > 0) patAfter[act] = { pats: Math.max(0, pats), turns };
    }
  }
  return { typoFixes, typoRate, recallRate, patAfter };
}
