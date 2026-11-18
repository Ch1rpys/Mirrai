/**
 * A handful of their own lines, kept by mood, so a long chat can be
 * shown how they actually talk.
 *
 * The generator hangs six of these on the prompt and rotates the six
 * every six turns. Measurement only: what is stored is the pool, not
 * the six.
 */
import { filterHarm } from "./harm";
import { isTextRecord } from "./records";
import {
  FINGERPRINT_STATES,
  type EmotionalState,
  type FingerprintRow,
} from "./style-fingerprint";

export const SAMPLE_POOL_PER_STATE = 40;
export const SAMPLE_POOL_KEYS = [...FINGERPRINT_STATES, "any"] as const;
export type SamplePoolKey = (typeof SAMPLE_POOL_KEYS)[number];
export type SamplePool = Partial<Record<SamplePoolKey, string[]>>;

function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** `n` items spaced across the list, in the order they already have. */
function pickEven<T>(items: T[], n: number): T[] {
  if (n <= 0 || items.length === 0) return [];
  if (items.length <= n) return items.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * items.length) / n);
    const end = Math.floor(((i + 1) * items.length) / n);
    const mid = Math.min(items.length - 1, Math.floor((start + end) / 2));
    out.push(items[mid]!);
  }
  return out;
}

function assistantTexts(rows: FingerprintRow[]): FingerprintRow[] {
  return rows.filter(
    (row) => row.role === "assistant" && isTextRecord(row) && row.content.trim().length > 0,
  );
}

function sampleLines(rows: FingerprintRow[], n: number): string[] {
  if (rows.length === 0) return [];
  const lengths = rows.map((row) => row.content.trim().length).sort((a, b) => a - b);
  const q1 = quantile(lengths, 0.25);
  const q3 = quantile(lengths, 0.75);
  const inIqr = rows.filter((row) => {
    const length = row.content.trim().length;
    return length >= q1 && length <= q3;
  });
  const pool = inIqr.length > 0 ? inIqr : rows;
  const timed = pool
    .slice()
    .sort((a, b) => (asDate(a.timestamp)?.getTime() ?? 0) - (asDate(b.timestamp)?.getTime() ?? 0));
  return pickEven(timed, n).map((row) => row.content.trim());
}

/**
 * Keeps a stored pool in the per-state shape.
 *
 * A bare string array (the type in §3.3) is read as `{ any }`.
 */
export function normalizeSamplePool(value: unknown): SamplePool | undefined {
  if (Array.isArray(value)) {
    const any = value
      .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
      .map((line) => line.trim())
      .slice(0, SAMPLE_POOL_PER_STATE);
    return any.length > 0 ? { any } : undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const pool: SamplePool = {};
  for (const key of SAMPLE_POOL_KEYS) {
    const list = source[key];
    if (!Array.isArray(list)) continue;
    const lines = list
      .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
      .map((line) => line.trim())
      .slice(0, SAMPLE_POOL_PER_STATE);
    if (lines.length > 0) pool[key] = lines;
  }
  return Object.keys(pool).length > 0 ? pool : undefined;
}

/**
 * One pool per labelled mood, plus `any` from every line of theirs.
 *
 * Lines that `filterHarm` would drop stay out. A mood with no labelled
 * text is simply absent.
 */
export function measureSamplePool(
  rows: FingerprintRow[],
  personaData?: { harmReport?: unknown } | null,
): SamplePool | undefined {
  const kept = filterHarm(assistantTexts(rows), personaData as { harmReport?: never } | null);
  if (kept.length === 0) return undefined;
  const pool: SamplePool = {};
  const any = sampleLines(kept, SAMPLE_POOL_PER_STATE);
  if (any.length > 0) pool.any = any;
  for (const state of FINGERPRINT_STATES) {
    const group = kept.filter((row) => isEmotionalState(row.emotion) && row.emotion === state);
    const lines = sampleLines(group, SAMPLE_POOL_PER_STATE);
    if (lines.length > 0) pool[state] = lines;
  }
  return Object.keys(pool).length > 0 ? pool : undefined;
}
