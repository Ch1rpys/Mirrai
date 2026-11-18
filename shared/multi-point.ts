/**
 * How they used to answer a message that said several things.
 *
 * A reply that tries to cover every clause is the product being
 * thorough. In the record they often picked one — usually the last —
 * and left the rest. That habit is measured here, then offered as a
 * subtraction the user has to confirm.
 */
import { copy, type Locale } from "./copy";
import { isTextRecord } from "./records";
import { toTurns } from "./scenes";
import type { Suppression } from "./suppressions";

export const MULTI_POINT_MIN_SAMPLES = 30;
export const MULTI_POINT_MIN_CHARS = 2;
export const MULTI_POINT_COVERED = 0.15;
export const MULTI_POINT_CANDIDATE_MAX = 0.5;
export const MULTI_POINT_PREFER_LAST = 0.65;
export const MULTI_POINT_PREFER_FIRST = 0.35;
export const MULTI_POINT_EVIDENCE = 3;

/** 。！？!?；; and newlines. Commas stay inside a point. */
const POINT_SPLIT = /[。！？!?；;\n]+/u;

export interface MultiPointLine {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
  id?: number;
}

export interface MultiPointExample {
  user: string;
  reply: string;
  at?: string;
}

export interface MultiPointProfile {
  samples: number;
  coverageMedian: number;
  preferLast: number;
  examples: MultiPointExample[];
}

export interface MultiPointSample {
  points: string[];
  covered: boolean[];
  coverage: number;
  user: string;
  reply: string;
  at?: string;
}

function compactChars(text: string): string[] {
  return Array.from(String(text ?? "").replace(/\s+/g, ""));
}

/** Character bigrams. A point shorter than two characters covers nothing. */
function tokens(text: string): Set<string> {
  const chars = compactChars(text);
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i]! + chars[i + 1]!);
  return out;
}

export function splitPoints(text: string): string[] {
  return String(text ?? "")
    .split(POINT_SPLIT)
    .map((part) => part.trim())
    .filter((part) => compactChars(part).length >= MULTI_POINT_MIN_CHARS);
}

export function pointCoverage(point: string, reply: string): number {
  const source = tokens(point);
  if (source.size === 0) return 0;
  const target = tokens(reply);
  let hit = 0;
  for (const token of source) if (target.has(token)) hit += 1;
  return hit / source.size;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function turnText(rows: MultiPointLine[]): string {
  return rows
    .filter((row) => isTextRecord(row))
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean)
    .join("");
}

function spokenAt(rows: MultiPointLine[]): string | undefined {
  for (const row of rows) {
    if (!row.timestamp) continue;
    const value = row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp);
    if (value) return value;
  }
  return undefined;
}

export function collectMultiPointSamples(turns: MultiPointLine[][]): MultiPointSample[] {
  const samples: MultiPointSample[] = [];
  for (let i = 0; i < turns.length - 1; i++) {
    const userTurn = turns[i]!;
    const replyTurn = turns[i + 1]!;
    if (userTurn[0]?.role !== "user" || replyTurn[0]?.role !== "assistant") continue;
    const user = turnText(userTurn);
    const reply = turnText(replyTurn);
    const points = splitPoints(user);
    if (points.length < 2 || !reply) continue;
    const covered = points.map((point) => pointCoverage(point, reply) >= MULTI_POINT_COVERED);
    const hits = covered.filter(Boolean).length;
    samples.push({
      points,
      covered,
      coverage: hits / points.length,
      user,
      reply,
      at: spokenAt(userTurn),
    });
  }
  return samples;
}

export function measureMultiPoint(turns: MultiPointLine[][]): MultiPointProfile | null {
  const samples = collectMultiPointSamples(turns);
  if (samples.length < MULTI_POINT_MIN_SAMPLES) return null;
  const rates = samples.map((row) => row.coverage).sort((a, b) => a - b);
  const single = samples.filter((row) => row.covered.filter(Boolean).length === 1);
  const lastHits = single.filter((row) => row.covered[row.covered.length - 1]).length;
  const lastOnly = samples.filter(
    (row) => row.covered.filter(Boolean).length === 1 && row.covered[row.covered.length - 1],
  );
  const examples = (lastOnly.length > 0 ? lastOnly : samples)
    .slice(0, MULTI_POINT_EVIDENCE)
    .map((row) => ({
      user: row.user,
      reply: row.reply,
      ...(row.at ? { at: row.at } : {}),
    }));
  return {
    samples: samples.length,
    coverageMedian: quantile(rates, 0.5),
    preferLast: single.length > 0 ? lastHits / single.length : 0,
    examples,
  };
}

export function measureMultiPointFromRows(rows: MultiPointLine[]): MultiPointProfile | null {
  return measureMultiPoint(toTurns(rows));
}

export function normalizeMultiPoint(value: unknown): MultiPointProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const samples = Math.round(Number(source.samples) || 0);
  const coverageMedian = Number(source.coverageMedian);
  const preferLast = Number(source.preferLast);
  if (samples < 1 || !Number.isFinite(coverageMedian) || !Number.isFinite(preferLast)) {
    return undefined;
  }
  const examples: MultiPointExample[] = [];
  if (Array.isArray(source.examples)) {
    for (const item of source.examples) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const user = String(row.user ?? "").trim();
      const reply = String(row.reply ?? "").trim();
      if (!user || !reply) continue;
      const at = String(row.at ?? "").trim();
      examples.push(at ? { user, reply, at } : { user, reply });
      if (examples.length >= MULTI_POINT_EVIDENCE) break;
    }
  }
  return { samples, coverageMedian, preferLast, examples };
}

function idFor(pattern: string): string {
  const slug = `multi_point:${pattern}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 48);
  return `suppression-${slug || "multi_point"}`;
}

export function mineMultiPoint(params: {
  messages: MultiPointLine[];
  locale?: Locale;
}): Suppression[] {
  const locale = params.locale ?? "zh";
  const profile = measureMultiPointFromRows(params.messages);
  if (!profile || profile.coverageMedian > MULTI_POINT_CANDIDATE_MAX) return [];
  const pattern =
    profile.preferLast >= MULTI_POINT_PREFER_LAST
      ? copy(locale, "labels.multiPoint.preferLast")
      : profile.preferLast <= MULTI_POINT_PREFER_FIRST
        ? copy(locale, "labels.multiPoint.preferFirst")
        : "";
  return [
    {
      id: idFor(pattern || "any"),
      pattern,
      kind: "multi_point",
      confidence: 0.7,
      source: "auto",
      verified: false,
      evidence: profile.examples.map((row) => ({
        snippet: copy(locale, "labels.multiPoint.pair", { user: row.user, reply: row.reply }),
        ...(row.at ? { at: row.at } : {}),
      })),
    },
  ];
}
