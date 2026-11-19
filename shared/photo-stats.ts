/**
 * How often they send a picture (B7.9).
 *
 * A picture is a message like a voice note: some people send one a
 * week, some never. The rate is measured per turn and per mood, and
 * the app only sends a picture it actually has — one the user attached
 * to a memory — never one it made up.
 *
 * Fewer than ten picture turns and there is no measurement at all.
 */
import { splitScenes, toTurns } from "./scenes";

export const PHOTO_MIN_SAMPLES = 10;
export const PHOTO_STATE_MIN_TURNS = 20;

export interface PhotoRow {
  role: string;
  kind?: string | null;
  content?: string | null;
  emotion?: string | null;
  timestamp?: Date | string | null;
}

export interface PhotoStats {
  /** Turns in which the persona sent a picture. */
  samples: number;
  /** Picture turns ÷ their turns. */
  rate: number;
  byState: Record<string, { rate: number; turns: number }>;
}

function isPhoto(row: PhotoRow): boolean {
  return (row.kind ?? "text") === "image";
}

function emotionOf(turn: PhotoRow[]): string | null {
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const emotion = turn[index]?.emotion;
    if (typeof emotion === "string" && emotion.trim()) return emotion.trim();
  }
  return null;
}

export function measurePhotos(rows: PhotoRow[]): PhotoStats | null {
  const turns: PhotoRow[][] = [];
  for (const scene of splitScenes(rows)) {
    for (const turn of toTurns(scene)) {
      if (turn[0]?.role === "assistant") turns.push(turn);
    }
  }

  let samples = 0;
  const byState: PhotoStats["byState"] = {};
  const stateWithPhoto: Record<string, number> = {};

  for (const turn of turns) {
    const state = emotionOf(turn);
    const bucket = state ? (byState[state] ??= { rate: 0, turns: 0 }) : null;
    if (bucket) bucket.turns += 1;
    if (turn.some(isPhoto)) {
      samples += 1;
      if (state) stateWithPhoto[state] = (stateWithPhoto[state] ?? 0) + 1;
    }
  }

  if (samples < PHOTO_MIN_SAMPLES) return null;

  for (const [state, bucket] of Object.entries(byState)) {
    bucket.rate = bucket.turns === 0 ? 0 : (stateWithPhoto[state] ?? 0) / bucket.turns;
  }

  return {
    samples,
    rate: turns.length === 0 ? 0 : samples / turns.length,
    byState,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizePhotoStats(value: unknown): PhotoStats | null {
  if (!isPlainObject(value)) return null;
  const samples = typeof value.samples === "number" ? value.samples : NaN;
  const rate = typeof value.rate === "number" ? value.rate : NaN;
  if (!Number.isFinite(samples) || samples < PHOTO_MIN_SAMPLES) return null;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null;

  const byState: PhotoStats["byState"] = {};
  if (isPlainObject(value.byState)) {
    for (const [state, bucket] of Object.entries(value.byState)) {
      if (!isPlainObject(bucket)) continue;
      const turns = typeof bucket.turns === "number" ? bucket.turns : NaN;
      const stateRate = typeof bucket.rate === "number" ? bucket.rate : NaN;
      if (!Number.isFinite(turns) || turns < 0) continue;
      if (!Number.isFinite(stateRate) || stateRate < 0 || stateRate > 1) continue;
      byState[state] = { rate: stateRate, turns };
    }
  }

  return { samples, rate, byState };
}
