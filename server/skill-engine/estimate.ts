/**
 * How much a distillation will read, and how many model calls it will
 * make, before the user starts it.
 */
import {
  DEFAULT_MAX_DISTILL_CALLS,
  DISTILL_CALLS_CONFIRM_AFTER,
  getDistillationPreset,
  type DistillationMode,
} from "@shared/distillation-modes";
import * as db from "../db";
import {
  chunkRecords,
  distillChunkSeed,
  takeChunkBudget,
  type RecordChunk,
  type RecordLine,
} from "./chunks";
import { CARDS_PER_CALL } from "./reduce";

export { DEFAULT_MAX_DISTILL_CALLS, DISTILL_CALLS_CONFIRM_AFTER };

/** The map stage writes at most this many cards per block. */
const MAX_CARDS_PER_CHUNK = 8;

export interface DistillationEstimate {
  chunks: number;
  chars: number;
  mapCalls: number;
  reduceCalls: number;
  calls: number;
}

export function maxDistillCalls(): number {
  const n = Number.parseInt(process.env.MAX_DISTILL_CALLS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_DISTILL_CALLS;
}

function dbIterate():
  | ((personaId: number, userId: number) => AsyncIterable<unknown>)
  | undefined {
  try {
    const value = (db as Record<string, unknown>).iterateRecords;
    return typeof value === "function"
      ? (value as (personaId: number, userId: number) => AsyncIterable<unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asRecordLine(row: {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: Date | string | null;
  kind?: unknown;
  speaker?: unknown;
  meta?: unknown;
}): RecordLine | null {
  if (typeof row.id !== "number") return null;
  if (row.role !== "user" && row.role !== "assistant" && row.role !== "other") {
    return null;
  }
  if (typeof row.content !== "string") return null;
  const timestamp =
    row.timestamp instanceof Date
      ? row.timestamp
      : row.timestamp
        ? new Date(row.timestamp)
        : null;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
    kind: typeof row.kind === "string" ? row.kind : null,
    speaker: typeof row.speaker === "string" ? row.speaker : null,
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null,
  };
}

/**
 * The map/reduce cost of a hashed record, plus the rest of the run.
 *
 * The rest is the preset's old `approxCalls` minus the one analyser
 * call this path replaces. A persona with no structured rows keeps
 * that old number in full.
 */
export function estimateDistillation(
  chunks: RecordChunk[],
  mode?: DistillationMode | null,
  seed?: string,
): DistillationEstimate {
  const preset = getDistillationPreset(mode);
  const selected = takeChunkBudget(chunks, preset.chunkBudget, seed);
  if (selected.length === 0) {
    return {
      chunks: 0,
      chars: 0,
      mapCalls: 0,
      reduceCalls: 0,
      calls: preset.approxCalls,
    };
  }
  const byPeriod = new Map<string, number>();
  let chars = 0;
  for (const chunk of selected) {
    chars += chunk.chars;
    const key = chunk.periodId ?? "";
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + 1);
  }
  let reduceCalls = 0;
  for (const count of byPeriod.values()) {
    const assumedCards = count * MAX_CARDS_PER_CHUNK;
    const batches = Math.max(1, Math.ceil(assumedCards / CARDS_PER_CALL));
    reduceCalls += batches;
    if (batches > 1) reduceCalls += 1;
  }
  const mapCalls = selected.length;
  const rest = Math.max(0, preset.approxCalls - 1);
  return {
    chunks: selected.length,
    chars,
    mapCalls,
    reduceCalls,
    calls: mapCalls + reduceCalls + rest,
  };
}

export async function estimateDistillationForPersona(params: {
  personaId: number;
  userId: number;
  mode?: DistillationMode | null;
  timeZone?: string | null;
  themName?: string;
}): Promise<DistillationEstimate> {
  const iterate = dbIterate();
  const rows: RecordLine[] = [];
  if (iterate) {
    for await (const row of iterate(params.personaId, params.userId)) {
      const line = asRecordLine(row as Parameters<typeof asRecordLine>[0]);
      if (line) rows.push(line);
    }
  }
  const chunks = chunkRecords(rows, {
    timeZone: params.timeZone,
    themName: params.themName,
  });
  return estimateDistillation(
    chunks,
    params.mode,
    distillChunkSeed(params.personaId, chunks.length),
  );
}
