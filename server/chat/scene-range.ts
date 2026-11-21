/**
 * A scene drawn from a stretch of the record, at prompt time (C8.13).
 *
 * The scene stores the two records that end the stretch and the two
 * days the interface names. This module turns that into the two things
 * the prompt needs: the instruction that says how far the persona's
 * knowledge reaches, and the six to twelve lines the two of them
 * actually said.
 *
 * The lines are read out of the record on every turn rather than
 * frozen into the scene, so a record the user has since deleted, or a
 * harmful line they decided to filter, is not resurrected by a scene.
 *
 * A scene like this belongs to the persona it was taken from. The
 * database refuses to attach it to another persona; this module refuses
 * to use one that got attached anyway, so a shared or stale persona
 * never speaks from somebody else's records.
 */
import type { CollectedMessage, Persona, Scene } from "../../drizzle/schema";
import * as db from "../db";
import { copy } from "@shared/copy";
import type { HarmReport } from "@shared/harm";
import { periodToInstant } from "@shared/period-boundary";
import { resolveRecordScope } from "@shared/persona-sharing";
import {
  compareSceneRangeRows,
  normalizeSceneRecordRange,
  renderSceneRangeLines,
  sceneRangeRowAt,
  selectSceneRangeLines,
  type SceneRecordRange,
} from "@shared/scene-range";
import type { Locale } from "@shared/copy";

/**
 * The most rows of a stretch the prompt will read.
 *
 * A stretch is one consecutive run of lines, so it is normally small.
 * The cap is for the pathological case — a day with tens of thousands
 * of imported messages — where the prompt must still be built in
 * bounded time.
 */
export const MAX_SCENE_RANGE_SCAN = 400;

export interface SceneRangeMaterial {
  range: SceneRecordRange;
  /** The instruction: the days, and that after them is unknown. */
  boundary: string;
  /** The lines, rendered; empty when the stretch has none left. */
  section: string;
  /** The end of the stretch, used as a knowledge boundary. */
  end: Date;
}

/**
 * The persona a range scene is bound to, plus the scope its records are
 * read under (C7.2: a shared persona's records are the owner's).
 */
type SceneRangePersona = Pick<Persona, "id" | "name" | "personaData" | "userId"> & {
  sharedFromPersonaId?: number | null;
  sharedFromUserId?: number | null;
};

/** The range a scene carries, if it is one drawn from the record. */
export function sceneRangeOf(scene: { recordRange?: unknown } | null | undefined): SceneRecordRange | null {
  return normalizeSceneRecordRange(scene?.recordRange ?? null);
}

/**
 * Whether this scene may be used on this persona at all.
 *
 * An ordinary scene is for everybody. A scene drawn from the record is
 * only for the persona whose record it came from.
 */
export function sceneUsableForPersona(
  scene: { recordRange?: unknown } | null | undefined,
  personaId: number,
): boolean {
  const range = sceneRangeOf(scene);
  return !range || range.personaId === personaId;
}

/**
 * The rows of a stretch, in the order they were said.
 *
 * The two ends are read first, which fixes both the exact ids that
 * bound the stretch and the moments to page between. The page is then
 * narrowed by the same `(when, id)` order the record is read in — so a
 * stretch is exactly what the reader showed, not the whole day around
 * it.
 */
async function readSceneRangeRows(params: {
  range: SceneRecordRange;
  persona: SceneRangePersona;
}): Promise<CollectedMessage[]> {
  /**
   * A shared persona's records are the owner's (C7.2). The scene is
   * bound to the persona the member sees, but the lines live under the
   * owner's row — reading the member's own empty row would give a scene
   * with a boundary and nothing inside it.
   */
  const scope = resolveRecordScope(params.persona);
  const ends = await db.getRecordsByIds(
    [...new Set([params.range.fromId, params.range.toId])],
    scope.userId,
  );
  const byId = new Map(ends.map((row) => [row.id, row]));
  const first = byId.get(params.range.fromId);
  const last = byId.get(params.range.toId);
  if (!first || !last) return [];
  if (first.personaId !== scope.personaId || last.personaId !== scope.personaId) return [];

  const firstAt = sceneRangeRowAt(first);
  const lastAt = sceneRangeRowAt(last);
  if (!firstAt || !lastAt) return [];
  const firstKey = { at: firstAt, id: first.id };
  const lastKey = { at: lastAt, id: last.id };
  const forward = compareSceneRangeRows(firstKey, lastKey) <= 0;
  const start = forward ? firstKey : lastKey;
  const end = forward ? lastKey : firstKey;

  const rows: CollectedMessage[] = [];
  for await (const row of db.iterateRecords(scope.personaId, scope.userId, { from: start.at, to: end.at })) {
    const at = sceneRangeRowAt(row);
    if (!at) continue;
    const key = { at, id: row.id };
    if (compareSceneRangeRows(key, start) < 0) continue;
    if (compareSceneRangeRows(key, end) > 0) break;
    rows.push(row);
    if (rows.length >= MAX_SCENE_RANGE_SCAN) break;
  }
  return rows;
}

/**
 * How many usable lines a stretch would give the prompt.
 *
 * The scene is created only when this reaches the minimum — a context
 * scene with one line in it is not the context of anything. A read that
 * fails counts as zero: the route refuses rather than creates a scene
 * whose lines may never have existed.
 */
export async function countSceneRangeLines(params: {
  range: SceneRecordRange;
  persona: SceneRangePersona;
}): Promise<number> {
  try {
    const rows = await readSceneRangeRows({ range: params.range, persona: params.persona });
    return selectSceneRangeLines(
      rows,
      params.persona.personaData as { harmReport?: HarmReport | null } | null,
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Reads the material for a range scene, or gives up.
 *
 * Returns null when the scene is not a range scene, when it belongs to
 * another persona, or when its stored range cannot be read. A missing
 * record is not a failure of the whole chat: the boundary still holds,
 * the lines are simply not there any more.
 */
export async function loadSceneRangeMaterial(params: {
  scene: Pick<Scene, "recordRange"> | null | undefined;
  persona: SceneRangePersona;
  locale: Locale;
  /** The clock zone the days are read in. */
  timeZone?: string | null;
  /** The user's name, for lines the user said. */
  meName?: string;
}): Promise<SceneRangeMaterial | null> {
  const range = sceneRangeOf(params.scene);
  if (!range) return null;
  if (range.personaId !== params.persona.id) return null;
  const end = periodToInstant(range.to, params.timeZone ?? null);
  if (!end) return null;

  const boundary = copy(params.locale, "prompt.sceneRangeBoundary", {
    from: range.from,
    to: range.to,
  });

  let rows: CollectedMessage[] = [];
  try {
    rows = await readSceneRangeRows({ range, persona: params.persona });
  } catch {
    // A read that fails is not a reason to fail the turn. The boundary
    // is the promise; the lines are the colour.
    rows = [];
  }
  const lines = selectSceneRangeLines(
    rows,
    params.persona.personaData as { harmReport?: HarmReport | null } | null,
  );
  const section = lines.length
    ? renderSceneRangeLines(lines, {
        locale: params.locale,
        timeZone: params.timeZone ?? null,
        themName: params.persona.name,
        meName: params.meName,
      })
    : "";

  return { range, boundary, section, end };
}
