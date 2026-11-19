/**
 * When they send one more line because the other person has gone quiet.
 *
 * The line has to be one they actually sent, after a round of theirs
 * and before anyone replied. A wait shorter than three minutes is the
 * same burst. A wait longer than an hour is a new conversation.
 */
import { filterHarm } from "./harm";
import { isTextRecord } from "./records";
import { isSafeSeedLine } from "./seed-safety";

export const DOUBLE_TEXT_MIN_SAMPLES = 8;
export const DOUBLE_TEXT_WAIT_MIN_MS = 3 * 60_000;
export const DOUBLE_TEXT_WAIT_MAX_MS = 60 * 60_000;
export const DOUBLE_TEXT_OPPORTUNITY_MS = 10 * 60_000;
export const DOUBLE_TEXT_MAX_CHARS = 8;
export const DOUBLE_TEXT_MAX_LINES = 6;

export interface DoubleTextLine {
  text: string;
  n: number;
}

export interface DoubleTextProfile {
  samples: number;
  opportunities: number;
  rate: number;
  waitSec: { p25: number; median: number; p75: number };
  lines: DoubleTextLine[];
}

export interface DoubleTextRow {
  role: string;
  content?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
}

function at(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function contentOf(row: DoubleTextRow): string {
  return typeof row.content === "string" ? row.content.trim() : "";
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function spoken(rows: DoubleTextRow[]): Array<DoubleTextRow & { at: number; text: string }> {
  const out: Array<DoubleTextRow & { at: number; text: string }> = [];
  for (const row of rows) {
    if (!isTextRecord(row)) continue;
    if (row.role !== "user" && row.role !== "assistant") continue;
    const time = at(row.timestamp);
    const text = contentOf(row);
    if (time == null || !text) continue;
    out.push({ ...row, at: time, text });
  }
  return out;
}

/**
 * A goodbye said as the last thing, not as a question about plans.
 *
 * USER_ACTS has no farewell label: adding one would recategorise lines
 * that adjacency and taps already count as other. The follow-up path
 * only needs to recognise the leave-taking itself.
 */
export function isFarewellUserLine(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  return /^(再见|拜拜+|拜|晚安|安|先睡了|我走了|走了|撤了|bye+|good\s*night|good\s*bye|see you)[。.!！?？…~～]*$/i.test(trimmed);
}

export function measureDoubleText(
  rows: DoubleTextRow[],
  personaData?: { harmReport?: unknown } | null,
): DoubleTextProfile | null {
  const timed = spoken(rows);
  const waits: number[] = [];
  const counts = new Map<string, number>();
  let samples = 0;
  let opportunities = 0;
  let i = 0;
  while (i < timed.length) {
    if (timed[i]!.role !== "assistant") {
      i += 1;
      continue;
    }
    let end = i;
    while (
      end + 1 < timed.length
      && timed[end + 1]!.role === "assistant"
      && timed[end + 1]!.at - timed[end]!.at < DOUBLE_TEXT_WAIT_MIN_MS
    ) {
      end += 1;
    }
    const roundEnd = timed[end]!.at;
    const next = timed[end + 1];
    if (!next) {
      i = end + 1;
      continue;
    }
    const gapMs = next.at - roundEnd;
    if (next.role === "assistant") {
      const chars = Array.from(next.text).length;
      const afterTypoFix = /^\*/.test(timed[end]!.text);
      if (
        !afterTypoFix
        && gapMs >= DOUBLE_TEXT_WAIT_MIN_MS
        && gapMs <= DOUBLE_TEXT_WAIT_MAX_MS
        && chars > 0
        && chars <= DOUBLE_TEXT_MAX_CHARS
      ) {
        samples += 1;
        opportunities += 1;
        waits.push(gapMs / 1000);
        counts.set(next.text, (counts.get(next.text) ?? 0) + 1);
      } else if (gapMs >= DOUBLE_TEXT_OPPORTUNITY_MS) {
        opportunities += 1;
      }
      i = end + 1;
      continue;
    }
    if (gapMs >= DOUBLE_TEXT_OPPORTUNITY_MS) opportunities += 1;
    i = end + 1;
  }
  if (samples < DOUBLE_TEXT_MIN_SAMPLES) return null;
  waits.sort((a, b) => a - b);
  const lines = [...counts.entries()]
    .map(([text, n]) => ({ text, n }))
    .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, "zh"));
  const safe = filterHarm(
    lines.map((row) => ({ ...row, role: "assistant", content: row.text })),
    personaData as { harmReport?: never } | null,
  )
    .map((row) => ({ text: row.text, n: row.n }))
    .filter((row) => isSafeSeedLine(row.text))
    .slice(0, DOUBLE_TEXT_MAX_LINES);
  return {
    samples,
    opportunities,
    rate: opportunities > 0 ? Math.min(1, samples / opportunities) : 0,
    waitSec: {
      p25: quantile(waits, 0.25),
      median: quantile(waits, 0.5),
      p75: quantile(waits, 0.75),
    },
    lines: safe,
  };
}

export function sampleFollowUpWaitMs(profile: DoubleTextProfile, rng: () => number): number {
  const u = Math.min(1, Math.max(0, rng()));
  const sec = u < 0.5
    ? profile.waitSec.p25 + (profile.waitSec.median - profile.waitSec.p25) * (u * 2)
    : profile.waitSec.median + (profile.waitSec.p75 - profile.waitSec.median) * ((u - 0.5) * 2);
  return Math.max(DOUBLE_TEXT_WAIT_MIN_MS, Math.min(DOUBLE_TEXT_WAIT_MAX_MS, Math.round(sec * 1000)));
}

export function pickFollowUpLine(profile: DoubleTextProfile, rng: () => number): string | null {
  const total = profile.lines.reduce((sum, row) => sum + row.n, 0);
  if (total <= 0) return null;
  let tick = rng() * total;
  for (const row of profile.lines) {
    tick -= row.n;
    if (tick < 0) return row.text;
  }
  return profile.lines.at(-1)?.text ?? null;
}

export function normalizeDoubleText(value: unknown): DoubleTextProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const samples = typeof record.samples === "number" && Number.isFinite(record.samples)
    ? Math.max(0, Math.round(record.samples))
    : 0;
  const opportunities = typeof record.opportunities === "number" && Number.isFinite(record.opportunities)
    ? Math.max(0, Math.round(record.opportunities))
    : 0;
  const rate = typeof record.rate === "number" && Number.isFinite(record.rate)
    ? Math.min(1, Math.max(0, record.rate))
    : 0;
  const waitRaw = record.waitSec && typeof record.waitSec === "object" && !Array.isArray(record.waitSec)
    ? record.waitSec as Record<string, unknown>
    : {};
  const num = (key: string, fallback: number) => {
    const n = waitRaw[key];
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
  };
  const lines: DoubleTextLine[] = [];
  if (Array.isArray(record.lines)) {
    for (const raw of record.lines) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const text = typeof (raw as { text?: unknown }).text === "string"
        ? (raw as { text: string }).text.trim()
        : "";
      const n = typeof (raw as { n?: unknown }).n === "number" ? (raw as { n: number }).n : 0;
      if (text && n > 0 && isSafeSeedLine(text)) lines.push({ text, n: Math.round(n) });
    }
  }
  if (samples < DOUBLE_TEXT_MIN_SAMPLES || lines.length === 0) return null;
  return {
    samples,
    opportunities,
    rate,
    waitSec: {
      p25: num("p25", 0),
      median: num("median", 0),
      p75: num("p75", 0),
    },
    lines: lines.slice(0, DOUBLE_TEXT_MAX_LINES),
  };
}
