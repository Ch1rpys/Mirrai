/**
 * What the records say about the user, not about the persona.
 *
 * The fingerprint of the user's own lines is filled in by B3.1. This
 * file only counts those lines, the acts already labelled on them, a
 * dozen representative quotes, and how long they take to reply. None
 * of this is written into a prompt.
 */
import { isTextRecord } from "./records";
import { isUserAct, type UserAct } from "./speech-acts";
import type { StyleFingerprint } from "./style-fingerprint";

const MIN_USER_SIDE_SAMPLES = 40;
const SAMPLE_LINE_COUNT = 12;

/**
 * One line of the record, as this measurement reads it.
 *
 * The chunker's `RecordLine` satisfies this.
 */
export interface UserSideRecord {
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  act?: string | null;
}

export interface UserSideProfile {
  /** How many of the user's own text lines were counted. */
  samples: number;
  /** Filled by B3.1. Absent until then. */
  fingerprint?: StyleFingerprint;
  acts?: Partial<Record<UserAct, number>>;
  /** Twelve representative quotes, evenly spaced in time. */
  sampleLines: string[];
  replyGapMedianSec?: number;
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

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid];
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

function isUserText(row: UserSideRecord): boolean {
  return row.role === "user" && isTextRecord(row) && row.content.trim().length > 0;
}

/**
 * Reads the user's own lines.
 *
 * Fewer than forty text lines is not a profile: there is not enough
 * to sample twelve quotes from, or to trust a median gap.
 */
export function measureUserSide(rows: UserSideRecord[]): UserSideProfile | null {
  const userTexts = rows.filter(isUserText);
  if (userTexts.length < MIN_USER_SIDE_SAMPLES) return null;

  const lengths = userTexts.map((row) => row.content.trim().length).sort((a, b) => a - b);
  const q1 = quantile(lengths, 0.25);
  const q3 = quantile(lengths, 0.75);
  const inIqr = userTexts.filter((row) => {
    const length = row.content.trim().length;
    return length >= q1 && length <= q3;
  });
  const pool = inIqr.length >= SAMPLE_LINE_COUNT ? inIqr : userTexts;
  const timed = pool
    .slice()
    .sort((a, b) => (asDate(a.timestamp)?.getTime() ?? 0) - (asDate(b.timestamp)?.getTime() ?? 0));
  const sampleLines = pickEven(timed, SAMPLE_LINE_COUNT).map((row) => row.content.trim());

  const acts: Partial<Record<UserAct, number>> = {};
  for (const row of userTexts) {
    if (!isUserAct(row.act)) continue;
    acts[row.act] = (acts[row.act] ?? 0) + 1;
  }

  const gaps: number[] = [];
  let lastAssistantAt: number | null = null;
  for (const row of rows) {
    const at = asDate(row.timestamp)?.getTime() ?? null;
    if (row.role === "assistant" && isTextRecord(row) && at != null) {
      lastAssistantAt = at;
      continue;
    }
    if (isUserText(row) && lastAssistantAt != null && at != null) {
      const gap = (at - lastAssistantAt) / 1000;
      if (gap >= 0) gaps.push(gap);
      lastAssistantAt = null;
    }
  }

  const profile: UserSideProfile = {
    samples: userTexts.length,
    sampleLines,
  };
  if (Object.keys(acts).length > 0) profile.acts = acts;
  const replyGapMedianSec = median(gaps);
  if (replyGapMedianSec != undefined) profile.replyGapMedianSec = replyGapMedianSec;
  return profile;
}
