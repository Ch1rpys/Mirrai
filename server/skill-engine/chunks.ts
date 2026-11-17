/**
 * Splits a record into blocks the distillation can send to a model.
 *
 * A run used to take the first four, ten or thirty thousand characters
 * of the transcript. A long history's later years were never read. The
 * blocks here cover the whole record, stay inside one period, and are
 * hashed so a later run can skip a block it has already seen.
 */
import { createHash } from "node:crypto";
import { asMaterial } from "./material";
import { copy, type Locale } from "@shared/copy";
import { isTextRecord, renderRecordContent } from "@shared/records";
import { splitScenes, toTurns } from "@shared/scenes";
import { findPeriodSplits, periodsFromSplits } from "@shared/periods";
import { zonedDateKey, zonedHour, zonedMinute } from "@shared/timezone";

export const CHUNK_TARGET_CHARS = 6000;
export const CHUNK_MAX_CHARS = 9000;

export interface RecordLine {
  id: number;
  role: "user" | "assistant" | "other";
  content: string;
  timestamp: Date | null;
  kind?: string | null;
  speaker?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface RecordChunk {
  index: number;
  /** sha256 of each line's id and content, first 32 hex characters. */
  hash: string;
  from: Date | null;
  to: Date | null;
  periodId: string | null;
  dayPart: "day" | "night";
  chars: number;
  rows: RecordLine[];
}

export interface ChunkRecordsOptions {
  targetChars?: number;
  maxChars?: number;
  timeZone?: string | null;
  locale?: Locale;
  /** The name the user side is shown as in a block. Defaults to "我" / "me". */
  meName?: string;
  /** The name their side is shown as. Defaults to the word for them. */
  themName?: string;
}

interface ScenePack {
  rows: RecordLine[];
  periodId: string | null;
  chars: number;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function lineBody(row: RecordLine, locale: Locale): string {
  if (isTextRecord(row)) return row.content;
  return renderRecordContent(row, locale);
}

/**
 * One line as the model sees it: `#<id> <MM-DD HH:mm> <name>：<content>`.
 *
 * The character count that packs blocks uses this form, because that is
 * the length of what is actually sent.
 */
export function formatChunkLine(
  row: RecordLine,
  options: { locale?: Locale; timeZone?: string | null; meName?: string; themName?: string } = {},
): string {
  const locale = options.locale ?? "zh";
  const meName = options.meName ?? copy(locale, "distill.speakerMe");
  const themName = options.themName ?? "TA";
  const name = row.role === "user" ? meName : themName;
  const body = lineBody(row, locale);
  const stamp = formatChunkStamp(row.timestamp, options.timeZone);
  return stamp
    ? `#${row.id} ${stamp} ${name}：${body}`
    : `#${row.id} ${name}：${body}`;
}

function formatChunkStamp(
  timestamp: Date | string | null | undefined,
  timeZone?: string | null,
): string | null {
  const date = asDate(timestamp);
  if (!date) return null;
  const day = zonedDateKey(date, timeZone);
  const monthDay = day.slice(5);
  const hour = String(zonedHour(date, timeZone)).padStart(2, "0");
  const minute = String(zonedMinute(date, timeZone)).padStart(2, "0");
  return `${monthDay} ${hour}:${minute}`;
}

function lineChars(
  row: RecordLine,
  options: { locale?: Locale; meName?: string; themName?: string },
): number {
  // Same length as `formatChunkLine`, without constructing a zoned stamp
  // for every row — packing a few thousand lines would otherwise sit in
  // `Intl` for seconds.
  const locale = options.locale ?? "zh";
  const meName = options.meName ?? copy(locale, "distill.speakerMe");
  const themName = options.themName ?? "TA";
  const name = row.role === "user" ? meName : themName;
  const body = lineBody(row, locale);
  const stamp = row.timestamp ? 12 : 0;
  return 1 + String(row.id).length + stamp + 1 + name.length + 1 + body.length;
}

function hashRows(rows: RecordLine[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(String(row.id));
    hash.update("\0");
    hash.update(row.content);
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 32);
}

function spanOf(rows: RecordLine[]): { from: Date | null; to: Date | null } {
  let from: Date | null = null;
  let to: Date | null = null;
  for (const row of rows) {
    const date = asDate(row.timestamp);
    if (!date) continue;
    if (!from || date.getTime() < from.getTime()) from = date;
    if (!to || date.getTime() > to.getTime()) to = date;
  }
  return { from, to };
}

function dayPartOf(
  rows: RecordLine[],
  timeZone?: string | null,
): "day" | "night" {
  let day = 0;
  let night = 0;
  for (const row of rows) {
    const date = asDate(row.timestamp);
    if (!date) continue;
    const hour = zonedHour(date, timeZone);
    if (hour >= 18 || hour < 6) night += 1;
    else day += 1;
  }
  return night > day ? "night" : "day";
}

function periodIdFor(
  timestamp: Date | null,
  periods: Array<{ id: string; from: string; to: string }>,
): string | null {
  if (!timestamp || periods.length === 0) return null;
  const at = timestamp.getTime();
  for (let i = 0; i < periods.length; i++) {
    const start = new Date(periods[i].from).getTime();
    const end = new Date(periods[i].to).getTime();
    const last = i === periods.length - 1;
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    if (last ? at >= start && at <= end : at >= start && at < end) {
      return periods[i].id;
    }
  }
  return periods[periods.length - 1]?.id ?? null;
}

function splitOversizedScene(
  scene: RecordLine[],
  maxChars: number,
  options: ChunkRecordsOptions,
): RecordLine[][] {
  const chars = scene.reduce((sum, row) => sum + lineChars(row, options), 0);
  if (chars <= maxChars) return [scene];
  const turns = toTurns(scene);
  const parts: RecordLine[][] = [];
  let current: RecordLine[] = [];
  let currentChars = 0;
  for (const turn of turns) {
    const turnChars = turn.reduce((sum, row) => sum + lineChars(row, options), 0);
    if (current.length > 0 && currentChars + turnChars > maxChars) {
      parts.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(...turn);
    currentChars += turnChars;
  }
  if (current.length) parts.push(current);
  return parts.length ? parts : [scene];
}

function emitChunk(
  rows: RecordLine[],
  periodId: string | null,
  options: ChunkRecordsOptions,
  index: number,
): RecordChunk {
  const { from, to } = spanOf(rows);
  return {
    index,
    hash: hashRows(rows),
    from,
    to,
    periodId,
    dayPart: dayPartOf(rows, options.timeZone),
    chars: rows.reduce((sum, row) => sum + lineChars(row, options), 0),
    rows,
  };
}

/**
 * Packs a time-ordered record into blocks.
 *
 * Only `user` / `assistant` lines go in. Adjacent scenes fill a block
 * until `targetChars`; a scene longer than `maxChars` is cut at a turn
 * boundary. A block never crosses a period split.
 */
export function chunkRecords(
  rows: RecordLine[],
  options: ChunkRecordsOptions = {},
): RecordChunk[] {
  const targetChars = options.targetChars ?? CHUNK_TARGET_CHARS;
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS;
  const spoken = rows.filter(
    (row) => row.role === "user" || row.role === "assistant",
  );
  if (spoken.length === 0) return [];

  const splits = findPeriodSplits(spoken);
  const periods = periodsFromSplits(spoken, splits);
  const scenes = splitScenes(spoken).flatMap((scene) =>
    splitOversizedScene(scene, maxChars, options).map((rows) => {
      const first = rows.find((row) => asDate(row.timestamp)) ?? rows[0];
      return {
        rows,
        periodId: periodIdFor(asDate(first?.timestamp), periods),
        chars: rows.reduce((sum, row) => sum + lineChars(row, options), 0),
      } satisfies ScenePack;
    }),
  );

  const chunks: RecordChunk[] = [];
  let current: RecordLine[] = [];
  let currentChars = 0;
  let currentPeriod: string | null | undefined;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(
      emitChunk(current, currentPeriod ?? null, options, chunks.length),
    );
    current = [];
    currentChars = 0;
  };

  for (const scene of scenes) {
    if (current.length > 0) {
      if (scene.periodId !== currentPeriod || currentChars + scene.chars > maxChars) {
        flush();
      } else if (currentChars >= targetChars) {
        flush();
      }
    }
    if (current.length === 0) currentPeriod = scene.periodId;
    current.push(...scene.rows);
    currentChars += scene.chars;
    if (currentChars >= targetChars) flush();
  }
  flush();
  return chunks;
}

/**
 * The unfenced text of a block, with a blank line and a date between scenes.
 */
export function renderChunkBody(
  chunk: RecordChunk,
  options: {
    locale?: Locale;
    timeZone?: string | null;
    meName?: string;
    themName?: string;
  } = {},
): string {
  const locale = options.locale ?? "zh";
  const scenes = splitScenes(chunk.rows);
  const parts: string[] = [];
  for (const scene of scenes) {
    if (parts.length > 0) parts.push("");
    const first = scene.find((row) => asDate(row.timestamp));
    const date = asDate(first?.timestamp);
    if (date) parts.push(zonedDateKey(date, options.timeZone));
    for (const row of scene) {
      parts.push(formatChunkLine(row, { ...options, locale }));
    }
  }
  return parts.join("\n");
}

/**
 * Caps the blocks a preset is allowed to read.
 *
 * Which blocks are kept is still "the first N" here. B1.2 replaces
 * that with a stratified draw that always includes the newest ones.
 */
export function takeChunkBudget(
  chunks: RecordChunk[],
  budget: number | "all",
): RecordChunk[] {
  if (budget === "all" || budget >= chunks.length) return chunks;
  return chunks.slice(0, Math.max(0, budget));
}

/** The block as a fenced user message for the model. */
export function renderChunkForModel(
  chunk: RecordChunk,
  options: {
    locale?: Locale;
    timeZone?: string | null;
    meName?: string;
    themName?: string;
  } = {},
): string {
  return asMaterial(renderChunkBody(chunk, options), options.locale ?? "zh");
}
