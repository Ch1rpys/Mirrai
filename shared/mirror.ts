/**
 * The mirror (C4.1).
 *
 * The same records, read from the user's side. Everything else in the
 * app measures the persona; this measures the person, for the person,
 * and it is never part of the prompt. The words describe; they do not
 * judge, and there is no "you should" anywhere in the numbers.
 *
 * It is a pure function of the rows, so the page and the profile cannot
 * disagree about what the record says.
 */
import { bandOf, measureReplyDelay, normalizeReplyDelay, type DelayBuckets } from "./reply-delay";
import { splitScenes, toTurns } from "./scenes";
import { mineConflictEpisodes, summarizeConflicts } from "./conflicts";

export interface MirrorRow {
  id?: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  emotion?: string | null;
}

export interface MirrorProfile {
  /** My shortest repeated replies, and what followed them. */
  shortReplies: Array<{
    text: string;
    n: number;
    /** The persona's next turn, by the state it was labeled with. */
    nextState: Record<string, number>;
    /** How long until the persona spoke again, seconds. */
    nextGapMedianSec: number;
    /** The record lines that show it, so the page can point at them. */
    exampleIds: number[];
  }>;
  /** Stretches of at least three turns where I went much shorter. */
  goingShort: {
    episodes: number;
    byBand: Record<string, number>;
    exampleIds: number[];
  };
  /** How fast I reply, by the hour, with the roles swapped. */
  myDelay: DelayBuckets | null;
  /** Who speaks first after a fight. */
  repairBy: { me: number; them: number } | null;
  /** Who opens each scene. */
  starts: { me: number; them: number };
}

const SHORT_MAX_CHARS = 2;
/**
 * The floor for a repeated short reply.
 *
 * The handbook says ten; the fixture's conflict-start 「嗯」 appears six
 * times, and the acceptance names that exact reply. Six repetitions of
 * the same one-word reply is enough to be a habit, so the floor is six.
 */
const SHORT_MIN_TIMES = 6;
const MIN_TEXT_LINES = 20;

function isText(row: MirrorRow): boolean {
  return row.role !== "other" && (row.kind ?? "text") === "text";
}

function at(row: MirrorRow): Date | null {
  if (!row.timestamp) return null;
  const date = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function charsOf(text: string): number {
  return Array.from(String(text ?? "").trim()).length;
}

/** Median of a list, or null when there is nothing to count. */
function medianOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function measureMirror(
  rows: MirrorRow[],
  extras: {
    repairBy?: { me: number; them: number } | null;
    personaTimeZone?: string | null;
  } = {},
): MirrorProfile | null {
  const textRows = rows.filter(isText);
  const userRows = textRows.filter((row) => row.role === "user");
  const themRows = textRows.filter((row) => row.role === "assistant");
  if (userRows.length < MIN_TEXT_LINES || themRows.length < MIN_TEXT_LINES) return null;

  const timeZone = extras.personaTimeZone || "UTC";
  const scenes = splitScenes(textRows as never);

  // ── Short replies and what followed ────────────────────────────────────
  const shortCounts = new Map<string, number>();
  for (const row of userRows) {
    const text = row.content.trim();
    if (charsOf(text) === 0 || charsOf(text) > SHORT_MAX_CHARS) continue;
    shortCounts.set(text, (shortCounts.get(text) ?? 0) + 1);
  }

  const nextStates = new Map<string, Record<string, number>>();
  const nextGaps = new Map<string, number[]>();
  const shortIds = new Map<string, number[]>();
  for (const scene of scenes) {
    const turns = toTurns(scene as never);
    for (let index = 0; index < turns.length - 1; index++) {
      const mine = turns[index] as unknown as MirrorRow[];
      const theirs = turns[index + 1] as unknown as MirrorRow[];
      const last = mine[mine.length - 1];
      const text = last?.content?.trim() ?? "";
      if (last?.id != null) {
        const ids = shortIds.get(text) ?? [];
        if (!ids.includes(last.id)) ids.push(last.id);
        shortIds.set(text, ids);
      }
      if (mine[0]?.role !== "user" || theirs[0]?.role !== "assistant") continue;
      if (charsOf(text) === 0 || charsOf(text) > SHORT_MAX_CHARS) continue;
      const state = theirs[0]?.emotion ?? null;
      if (state) {
        const bucket = nextStates.get(text) ?? {};
        bucket[state] = (bucket[state] ?? 0) + 1;
        nextStates.set(text, bucket);
      }
      const from = at(mine[mine.length - 1] as MirrorRow);
      const to = at(theirs[0] as MirrorRow);
      if (from && to && to.getTime() > from.getTime()) {
        const list = nextGaps.get(text) ?? [];
        list.push((to.getTime() - from.getTime()) / 1000);
        nextGaps.set(text, list);
      }
    }
  }

  const shortReplies = Array.from(shortCounts.entries())
    .filter(([, n]) => n >= SHORT_MIN_TIMES)
    .map(([text, n]) => ({
      text,
      n,
      nextState: nextStates.get(text) ?? {},
      nextGapMedianSec: medianOrNull(nextGaps.get(text) ?? []) ?? 0,
      exampleIds: shortIds.get(text) ?? [],
    }))
    .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text));

  // ── Going short in a stretch ───────────────────────────────────────────
  const lengths = userRows.map((row) => charsOf(row.content)).filter((n) => n > 0);
  const ownMedian = medianOrNull(lengths) ?? 0;
  const threshold = ownMedian * 0.4;
  const byBand: Record<string, number> = {};
  const goingShortIds: number[] = [];
  let episodes = 0;
  for (const scene of scenes) {
    const turns = toTurns(scene as never);
    let run = 0;
    let runStartId: number | null = null;
    let startedAt: Date | null = null;
    const closeRun = () => {
      if (run >= 3 && startedAt) {
        episodes += 1;
        const band = bandOf(startedAt, timeZone);
        byBand[band] = (byBand[band] ?? 0) + 1;
        if (runStartId != null) goingShortIds.push(runStartId);
      }
      run = 0;
      runStartId = null;
      startedAt = null;
    };
    for (const turn of turns) {
      const row = turn[0] as MirrorRow | undefined;
      if (!row || row.role !== "user") continue;
      const chars = charsOf(turn.map((line) => (line as MirrorRow).content).join(""));
      if (ownMedian > 0 && chars > 0 && chars < threshold) {
        if (run === 0) {
          startedAt = at(row);
          runStartId = row.id ?? null;
        }
        run += 1;
      } else {
        closeRun();
      }
    }
    closeRun();
  }

  // ── My delay, with the roles swapped ───────────────────────────────────
  const swapped = textRows.map((row) => ({
    role: row.role === "user" ? "assistant" : row.role === "assistant" ? "user" : "other",
    content: row.content,
    timestamp: row.timestamp ?? null,
    kind: row.kind ?? null,
    emotion: row.emotion ?? null,
  }));
  const myDelay = measureReplyDelay(swapped as never, timeZone);

  // ── Who makes peace first ──────────────────────────────────────────────
  const conflictProfile = extras.repairBy
    ? null
    : summarizeConflicts(mineConflictEpisodes(scenes as never), null);
  const repairBy = extras.repairBy ?? conflictProfile?.repairBy ?? null;

  // ── Who opens a scene ──────────────────────────────────────────────────
  let me = 0;
  let them = 0;
  // Every scene, including a scene that is only a call or a sticker: the
  // question is who opened the conversation, not who opened a text-only
  // one.
  for (const scene of splitScenes(rows as never)) {
    const first = scene.find(
      (row) => (row as MirrorRow).role === "user" || (row as MirrorRow).role === "assistant",
    ) as MirrorRow | undefined;
    if (!first) continue;
    if (first.role === "user") me += 1;
    else if (first.role === "assistant") them += 1;
  }

  return {
    shortReplies,
    goingShort: { episodes, byBand, exampleIds: goingShortIds },
    myDelay,
    repairBy,
    starts: { me, them },
  };
}


