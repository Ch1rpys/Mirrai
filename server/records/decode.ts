/**
 * "Read this line" (C3.4).
 *
 * It puts a line beside what the record holds: the rules the user
 * confirmed that match it, the times the person really said it, and what
 * usually happened after those times. It does not interpret, it does not
 * score, and it never calls a model — the page is a way into the record,
 * not a second opinion.
 */
import * as db from "../db";
import { normalizeMicroRules, matchesMicroRule, type MicroRule } from "@shared/micro-rules";
import { bigramJaccard, normalizeForNearest } from "./nearest";

/** The minimal record shape the decoder needs. */
export interface DecodeRow {
  id: number;
  role: string;
  speaker?: string | null;
  content: string;
  kind?: string | null;
  meta?: Record<string, unknown> | null;
  timestamp?: Date | null;
  createdAt?: Date | null;
  emotion?: string | null;
}

export interface DecodeContextRow {
  id: number;
  role: string;
  speaker: string | null;
  content: string;
  kind: string | null;
  meta: Record<string, unknown> | null;
  at: string | null;
  emotion: string | null;
}

export interface DecodePrecedent {
  id: number;
  content: string;
  at: string | null;
  /** How closely the line matches: 1 for the same words. */
  similarity: number;
  before: DecodeContextRow[];
  after: DecodeContextRow[];
}

export interface DecodeResult {
  rules: Array<{
    id: string;
    trigger: string[];
    meaning: string;
    rendering: string;
    evidence: MicroRule["evidence"];
  }>;
  precedents: DecodePrecedent[];
  after: {
    /** How many precedents the reading counted. */
    count: number;
    /** Median seconds until the person spoke again, or null. */
    gapMedianSec: number | null;
    /** How many of those conversations carried each emotional label. */
    states: Array<{ state: string; n: number }>;
  };
  /** The line, rendered for reading. */
  text: string;
}

function at(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toContext(row: DecodeRow): DecodeContextRow {
  return {
    id: row.id,
    role: row.role,
    speaker: row.speaker ?? null,
    content: row.content,
    kind: row.kind ?? null,
    meta: (row.meta ?? null) as Record<string, unknown> | null,
    at: at(row.timestamp ?? row.createdAt),
    emotion: row.emotion ?? null,
  };
}

/** Median of a list of seconds, or null when there is nothing to count. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Reads one line against the record.
 *
 * Only reads: no rows are written, and no model is asked. A confirmed
 * rule is the user's own, so its wording is shown as they wrote it. An
 * unconfirmed rule is a candidate, and the page exists to show what the
 * user decided to trust — so it stays out.
 */
export async function decodeLine(params: {
  personaId: number;
  userId: number;
  text: string;
  /** How many precedents to show. */
  limit?: number;
}): Promise<DecodeResult> {
  const text = params.text.trim();
  const limit = Math.max(1, Math.min(10, params.limit ?? 5));
  const persona = await db.getPersonaById(params.personaId, params.userId);
  const personaData = (persona?.personaData ?? {}) as Record<string, unknown>;

  const rules = normalizeMicroRules(personaData.microRules)
    .filter((rule) => rule.verified && matchesMicroRule(rule, text))
    .map((rule) => ({
      id: rule.id,
      trigger: rule.trigger,
      meaning: rule.meaning,
      rendering: rule.rendering,
      evidence: rule.evidence,
    }));

  const wanted = normalizeForNearest(text);
  const candidates = await db.candidateRecordsByOverlap(params.personaId, params.userId, {
    text,
    role: "assistant",
    limit: 200,
  });

  const matches = candidates
    .map((row) => {
      const normalized = normalizeForNearest(row.content);
      const exact = normalized === wanted;
      const similarity = exact ? 1 : bigramJaccard(wanted, normalized);
      return { row, exact, similarity };
    })
    .filter((entry) => entry.exact || entry.similarity >= 0.5)
    .sort((a, b) => {
      const time = (b.row.timestamp?.getTime() ?? 0) - (a.row.timestamp?.getTime() ?? 0);
      return time !== 0 ? time : b.row.id - a.row.id;
    })
    .slice(0, limit);

  const precedents: DecodePrecedent[] = [];
  const gaps: number[] = [];
  const states = new Map<string, number>();

  for (const match of matches) {
    const around = await db.getRecordsAround(match.row.id, params.userId, 3, 5);
    if (!around.target || around.target.personaId !== params.personaId) continue;

    const target = toContext(around.target as DecodeRow);
    // `before` comes newest-first from the database; the page reads it
    // oldest-first.
    const before = [...around.before].reverse().map((row) => toContext(row as DecodeRow));
    const after = around.after.map((row) => toContext(row as DecodeRow));
    precedents.push({
      id: match.row.id,
      content: match.row.content,
      at: at(match.row.timestamp),
      similarity: match.similarity,
      before,
      after,
    });

    // When they spoke next, after this line.
    const next = after.find((row) => row.role === "assistant");
    if (next?.at) {
      const from = new Date(target.at ?? match.row.timestamp ?? 0).getTime();
      const to = new Date(next.at).getTime();
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        gaps.push((to - from) / 1000);
      }
    }

    // The label of the conversation this line belongs to. The target
    // row carries the state B1.5 assigned to the scene; counting every
    // later row would count long conversations many times and make
    // "three of the five times" depend on how talkative the scene was.
    if (target.emotion) {
      states.set(target.emotion, (states.get(target.emotion) ?? 0) + 1);
    }
  }

  return {
    rules,
    precedents,
    after: {
      count: precedents.length,
      gapMedianSec: median(gaps),
      states: Array.from(states.entries())
        .map(([state, n]) => ({ state, n }))
        .sort((a, b) => b.n - a.n || a.state.localeCompare(b.state)),
    },
    text,
  };
}
