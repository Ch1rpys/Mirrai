/**
 * "On this day" (C2.1)
 *
 * The years before, on the same calendar day. It shows the first
 * stretch of each such day and nothing else: no count, no badge, no
 * notification. It is only there when the user opens the hall.
 *
 * A day that was a bad one is skipped on the front page. The reader
 * still has it.
 */
import { zonedDateKey } from "@shared/timezone";
import { splitScenes } from "@shared/scenes";
import { findHarmKind, normalizeHarmReport } from "@shared/harm";
import * as db from "../db";

export interface OnThisDayRow {
  id: number;
  role: string;
  kind: string;
  content: string;
  timestamp: Date | null;
  meta: unknown;
}

export interface OnThisDayYear {
  year: number;
  date: string;
  rows: OnThisDayRow[];
}

const ROWS_PER_DAY = 6;
const NEGATIVE_STATES = new Set(["distant", "melancholy"]);

function monthDay(date: Date, timeZone?: string | null): string {
  return zonedDateKey(date, timeZone).slice(5);
}

/**
 * Whether one scene reads as a bad one.
 *
 * Only an actual label counts; an unlabelled scene is not assumed bad.
 */
function sceneIsNegative(rows: OnThisDayRow[]): boolean {
  const labels = rows
    .filter((row) => row.role === "assistant" && row.kind === "text")
    .map((row) => (row.meta as { emotion?: unknown } | null)?.emotion)
    .filter((state): state is string => typeof state === "string");
  if (labels.length === 0) return false;
  const negative = labels.filter((state) => NEGATIVE_STATES.has(state)).length;
  return negative * 2 > labels.length;
}

/**
 * The rows to show, from records the caller has already read.
 *
 * Pure so the calendar and the leap-day rule can be tested without a
 * database.
 */
export function pickOnThisDay(
  records: OnThisDayRow[],
  today: Date,
  timeZone?: string | null,
  options: { harmReport?: unknown; keepHarm?: boolean } = {},
): OnThisDayYear[] {
  const wanted = monthDay(today, timeZone);
  const leap = wanted === "02-28";
  const wantedYear = Number(zonedDateKey(today, timeZone).slice(0, 4));
  const report = normalizeHarmReport(options.harmReport);
  const keepHarm = options.keepHarm ?? report?.decision === "keep";
  const byYear = new Map<number, OnThisDayRow[]>();
  for (const row of records) {
    if (!row.timestamp) continue;
    if (row.kind !== "text") continue;
    if (!keepHarm && findHarmKind(row.content)) continue;
    const key = zonedDateKey(row.timestamp, timeZone);
    const year = Number(key.slice(0, 4));
    if (!Number.isFinite(year) || year >= wantedYear) continue;
    const day = key.slice(5);
    if (day !== wanted && !(leap && day === "02-29")) continue;
    const list = byYear.get(year) ?? [];
    list.push(row);
    byYear.set(year, list);
  }
  const out: OnThisDayYear[] = [];
  for (const [year, rows] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    rows.sort(
      (a, b) =>
        (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0) || a.id - b.id,
    );
    const scenes = splitScenes(rows);
    const scene = scenes.find((candidate) => !sceneIsNegative(candidate));
    if (!scene) continue;
    out.push({
      year,
      date: zonedDateKey(scene[0].timestamp!, timeZone),
      rows: scene.slice(0, ROWS_PER_DAY),
    });
  }
  return out;
}

/**
 * The same, read from the record table.
 *
 * `today` is passed in — the caller knows the user's clock, and tests
 * must not depend on when they run.
 */
export async function onThisDay(params: {
  personaId: number;
  userId: number;
  today: Date;
  timeZone?: string | null;
}): Promise<OnThisDayYear[]> {
  const records: OnThisDayRow[] = [];
  for await (const row of db.iterateRecords(params.personaId, params.userId)) {
    if (row.kind !== "text" || !row.timestamp) continue;
    records.push({
      id: row.id,
      role: row.role,
      kind: row.kind,
      content: row.content,
      timestamp: row.timestamp,
      meta: row.meta,
    });
  }
  const persona = await db.getPersonaById(params.personaId, params.userId);
  const report = (persona?.personaData as { harmReport?: unknown } | null)?.harmReport;
  return pickOnThisDay(records, params.today, params.timeZone, {
    harmReport: report,
    keepHarm: normalizeHarmReport(report)?.decision === "keep",
  });
}
