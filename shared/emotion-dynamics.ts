/**
 * How their mood used to move.
 *
 * A turn used to re-judge the last exchange from scratch, so a joke
 * could end a cold stretch that, in the records, would have lasted
 * hours. These numbers are how long a negative state used to last,
 * and how rarely it flipped to a given other state in one scene.
 */
import { isTextRecord } from "./records";
import { FINGERPRINT_STATES, type EmotionalState } from "./style-fingerprint";

export const DYNAMICS_MIN_TRANSITIONS = 30;
export const DWELL_MIN_EPISODES = 5;
export const TRANSITION_MAX_GAP_MS = 48 * 3_600_000;
/** A cold stretch that only ends the next day is a new mood, not this episode. */
export const DWELL_MAX_MS = 12 * 3_600_000;
const NEGATIVE_STATES = ["distant", "melancholy"] as const;
type NegativeState = (typeof NEGATIVE_STATES)[number];

export interface EmotionDynamics {
  /** transitions[a][b]: adjacent scenes (gap at most 48 hours) from a to b. */
  transitions: Record<string, Record<string, number>>;
  /** How long a negative state lasted, in minutes. */
  dwell: Partial<Record<NegativeState, { medianMin: number; p75Min: number; episodes: number }>>;
  /** The most common labelled state in the records. */
  modal: string;
  /** How many scene-to-scene transitions were counted. */
  samples: number;
}

export interface LabelledLine {
  role: string;
  emotion?: string | null;
  timestamp?: Date | string | null;
  kind?: string | null;
}

export type LabelledScene = LabelledLine[];

function isEmotionalState(value: unknown): value is EmotionalState {
  return typeof value === "string" && (FINGERPRINT_STATES as readonly string[]).includes(value);
}

function isNegative(value: string): value is NegativeState {
  return (NEGATIVE_STATES as readonly string[]).includes(value);
}

function spokenAt(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function sceneEmotion(scene: LabelledScene): EmotionalState | null {
  let last: EmotionalState | null = null;
  for (const row of scene) {
    if (row.role !== "assistant" || !isTextRecord(row) || !isEmotionalState(row.emotion)) continue;
    last = row.emotion;
  }
  return last;
}

function sceneBounds(scene: LabelledScene): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  for (const row of scene) {
    const at = spokenAt(row.timestamp);
    if (at == null) continue;
    if (from == null || at < from) from = at;
    if (to == null || at > to) to = at;
  }
  return from == null || to == null ? null : { from, to };
}

