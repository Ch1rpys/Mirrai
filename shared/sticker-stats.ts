/**
 * How often they send a sticker, and which one.
 *
 * A persona that sends a sticker must send one it really sent, at a
 * rate it really used. Nothing here invents a sticker or a frequency:
 * fewer than ten in the record and the measurement does not exist.
 */
import { splitScenes, toTurns } from "./scenes";

export const STICKER_MIN_SAMPLES = 10;
/** A state needs this many turns before its own rate is used. */
export const STICKER_STATE_MIN_TURNS = 20;

export interface StickerRow {
  role: string;
  kind?: string | null;
  content?: string | null;
  emotion?: string | null;
  timestamp?: Date | string | null;
  speaker?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface StickerStats {
  /** The number of sticker messages the persona sent. */
  samples: number;
  /**
   * A rate the user typed in answer to the clarification question.
   *
   * It is kept so the answer is not lost; the generation path uses the
   * measured rate, because a persona may only send the stickers it
   * really sent.
   */
  manualRate?: number;
  /** Turns with a sticker ÷ their turns. */
  rate: number;
  /** Of the turns that used a sticker, the share where it was the only thing said. */
  soloRate: number;
  /**
   * Per emotional state. A state with fewer than the minimum turns
   * still appears, so the picker can say how little is known — but the
   * generation path only uses it when `turns` is large enough.
   */
  byState: Record<
    string,
    { rate: number; turns: number; top: Array<{ key: string; n: number }> }
  >;
  /** How many stickers a turn carried. */
  runs: { one: number; two: number; threePlus: number };
}

function isSticker(row: StickerRow): boolean {
  return (row.kind ?? "text") === "sticker";
}

/**
 * The name the record used for a sticker.
 *
 * It is the export's label, then its own key, then the token. This is
 * also what the library row is called, so the two can be matched.
 */
export function stickerNameOf(row: StickerRow): string {
  const label = typeof row.meta?.label === "string" ? row.meta.label.trim() : "";
  if (label) return label;
  const match = String(row.content ?? "").trim().match(/^\[sticker(?::([^\]]*))?\]$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  const key = typeof row.meta?.stickerKey === "string" ? row.meta.stickerKey.trim() : "";
  return key;
}

function emotionOf(turn: StickerRow[]): string | null {
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    const emotion = turn[index]?.emotion;
    if (typeof emotion === "string" && emotion.trim()) return emotion.trim();
  }
  return null;
}

function emptyRuns() {
  return { one: 0, two: 0, threePlus: 0 };
}

export function measureStickers(rows: StickerRow[]): StickerStats | null {
  const turns: StickerRow[][] = [];
  for (const scene of splitScenes(rows)) {
    for (const turn of toTurns(scene)) {
      if (turn[0]?.role === "assistant") turns.push(turn);
    }
  }

  let samples = 0;
  let stickerTurns = 0;
  let soloTurns = 0;
  const runs = emptyRuns();
  const byState: StickerStats["byState"] = {};
  const stateStickerTurns: Record<string, number> = {};

  for (const turn of turns) {
    const stickers = turn.filter(isSticker);
    const state = emotionOf(turn);
    const bucket = state
      ? (byState[state] ??= { rate: 0, turns: 0, top: [] })
      : null;
    if (bucket) bucket.turns += 1;
    if (stickers.length === 0) continue;

    stickerTurns += 1;
    if (state) stateStickerTurns[state] = (stateStickerTurns[state] ?? 0) + 1;
    samples += stickers.length;
    if (turn.every(isSticker)) soloTurns += 1;
    if (stickers.length === 1) runs.one += 1;
    else if (stickers.length === 2) runs.two += 1;
    else runs.threePlus += 1;

    if (bucket) {
      const counts = new Map<string, number>();
      for (const sticker of stickers) {
        const name = stickerNameOf(sticker);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const before = new Map(bucket.top.map((entry) => [entry.key, entry.n]));
      for (const [key, n] of counts) before.set(key, (before.get(key) ?? 0) + n);
      bucket.top = [...before.entries()]
        .map(([key, n]) => ({ key, n }))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    }
  }

  if (samples < STICKER_MIN_SAMPLES) return null;

  for (const [state, bucket] of Object.entries(byState)) {
    bucket.rate = bucket.turns === 0 ? 0 : (stateStickerTurns[state] ?? 0) / bucket.turns;
  }

  return {
    samples,
    rate: turns.length === 0 ? 0 : stickerTurns / turns.length,
    soloRate: stickerTurns === 0 ? 0 : soloTurns / stickerTurns,
    byState,
    runs,
  };
}

/**
 * Reads a stored measurement.
 *
 * A profile written by an older version, or a hand-edited one, must not
 * make the generation path throw — it just means there is no
 * measurement.
 */
export function normalizeStickerStats(value: unknown): StickerStats | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  /**
   * A profile written before the full measurement existed can carry
   * just a rate — B1.6 stored the answer to "how often do they use
   * stickers?" that way. It is still a measurement, so it counts as
   * one; what stays refused is a measurement that says it looked at
   * fewer than ten stickers.
   */
  if (typeof source.samples === "number" && source.samples < STICKER_MIN_SAMPLES) return null;
  if (typeof source.rate !== "number") return null;
  if (source.samples === undefined && source.soloRate === undefined) {
    return {
      samples: 0,
      rate: source.rate,
      soloRate: 0,
      byState: {},
      runs: { one: 0, two: 0, threePlus: 0 },
      ...(typeof source.manualRate === "number" ? { manualRate: source.manualRate } : {}),
    };
  }

  const rawRuns = (source.runs ?? {}) as Record<string, unknown>;
  const runs = {
    one: typeof rawRuns.one === "number" ? rawRuns.one : 0,
    two: typeof rawRuns.two === "number" ? rawRuns.two : 0,
    threePlus: typeof rawRuns.threePlus === "number" ? rawRuns.threePlus : 0,
  };

  const byState: StickerStats["byState"] = {};
  const rawStates = (source.byState ?? {}) as Record<string, unknown>;
  for (const [state, raw] of Object.entries(rawStates)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.rate !== "number" || typeof entry.turns !== "number") continue;
    const top = Array.isArray(entry.top)
      ? entry.top
          .filter(
            (item): item is { key: string; n: number } =>
              item !== null &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).key === "string" &&
              typeof (item as Record<string, unknown>).n === "number",
          )
          .map((item) => ({ key: item.key, n: item.n }))
      : [];
    byState[state] = { rate: entry.rate, turns: entry.turns, top };
  }

  return {
    samples: source.samples as number,
    rate: source.rate as number,
    soloRate: source.soloRate as number,
    byState,
    runs,
    ...(typeof source.manualRate === "number" ? { manualRate: source.manualRate } : {}),
  };
}
