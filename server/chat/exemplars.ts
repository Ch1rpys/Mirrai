/**
 * Past replies of theirs, retrieved by how the other person had just
 * spoken — not by a fact in a memory.
 *
 * The unit is a turn, not a line: one of their bursts, scored against
 * the user burst that came before it. The first term is character
 * bigrams (the same tokens memory retrieval already uses). An embedding
 * of that previous user burst is an optional second look at the same
 * term; without one, the score is the literal coverage.
 */
import { copy, type Locale } from "@shared/copy";
import { isTextRecord } from "@shared/records";
import { filterHarm, type HarmReport } from "@shared/harm";
import { splitScenes, toTurns } from "@shared/scenes";
import { dayPartFromHour, type ActDayPart } from "@shared/act-profile";
import { zonedHour } from "@shared/timezone";
import { keywordCoverage, tokenize } from "./retrieval";

export const EXEMPLAR_MIN_SCORE = 0.08;
export const EXEMPLAR_MAX = 4;

export interface CollectedReply {
  id: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  speaker?: string | null;
  act?: string | null;
  emotion?: string | null;
}

export interface Exemplar {
  id: number;
  content: string;
  /** Their bubbles in this turn, each already cut to the median ceiling. */
  turn: string[];
  score: number;
  previousUser: string;
  at: Date | string | null;
}

export interface ExemplarPeriod {
  from: string;
  to: string;
}

/**
 * Cosine of the current user message against a previous user burst.
 *
 * Below 0.5 it contributes nothing. The first scoring term then takes
 * the max of the literal coverage and `(cosine − 0.5) × 2`.
 */
export type ExemplarEmbedFn = (
  previousUser: string,
  recordId: number,
) => number | null | undefined;

export function bigramScore(queryTokens: Set<string>, previousUser: string): number {
  return keywordCoverage(previousUser, queryTokens);
}

/**
 * The first scoring term: literal coverage, optionally lifted by a
 * cosine that cleared 0.5.
 */
export function firstTermScore(coverage: number, cosine?: number | null): number {
  if (cosine == null || cosine < 0.5) return coverage;
  return Math.max(coverage, (cosine - 0.5) * 2);
}

export function scoreExemplar(parts: {
  firstTerm: number;
  contextCoverage: number;
  actMatch: number;
  emotionMatch: number;
  dayMatch: number;
  periodMatch: number;
}): number {
  return (
    0.6 * parts.firstTerm +
    0.15 * parts.contextCoverage +
    0.1 * parts.actMatch +
    0.05 * parts.emotionMatch +
    0.05 * parts.dayMatch +
    0.05 * parts.periodMatch
  );
}

