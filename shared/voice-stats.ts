/**
 * How often they send a voice note, and how long those notes are.
 *
 * The measurement is the whole point of the feature: a persona that
 * sends one voice note in twelve turns should not send every reply as
 * audio, and a persona that sends three-minute monologues should not be
 * cut down to four seconds.
 *
 * Fewer than ten voice notes and there is no measurement at all.
 */
import { splitScenes, toTurns } from "./scenes";

export const VOICE_MIN_SAMPLES = 10;
export const VOICE_STATE_MIN_TURNS = 20;
/** The estimate the app uses before synthesising: four characters a second. */
export const VOICE_CHARS_PER_SECOND = 4;

export interface VoiceRow {
  role: string;
  kind?: string | null;
  content?: string | null;
  emotion?: string | null;
  timestamp?: Date | string | null;
  speaker?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface VoiceStats {
  /** Voice notes the persona sent. */
  samples: number;
  /** Voice turns ÷ their turns. */
  rate: number;
  durationSec: { median: number; p90: number };
  byState: Record<string, { rate: number; turns: number }>;
  /** After the user sent a voice note, how often they sent one back. */
  afterMyVoiceRate: number | null;
  /** B7.5 fills this. */
  prosody?: unknown;
}

function isVoice(row: VoiceRow): boolean {
  return (row.kind ?? "text") === "voice";
}

function durationOf(row: VoiceRow): number | null {
  const fromMeta = Number(row.meta?.durationSec);
  if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
  const match = String(row.content ?? "").match(/^\[voice:(\d+(?:\.\d+)?)\]$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function emotionOf(turn: VoiceRow[]): string | null {
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const emotion = turn[index]?.emotion;
    if (typeof emotion === "string" && emotion.trim()) return emotion.trim();
  }
  return null;
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[index]!;
}

export function measureVoice(rows: VoiceRow[]): VoiceStats | null {
  const turns: VoiceRow[][] = [];
  for (const scene of splitScenes(rows)) {
    for (const turn of toTurns(scene)) {
      if (turn[0]?.role === "assistant") turns.push(turn);
    }
  }

  const durations: number[] = [];
  let samples = 0;
  let voiceTurns = 0;
  const byState: VoiceStats["byState"] = {};
  const stateVoiceTurns: Record<string, number> = {};
  let afterMyVoice = 0;
  let afterMyVoiceTurns = 0;

  const issued: boolean[] = turns.map((turn) => turn.some(isVoice));
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    const state = emotionOf(turn);
    const bucket = state ? (byState[state] ??= { rate: 0, turns: 0 }) : null;
    if (bucket) bucket.turns += 1;
    if (issued[index]) {
      voiceTurns += 1;
      if (state) stateVoiceTurns[state] = (stateVoiceTurns[state] ?? 0) + 1;
      for (const row of turn) {
        if (!isVoice(row)) continue;
        samples += 1;
        const duration = durationOf(row);
        if (duration != null) durations.push(duration);
      }
    }
    if (index > 0 && turns[index - 1]!.some(isVoice) && turns[index - 1]![0]?.role === "user") {
      afterMyVoiceTurns += 1;
      if (issued[index]) afterMyVoice += 1;
    }
  }

  if (samples < VOICE_MIN_SAMPLES) return null;

  for (const [state, bucket] of Object.entries(byState)) {
    bucket.rate = bucket.turns === 0 ? 0 : (stateVoiceTurns[state] ?? 0) / bucket.turns;
  }

  return {
    samples,
    rate: turns.length === 0 ? 0 : voiceTurns / turns.length,
    durationSec: {
      median: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
    },
    byState,
    afterMyVoiceRate: afterMyVoiceTurns === 0 ? null : afterMyVoice / afterMyVoiceTurns,
  };
}

/** Reads a stored measurement, or null when there is none. */
export function normalizeVoiceStats(value: unknown): VoiceStats | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.samples !== "number" || source.samples < VOICE_MIN_SAMPLES) return null;
  if (typeof source.rate !== "number") return null;
  const duration = (source.durationSec ?? {}) as Record<string, unknown>;
  if (typeof duration.median !== "number" || typeof duration.p90 !== "number") return null;

  const byState: VoiceStats["byState"] = {};
  const rawStates = (source.byState ?? {}) as Record<string, unknown>;
  for (const [state, raw] of Object.entries(rawStates)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.rate !== "number" || typeof entry.turns !== "number") continue;
    byState[state] = { rate: entry.rate, turns: entry.turns };
  }

  return {
    samples: source.samples,
    rate: source.rate,
    durationSec: { median: duration.median, p90: duration.p90 },
    byState,
    afterMyVoiceRate:
      typeof source.afterMyVoiceRate === "number" ? source.afterMyVoiceRate : null,
    ...(source.prosody ? { prosody: source.prosody } : {}),
  };
}

/**
 * The estimated length of speaking a line, in seconds.
 *
 * Four characters a second is a steady pace for Chinese speech; the
 * point is a bound, not a stopwatch.
 */
export function estimateSpeechSeconds(text: string): number {
  return Math.ceil(Array.from(text).length / VOICE_CHARS_PER_SECOND);
}
