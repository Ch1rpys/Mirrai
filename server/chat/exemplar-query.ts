/**
 * Exemplars retrieved by a query instead of by reading every record.
 *
 * C8.7. Each turn used to read the persona's whole history into memory
 * and score every reply. A long history made that the most expensive
 * thing in an ordinary conversation. Now the candidate user lines come
 * from the full-text index, and only the rows around them are read.
 *
 * The old path is still the fallback: rows imported before C8.6 have
 * no search tokens yet, and a search would silently miss them.
 */
import type { Exemplar, CollectedReply } from "./exemplars";
import { retrieveExemplarsWithEmbed } from "./embeddings";
import { toTurns } from "@shared/scenes";
import * as db from "../db";
import type { HarmReport } from "@shared/harm";
import type { ExemplarPeriod } from "./exemplars";

export interface TableExemplarParams {
  personaId: number;
  userId: number;
  userMessage: string;
  excludeIds?: Iterable<number>;
  excludeTexts?: Iterable<string>;
  personaData?: { harmReport?: HarmReport | null } | null;
  sampledAct?: string | null;
  restrictToSampledAct?: boolean;
  emotion?: string | null;
  now?: Date | null;
  timeZone?: string | null;
  period?: ExemplarPeriod | null;
  history?: Array<{ role: string; content: string; speaker?: string | null }>;
}

function periodDates(period: ExemplarPeriod | null | undefined): {
  from?: Date;
  to?: Date;
} {
  if (!period) return {};
  const from = new Date(period.from);
  const to = new Date(period.to);
  return {
    ...(Number.isFinite(from.getTime()) ? { from } : {}),
    ...(Number.isFinite(to.getTime()) ? { to } : {}),
  };
}

/**
 * `null` means "the table cannot answer this turn" — no records at
 * all, or rows whose tokens have not been filled in yet. The caller
 * then uses the old full read, and the answer is the one it always
 * gave.
 */
export async function retrieveExemplarsFromTable(
  params: TableExemplarParams,
): Promise<Exemplar[] | null> {
  try {
    const total = await db.countRecords(params.personaId, params.userId, { register: "all" });
    if (total === 0) return null;
    const missing = await db.countRecords(params.personaId, params.userId, {
      tokensMissing: true,
      register: "all",
    });
    if (missing > 0) return null;
  } catch {
    return null;
  }

  const { from, to } = periodDates(params.period);
  let candidates: Awaited<ReturnType<typeof db.candidateRecordsByOverlap>>;
  try {
    candidates = await db.candidateRecordsByOverlap(params.personaId, params.userId, {
      text: params.userMessage,
      role: "user",
      limit: 200,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  } catch {
    return null;
  }
  if (candidates.length === 0) return [];

  let windows: Awaited<ReturnType<typeof db.getWindowsAroundUserRecords>>;
  try {
    windows = await db.getWindowsAroundUserRecords(
      candidates.map((candidate) => candidate.id),
      params.userId,
      { before: 4, after: 8, maxGapHours: 6 },
    );
  } catch {
    return null;
  }

  /**
   * A small ordered record around each candidate.
   *
   * The scorer wants turns, not lines, so the user burst in front of a
   * reply and the reply's own bubbles are read together. Rows already
   * added by an earlier candidate are not added twice.
   */
  const records: CollectedReply[] = [];
  const seen = new Set<number>();
  const sceneKeyById = new Map<number, number>();
  let sceneKey = 0;
  for (const candidate of candidates) {
    const window = windows.get(candidate.id);
    if (!window) continue;
    const block = [...window.before, window.candidate, ...window.after];
    const turns = toTurns(block);
    const candidateTurn = turns.findIndex((turn) =>
      turn.some((row) => row.id === candidate.id),
    );
    const reply = candidateTurn >= 0 ? turns[candidateTurn + 1] : undefined;
    if (reply?.[0]?.role === "assistant") {
      sceneKeyById.set(reply[0].id, sceneKey);
    }
    sceneKey += 1;
    for (const row of block) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      records.push(row as CollectedReply);
    }
  }
  if (records.length === 0) return [];

  return retrieveExemplarsWithEmbed({
    userMessage: params.userMessage,
    records,
    excludeIds: params.excludeIds,
    excludeTexts: params.excludeTexts,
    personaData: params.personaData,
    sampledAct: params.sampledAct,
    restrictToSampledAct: Boolean(params.restrictToSampledAct),
    emotion: params.emotion,
    now: params.now ?? null,
    timeZone: params.timeZone ?? null,
    period: params.period ?? null,
    history: params.history,
    sceneKeyById,
    personaId: params.personaId,
    userId: params.userId,
  });
}