function medianLength(texts: string[]): number {
  const lengths = texts.map((text) => text.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  if (!lengths.length) return 80;
  return lengths[Math.floor(lengths.length / 2)];
}

export function truncateExemplar(text: string, medianChars: number): string {
  const ceiling = Math.max(1, Math.round(medianChars * 1.5));
  const trimmed = text.trim();
  if (trimmed.length <= ceiling) return trimmed;
  return trimmed.slice(0, ceiling);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const time = value instanceof Date ? value : new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

function textOf(rows: CollectedReply[]): string {
  return rows
    .filter((row) => isTextRecord(row))
    .map((row) => row.content.trim())
    .filter(Boolean)
    .join(" ");
}

function textLines(rows: CollectedReply[]): string[] {
  return rows
    .filter((row) => isTextRecord(row))
    .map((row) => row.content.trim())
    .filter(Boolean);
}

function inPeriod(at: Date | null, period: ExemplarPeriod | null | undefined): boolean {
  if (!period || !at) return false;
  const from = new Date(period.from).getTime();
  const to = new Date(period.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  const time = at.getTime();
  return time >= from && time <= to;
}

function dayPartOf(
  at: Date | null,
  timeZone: string | null | undefined,
): ActDayPart | null {
  if (!at) return null;
  return dayPartFromHour(zonedHour(at, timeZone));
}

function recentContextText(
  history: Array<{ role: string; content: string; speaker?: string | null }> | undefined,
  userMessage: string,
): string {
  if (!history?.length) return "";
  const rows = history.map((row, index) => ({
    id: index + 1,
    role: row.role,
    content: row.content,
    speaker: row.speaker,
    kind: "text" as const,
  }));
  let turns = toTurns(rows);
  if (turns.length > 0) {
    const last = turns[turns.length - 1];
    const lastText = textOf(last);
    if (last[0]?.role === "user" && lastText === userMessage.trim()) {
      turns = turns.slice(0, -1);
    }
  }
  return textOf(turns.slice(-2).flat());
}

function lastUserTurnIndex(turns: CollectedReply[][], before: number): number {
  for (let i = before - 1; i >= 0; i--) {
    if (turns[i][0]?.role === "user" && textOf(turns[i])) return i;
  }
  return -1;
}

/**
 * The user burst that sat in front of each of their turns.
 *
 * The first text id of that burst is the key `record_embeddings` stores.
 */
export function userBurstsForEmbedding(
  records: CollectedReply[],
): Array<{ recordId: number; text: string }> {
  const out: Array<{ recordId: number; text: string }> = [];
  const seen = new Set<number>();
  for (const scene of splitScenes(records)) {
    const turns = toTurns(scene);
    for (let i = 0; i < turns.length; i++) {
      if (turns[i][0]?.role !== "assistant") continue;
      if (!turns[i].some((row) => isTextRecord(row) && row.content.trim())) continue;
      const userIndex = lastUserTurnIndex(turns, i);
      if (userIndex < 0) continue;
      const first = turns[userIndex].find((row) => isTextRecord(row) && row.content.trim());
      if (!first || seen.has(first.id)) continue;
      const text = textOf(turns[userIndex]);
      if (!text) continue;
      seen.add(first.id);
      out.push({ recordId: first.id, text });
    }
  }
  return out;
}

/**
 * Their replies whose preceding user turn is closest to this one.
 *
 * A held-out id is excluded so evaluation cannot retrieve the answer.
 * Below the floor, nothing is returned — four unrelated lines would
 * be worse than none.
 */
export function retrieveExemplars(params: {
  userMessage: string;
  records: CollectedReply[];
  excludeIds?: Iterable<number>;
  excludeTexts?: Iterable<string>;
  minScore?: number;
  limit?: number;
  personaData?: { harmReport?: HarmReport | null } | null;
  sampledAct?: string | null;
  emotion?: string | null;
  now?: Date | null;
  timeZone?: string | null;
  period?: ExemplarPeriod | null;
  history?: Array<{ role: string; content: string; speaker?: string | null }>;
  embedCosine?: ExemplarEmbedFn;
}): Exemplar[] {
  const query = params.userMessage.trim();
  if (!query) return [];
  const queryTokens = tokenize(query);
  if (!queryTokens.size) return [];
  const minScore = params.minScore ?? EXEMPLAR_MIN_SCORE;
  const limit = params.limit ?? EXEMPLAR_MAX;
  const excludedIds = new Set(params.excludeIds ?? []);
  const excludedTexts = new Set(
    [...(params.excludeTexts ?? [])].map((text) => text.trim()).filter(Boolean),
  );
  const kept = new Set(filterHarm(params.records, params.personaData).map((row) => row.id));
  const currentContext = recentContextText(params.history, query);
  const currentContextTokens = currentContext ? tokenize(currentContext) : new Set<string>();
  const currentDay = params.now ? dayPartOf(params.now, params.timeZone) : null;
  const period = params.period ?? null;
  const hasAct = Boolean(params.sampledAct);
  const hasEmotion = Boolean(params.emotion);
  const hasDay = currentDay != null;
  const hasPeriod = period != null;

  const median = medianLength(
    params.records
      .filter((row) => row.role === "assistant" && isTextRecord(row) && kept.has(row.id))
      .map((row) => row.content),
  );

  const scored: Exemplar[] = [];
  for (const scene of splitScenes(params.records)) {
    const turns = toTurns(scene);
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn[0]?.role !== "assistant") continue;
      const lines = turn.filter(
        (row) => isTextRecord(row) && kept.has(row.id) && row.content.trim(),
      );
      if (!lines.length) continue;
      if (lines.some((row) => excludedIds.has(row.id))) continue;
      const raw = textLines(lines);
      if (raw.some((text) => excludedTexts.has(text))) continue;

      const userIndex = lastUserTurnIndex(turns, i);
      if (userIndex < 0) continue;
      const previousUser = textOf(turns[userIndex]);
      if (!previousUser) continue;
      const previousUserId = turns[userIndex].find((row) => isTextRecord(row) && row.content.trim())?.id ?? 0;

      const coverage = bigramScore(queryTokens, previousUser);
      const cosine = params.embedCosine?.(previousUser, previousUserId) ?? null;
      const firstTerm = firstTermScore(coverage, cosine);
      if (firstTerm < minScore) continue;

      const priorContext = textOf(turns.slice(Math.max(0, userIndex - 2), userIndex).flat());
      const contextCoverage =
        currentContextTokens.size > 0 && priorContext
          ? keywordCoverage(priorContext, currentContextTokens)
          : 0;

      const head = lines[0];
      const at = head.timestamp ?? null;
      const atDate = asDate(at);
      const actMatch = hasAct && head.act && head.act === params.sampledAct ? 1 : 0;
      const emotionMatch = hasEmotion && head.emotion && head.emotion === params.emotion ? 1 : 0;
      const dayMatch =
        hasDay && currentDay && dayPartOf(atDate, params.timeZone) === currentDay ? 1 : 0;
      const periodMatch = hasPeriod ? (inPeriod(atDate, period) ? 1 : 0) : 1;

      const truncated = raw.map((text) => truncateExemplar(text, median));
      scored.push({
        id: head.id,
        content: truncated.join(" "),
        turn: truncated,
        score: scoreExemplar({
          firstTerm,
          contextCoverage,
          actMatch,
          emotionMatch,
          dayMatch,
          periodMatch,
        }),
        previousUser,
        at,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  const unique: Exemplar[] = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (seen.has(item.content)) continue;
    seen.add(item.content);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

export function renderExemplars(exemplars: Exemplar[], locale: Locale = "zh"): string {
  if (!exemplars.length) return "";
  const lines = exemplars.flatMap((item) => {
    const bubbles = item.turn.length > 0 ? item.turn : [item.content];
    return bubbles.map((text) => `- ${text}`);
  });
  return [copy(locale, "prompt.exemplarsHeading"), copy(locale, "prompt.exemplarsIntro"), ...lines].join(
    "\n",
  );
}
