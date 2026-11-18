/**
 * Whether they used to start a topic in the middle of a chat.
 *
 * A reply that only answers what was just asked is not them bringing
 * something up. This counts the turns where they did — so a later turn
 * can decide, at their own rate, whether to add one thing of their own.
 */
import { charBigrams, jaccard } from "./act-clusters";
import { inProgressLife, openLoops, type LifeEvent } from "./life-events";
import { isTextRecord } from "./records";
import { toTurns } from "./scenes";
import { isUserAsking } from "./speech-acts";

export const IN_SESSION_MIN_SAMPLES = 100;
export const IN_SESSION_OVERLAP_MAX = 0.1;

export interface InSessionLine {
  role: string;
  content?: string | null;
  kind?: string | null;
}

export interface InSessionProfile {
  samples: number;
  selfStartRate: number;
}

function turnText(rows: InSessionLine[]): string {
  return rows
    .filter((row) => isTextRecord(row))
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean)
    .join("");
}

export function countSelfStarts(turns: InSessionLine[][]): { samples: number; selfStarts: number } {
  let samples = 0;
  let selfStarts = 0;
  let seenAssistant = false;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    if (turn[0]?.role !== "assistant") continue;
    if (!seenAssistant) {
      seenAssistant = true;
      continue;
    }
    samples += 1;
    const previous = turns[i - 1];
    if (!previous || previous[0]?.role !== "user") continue;
    if (isUserAsking(turnText(previous))) continue;
    const earlier = turns.slice(Math.max(0, i - 2), i).map(turnText).join("");
    const overlap = jaccard(charBigrams(turnText(turn)), charBigrams(earlier));
    if (overlap < IN_SESSION_OVERLAP_MAX) selfStarts += 1;
  }
  return { samples, selfStarts };
}

export function measureInSession(turns: InSessionLine[][]): InSessionProfile | null {
  const counted = countSelfStarts(turns);
  if (counted.samples < IN_SESSION_MIN_SAMPLES) return null;
  return {
    samples: counted.samples,
    selfStartRate: counted.selfStarts / counted.samples,
  };
}

export function measureInSessionFromScenes(scenes: InSessionLine[][]): InSessionProfile | null {
  let samples = 0;
  let selfStarts = 0;
  for (const scene of scenes) {
    const counted = countSelfStarts(toTurns(scene));
    samples += counted.samples;
    selfStarts += counted.selfStarts;
  }
  if (samples < IN_SESSION_MIN_SAMPLES) return null;
  return { samples, selfStartRate: selfStarts / samples };
}

export function normalizeInSession(value: unknown): InSessionProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const samples = Math.round(Number(source.samples) || 0);
  const selfStartRate = Number(source.selfStartRate);
  if (samples < 1 || !Number.isFinite(selfStartRate)) return undefined;
  return {
    samples,
    selfStartRate: Math.max(0, Math.min(1, selfStartRate)),
  };
}

/** Open loops first, then an in-progress life event. Routine waits on B6.3. */
export function pickInSessionFact(events: LifeEvent[]): string | null {
  const picked = openLoops(events)[0] ?? inProgressLife(events)[0];
  if (!picked) return null;
  const text = (picked.detail || picked.title).trim();
  return text || null;
}