function assistantLines(scenes: LabelledScene[]): Array<{ emotion: EmotionalState; at: number }> {
  const out: Array<{ emotion: EmotionalState; at: number }> = [];
  for (const scene of scenes) {
    for (const row of scene) {
      if (row.role !== "assistant" || !isTextRecord(row) || !isEmotionalState(row.emotion)) continue;
      const at = spokenAt(row.timestamp);
      if (at == null) continue;
      out.push({ emotion: row.emotion, at });
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

function dwellMinutes(lines: Array<{ emotion: EmotionalState; at: number }>): Record<NegativeState, number[]> {
  const out: Record<NegativeState, number[]> = { distant: [], melancholy: [] };
  let i = 0;
  while (i < lines.length) {
    const start = lines[i]!;
    if (!isNegative(start.emotion)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j]!.emotion === start.emotion) j += 1;
    const end = lines[j];
    if (end) {
      const span = end.at - start.at;
      if (span >= 0 && span <= DWELL_MAX_MS) {
        out[start.emotion].push(span / 60_000);
      }
    }
    i = j;
  }
  return out;
}

export function measureEmotionDynamics(scenes: LabelledScene[]): EmotionDynamics | null {
  const labelled: Array<{ emotion: EmotionalState; from: number; to: number }> = [];
  for (const scene of scenes) {
    const emotion = sceneEmotion(scene);
    const bounds = sceneBounds(scene);
    if (!emotion || !bounds) continue;
    labelled.push({ emotion, from: bounds.from, to: bounds.to });
  }
  labelled.sort((a, b) => a.from - b.from);

  const transitions: Record<string, Record<string, number>> = {};
  let samples = 0;
  for (let i = 0; i < labelled.length - 1; i++) {
    const from = labelled[i]!;
    const to = labelled[i + 1]!;
    if (to.from - from.to > TRANSITION_MAX_GAP_MS) continue;
    const row = transitions[from.emotion] ?? (transitions[from.emotion] = {});
    row[to.emotion] = (row[to.emotion] ?? 0) + 1;
    samples += 1;
  }
  if (samples < DYNAMICS_MIN_TRANSITIONS) return null;

  const counts = new Map<string, number>();
  for (const line of assistantLines(scenes)) {
    counts.set(line.emotion, (counts.get(line.emotion) ?? 0) + 1);
  }
  let modal = "warm";
  let modalCount = -1;
  for (const state of FINGERPRINT_STATES) {
    const n = counts.get(state) ?? 0;
    if (n > modalCount) {
      modal = state;
      modalCount = n;
    }
  }

  const dwell: EmotionDynamics["dwell"] = {};
  const minutes = dwellMinutes(assistantLines(scenes));
  for (const state of NEGATIVE_STATES) {
    const list = minutes[state].slice().sort((a, b) => a - b);
    if (list.length < DWELL_MIN_EPISODES) continue;
    dwell[state] = {
      medianMin: quantile(list, 0.5),
      p75Min: quantile(list, 0.75),
      episodes: list.length,
    };
  }

  return { transitions, dwell, modal, samples };
}

export function decayState(input: {
  current: string;
  sinceMin: number;
  dynamics: EmotionDynamics;
}): string {
  if (!isNegative(input.current)) return input.current;
  const dwell = input.dynamics.dwell[input.current];
  if (!dwell) return input.current;
  if (input.sinceMin > dwell.p75Min) return input.dynamics.modal;
  return input.current;
}

export function applyInertia(input: {
  current: string;
  proposed: string;
  sinceMin: number;
  userAct: string;
  dynamics: EmotionDynamics;
  /** From the conflict profile (B4.4). Missing means the exception is off. */
  repairAcceptRate?: number | null;
}): { state: string; kept: boolean; reason?: string } {
  if (!isNegative(input.current) || isNegative(input.proposed)) {
    return { state: input.proposed, kept: false };
  }
  const dwell = input.dynamics.dwell[input.current];
  if (!dwell) return { state: input.proposed, kept: false };
  if (input.sinceMin >= dwell.medianMin / 2) {
    return { state: input.proposed, kept: false };
  }
  const repairing =
    (input.userAct === "repair" || input.userAct === "affection") &&
    (input.repairAcceptRate ?? 0) >= 0.3;
  if (repairing) return { state: input.proposed, kept: false, reason: "repair" };

  const row = input.dynamics.transitions[input.current] ?? {};
  let total = 0;
  for (const n of Object.values(row)) total += n;
  const share = total > 0 ? (row[input.proposed] ?? 0) / total : 0;
  if (share < 0.15) {
    return { state: input.current, kept: true, reason: "inertia" };
  }
  return { state: input.proposed, kept: false };
}

export function normalizeEmotionDynamics(value: unknown): EmotionDynamics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const transitions: Record<string, Record<string, number>> = {};
  if (source.transitions && typeof source.transitions === "object") {
    for (const [from, row] of Object.entries(source.transitions as Record<string, unknown>)) {
      if (!row || typeof row !== "object") continue;
      const counts: Record<string, number> = {};
      for (const [to, n] of Object.entries(row as Record<string, unknown>)) {
        const count = Math.round(Number(n) || 0);
        if (count > 0) counts[to] = count;
      }
      if (Object.keys(counts).length > 0) transitions[from] = counts;
    }
  }
  const dwell: EmotionDynamics["dwell"] = {};
  if (source.dwell && typeof source.dwell === "object") {
    for (const state of NEGATIVE_STATES) {
      const row = (source.dwell as Record<string, unknown>)[state];
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const medianMin = Number(item.medianMin);
      const p75Min = Number(item.p75Min);
      const episodes = Math.round(Number(item.episodes) || 0);
      if (!Number.isFinite(medianMin) || !Number.isFinite(p75Min) || episodes < 1) continue;
      dwell[state] = { medianMin, p75Min, episodes };
    }
  }
  const modal = typeof source.modal === "string" && source.modal ? source.modal : "warm";
  const samples = Math.round(Number(source.samples) || 0);
  if (samples < 1 || Object.keys(transitions).length === 0) return undefined;
  return { transitions, dwell, modal, samples };
}
