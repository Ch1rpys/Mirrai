/**
 * A scene drawn from a stretch of the record (C8.13).
 *
 * The reader can take a day, or one consecutive run of lines, and ask
 * to talk in its context. The scene remembers the two records that end
 * the stretch and the two days the interface names; the lines the
 * prompt carries are read out of the record when the scene is used.
 *
 * Keeping the selection logic here — away from the database and away
 * from the prompt — is what makes it testable: the same rows always
 * produce the same six to twelve lines, so a prompt does not change
 * shape between two turns of the same conversation.
 */
import { copy } from "./copy";
import { filterHarm, type HarmReport } from "./harm";
import { isSafeSeedLine } from "./seed-safety";
import { zonedDateKey } from "./timezone";
import type { Locale } from "./copy";

/** What a scene remembers about the stretch it was taken from. */
export interface SceneRecordRange {
  /** The persona the stretch belongs to. The scene only works on it. */
  personaId: number;
  /** The first record of the stretch, in the order the reader shows. */
  fromId: number;
  /** The last record of the stretch. */
  toId: number;
  /** The first day of the stretch, as "YYYY-MM-DD". */
  from: string;
  /** The last day of the stretch, as "YYYY-MM-DD". */
  to: string;
}

/** How many lines of the stretch the prompt should carry at least. */
export const SCENE_RANGE_MIN_LINES = 6;
/** And at most. A whole conversation pasted into one prompt stops being a context. */
export const SCENE_RANGE_MAX_LINES = 12;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Reads the stored range, or gives up.
 *
 * The column is jsonb, and the app has been bitten by stored shapes
 * that were not the ones the code assumed. A range that does not have
 * exactly this shape is treated as no range at all: the scene keeps
 * working as an ordinary scene rather than breaking every prompt it is
 * part of.
 */
export function normalizeSceneRecordRange(value: unknown): SceneRecordRange | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!positiveInteger(row.personaId)) return null;
  if (!positiveInteger(row.fromId)) return null;
  if (!positiveInteger(row.toId)) return null;
  const from = typeof row.from === "string" ? row.from.trim() : "";
  const to = typeof row.to === "string" ? row.to.trim() : "";
  if (!DAY.test(from) || !DAY.test(to)) return null;
  return { personaId: row.personaId, fromId: row.fromId, toId: row.toId, from, to };
}

/** One row of the record, as the selector sees it. */
export interface SceneRangeRow {
  id: number;
  role: string;
  speaker?: string | null;
  content: string;
  kind?: string | null;
  timestamp?: Date | string | null;
  createdAt?: Date | string | null;
}

/**
 * The moment a row was said.
 *
 * The same fallback `iterateRecords` orders by: a row with no
 * timestamp counts as first said when it was written down.
 */
export function sceneRangeRowAt(row: SceneRangeRow): Date | null {
  const value = row.timestamp ?? row.createdAt ?? null;
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The order the record is read in: when it was said, then the row id. */
export function compareSceneRangeRows(
  a: { at: Date; id: number },
  b: { at: Date; id: number },
): number {
  return a.at.getTime() - b.at.getTime() || a.id - b.id;
}

/**
 * Picks the lines the prompt will carry out of the stretch.
 *
 * Only text is "原话": a sticker or a call is not a sentence the two of
 * them said. A line that looks like an instruction, a fence, or a harm
 * cue is dropped by `isSafeSeedLine`, and the persona's own harm
 * decision is applied by `filterHarm` — the same two gates the seed
 * turns and the quoted lines go through.
 *
 * When the stretch holds more than `max` usable lines, the pick is
 * spread evenly across the whole stretch — first line, last line, and
 * the ones between at even intervals — so the context is not just the
 * opening of the day. The pick is deterministic: the same records
 * always produce the same lines.
 */
export function selectSceneRangeLines<T extends SceneRangeRow>(
  rows: T[],
  personaData: { harmReport?: HarmReport | null } | null | undefined,
  max: number = SCENE_RANGE_MAX_LINES,
): T[] {
  const usable = rows
    .filter((row) => (row.kind ?? "text") === "text")
    .filter((row) => String(row.content ?? "").trim().length > 0)
    .map((row) => ({
      row,
      at: sceneRangeRowAt(row),
    }))
    .filter((entry): entry is { row: T; at: Date } => entry.at != null)
    .sort((a, b) => compareSceneRangeRows({ at: a.at, id: a.row.id }, { at: b.at, id: b.row.id }))
    .map((entry) => entry.row);

  /**
   * The persona's own decision about harmful lines, then the fence gate.
   *
   * `filterHarm` needs a `content` and a `role`, which every record has.
   * The fence gate is told that harm is a data decision, never a fence
   * rule — the same way the seed turns treat it: when the user chose to
   * keep the record as it was, a line is allowed to be hurtful; it is
   * still never allowed to look like an instruction.
   */
  const decision = (personaData as { harmReport?: { decision?: string } | null } | null | undefined)
    ?.harmReport?.decision;
  const allowHarm = decision === "keep";
  const afterHarm = filterHarm(usable, personaData);
  const safe = afterHarm.filter((row) =>
    isSafeSeedLine(String(row.content ?? ""), { allowHarm }),
  );

  const limit = Math.max(1, Math.floor(max));
  if (safe.length <= limit) return safe;
  if (limit === 1) return [safe[0]!];
  const picked: T[] = [];
  const last = safe.length - 1;
  for (let index = 0; index < limit; index++) {
    const at = Math.round((index * last) / (limit - 1));
    const row = safe[at];
    if (row) picked.push(row);
  }
  return picked;
}

/**
 * The lines as the prompt reads them (the fence and the heading are the
 * caller's — the heading sits inside the same fence).
 *
 * The shape is the quoted-lines shape from C8.10 on purpose: "date, who
 * said it, what they said" is how the record reads everywhere else.
 */
export function renderSceneRangeLines(
  lines: SceneRangeRow[],
  params: {
    locale: Locale;
    timeZone?: string | null;
    /** The persona's name, for lines they said. */
    themName: string;
    /** The user's name, for lines the user said. Empty falls back to "you". */
    meName?: string;
  },
): string {
  const zone = params.timeZone ?? "UTC";
  return lines
    .map((line) => {
      const at = sceneRangeRowAt(line);
      const date = at ? zonedDateKey(at, zone) : "";
      const who =
        line.role === "user"
          ? (params.meName ?? copy(params.locale, "prompt.roleUser"))
          : (line.speaker || params.themName);
      return copy(params.locale, "prompt.quotedRecordsLine", {
        date,
        who,
        content: line.content,
      });
    })
    .join("\n");
}