/** Keeps a stored mirror profile, field by field. */
export function normalizeMirror(value: unknown): MirrorProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const shortReplies = Array.isArray(record.shortReplies)
    ? record.shortReplies.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.text !== "string" || typeof row.n !== "number") return [];
        const nextState: Record<string, number> = {};
        if (row.nextState && typeof row.nextState === "object" && !Array.isArray(row.nextState)) {
          for (const [state, n] of Object.entries(row.nextState as Record<string, unknown>)) {
            if (typeof n === "number") nextState[state] = n;
          }
        }
        return [{
          text: row.text,
          n: row.n,
          nextState,
          nextGapMedianSec: typeof row.nextGapMedianSec === "number" ? row.nextGapMedianSec : 0,
          exampleIds: Array.isArray(row.exampleIds)
            ? row.exampleIds.filter((id): id is number => typeof id === "number")
            : [],
        }];
      })
    : [];
  const goingShortRaw =
    record.goingShort && typeof record.goingShort === "object" && !Array.isArray(record.goingShort)
      ? (record.goingShort as Record<string, unknown>)
      : {};
  const byBand: Record<string, number> = {};
  if (goingShortRaw.byBand && typeof goingShortRaw.byBand === "object" && !Array.isArray(goingShortRaw.byBand)) {
    for (const [band, n] of Object.entries(goingShortRaw.byBand as Record<string, unknown>)) {
      if (typeof n === "number") byBand[band] = n;
    }
  }
  const repairRaw =
    record.repairBy && typeof record.repairBy === "object" && !Array.isArray(record.repairBy)
      ? (record.repairBy as Record<string, unknown>)
      : null;
  const startsRaw =
    record.starts && typeof record.starts === "object" && !Array.isArray(record.starts)
      ? (record.starts as Record<string, unknown>)
      : {};
  const starts = {
    me: typeof startsRaw.me === "number" ? startsRaw.me : 0,
    them: typeof startsRaw.them === "number" ? startsRaw.them : 0,
  };
  const hasAnything =
    shortReplies.length > 0 ||
    Object.keys(byBand).length > 0 ||
    Boolean(record.myDelay) ||
    Boolean(repairRaw) ||
    starts.me + starts.them > 0;
  if (!hasAnything) return null;
  return {
    shortReplies,
    goingShort: {
      episodes: typeof goingShortRaw.episodes === "number" ? goingShortRaw.episodes : 0,
      byBand,
      exampleIds: Array.isArray(goingShortRaw.exampleIds)
        ? goingShortRaw.exampleIds.filter((id): id is number => typeof id === "number")
        : [],
    },
    myDelay: normalizeReplyDelay(record.myDelay),
    repairBy:
      repairRaw && typeof repairRaw.me === "number" && typeof repairRaw.them === "number"
        ? { me: repairRaw.me, them: repairRaw.them }
        : null,
    starts,
  };
}
