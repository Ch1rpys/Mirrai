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
import { isTextRecord, recordText, renderRecordContent } from "@shared/records";
import { splitScenes, toTurns } from "@shared/scenes";
import { findPeriodSplits, periodsFromSplits } from "@shared/periods";
import { zonedDateKey, zonedHour, zonedMinute } from "@shared/timezone";
import { seededRandom } from "../_core/behavior-profile";

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
  act?: string | null;
  actSource?: string | null;
  emotion?: string | null;
  emotionSource?: string | null;
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
  /**
   * A voice note is read as its transcript, marked as a voice note.
   *
   * The words are what the distillation is looking for; the marker
   * says they were spoken rather than typed, which is a different
   * thing to know about a line.
   */
  if ((row.kind ?? "text") === "voice") {
    const text = recordText(row).trim();
    if (text && text !== row.content) {
      return copy(locale, "record.kind.voiceWithText", { text });
    }
  }
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

/**
 * Cuts one line that is longer than a whole block.
 *
 * A single message can be longer than `maxChars` — a pasted letter, a
 * long note. It cannot be cut at a turn or even a bubble boundary, so
 * the text is split into consecutive segments that keep the record's
 * own id: a citation still points at the original line, and the whole
 * text is read instead of being dropped or allowed to overflow the
 * block. Only text rows are split; the other kinds render to a short
 * token.
 */
function splitOversizedRow(
  row: RecordLine,
  maxChars: number,
  options: ChunkRecordsOptions,
): RecordLine[] {
  if (!isTextRecord(row) || lineChars(row, options) <= maxChars) return [row];
  const overhead = lineChars({ ...row, content: "" }, options);
  const budget = Math.max(1, maxChars - overhead);
  const content = row.content;
  const parts: RecordLine[] = [];
  for (let start = 0; start < content.length; start += budget) {
    parts.push({ ...row, content: content.slice(start, start + budget) });
  }
  return parts.length > 0 ? parts : [row];
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

  const flush = () => {
    if (current.length === 0) return;
    parts.push(current);
    current = [];
    currentChars = 0;
  };

  const addRow = (row: RecordLine) => {
    for (const segment of splitOversizedRow(row, maxChars, options)) {
      const length = lineChars(segment, options);
      if (current.length > 0 && currentChars + length > maxChars) flush();
      current.push(segment);
      currentChars += length;
      if (currentChars >= maxChars) flush();
    }
  };

  for (const turn of turns) {
    const turnChars = turn.reduce((sum, row) => sum + lineChars(row, options), 0);
    if (turnChars <= maxChars) {
      if (current.length > 0 && currentChars + turnChars > maxChars) flush();
      current.push(...turn);
      currentChars += turnChars;
      continue;
    }
    /**
     * The turn itself is too long. Its bubbles are the next boundary:
     * a burst of long messages can be packed a bubble at a time, and a
     * single bubble that is still too long is split by `addRow`.
     */
    flush();
    for (const row of turn) addRow(row);
  }
  flush();
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
 * How many structured rows the chunked map stage needs (B1.1).
 *
 * Below it the analysis makes one call over the start of the transcript;
 * at or above it the blocks are cut, sampled and mapped. The estimate and
 * the pipeline have to use the same number, or the upload page promises a
 * map stage the run will not make.
 */
export const MIN_RECORDS_FOR_CHUNKED = 200;

/** The seed that makes the same record pick the same blocks again. */
export function distillChunkSeed(personaId: number, chunkCount: number): string {
  return `distill:${personaId}:${chunkCount}`;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function pickUniform(indices: number[], count: number, rng: () => number): number[] {
  const copy = indices.slice();
  const n = Math.min(Math.max(0, count), copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (copy.length - i));
    const swap = copy[i];
    copy[i] = copy[j] ?? swap;
    copy[j] = swap ?? copy[j];
  }
  return copy.slice(0, n);
}

/**
 * Shares `seats` across groups in proportion to their sizes, never
 * more than the group still has, leftover going to the largest remainders.
 */
function allocateProportional(sizes: number[], seats: number): number[] {
  const n = sizes.length;
  const out = Array.from({ length: n }, () => 0);
  if (n === 0 || seats <= 0) return out;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return out;
  const raw = sizes.map((size) => (size / total) * seats);
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(sizes[i] ?? 0, Math.floor(raw[i] ?? 0));
  }
  let used = out.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, i) => ({ i, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  while (used < seats) {
    let progressed = false;
    for (const { i } of order) {
      if (used >= seats) break;
      if ((out[i] ?? 0) < (sizes[i] ?? 0)) {
        out[i] = (out[i] ?? 0) + 1;
        used += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

/**
 * The mood most of their lines in this block are labelled with.
 *
 * A tie is not a mood: the block stays in the unlabelled layer. Their
 * lines are the only ones that count. A block with no labels does not
 * grow an emotion axis, so a log that has not been labelled yet is
 * sampled the way it was before the labels existed.
 */
function dominantEmotion(chunk: RecordChunk): string | null {
  const counts = new Map<string, number>();
  for (const row of chunk.rows) {
    if (row.role !== "assistant") continue;
    const emotion = row.emotion?.trim();
    if (!emotion) continue;
    counts.set(emotion, (counts.get(emotion) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  let ties = 0;
  for (const [emotion, count] of counts) {
    if (count > bestCount) {
      best = emotion;
      bestCount = count;
      ties = 1;
    } else if (count === bestCount) {
      ties += 1;
    }
  }
  if (!best || ties !== 1) return null;
  return best;
}

function layerKey(chunk: RecordChunk, sceneCount: number, median: number): string {
  const density = sceneCount > median ? "dense" : "sparse";
  const base = `${chunk.periodId ?? ""}|${chunk.dayPart}|${density}`;
  const emotion = dominantEmotion(chunk);
  return emotion ? `${base}|${emotion}` : base;
}

function byTimeThenIndex(chunks: RecordChunk[], a: number, b: number): number {
  const left = chunks[a]?.from?.getTime() ?? 0;
  const right = chunks[b]?.from?.getTime() ?? 0;
  if (left !== right) return left - right;
  return a - b;
}

/**
 * Picks which blocks a budgeted run will actually read.
 *
 * The first block and the last three are kept so a short sample still
 * covers the start and the present. The rest of the seats are spread
 * across period × day/night × how busy the scene was, and, once their
 * lines carry a mood, that mood as well. A fast run does not collapse
 * onto one stretch or one mood. Blocks with no mood label stay on the
 * three-way key, so an unlabelled log is sampled as before.
 */
export function selectChunks(
  chunks: RecordChunk[],
  budget: number | "all",
  seed: string,
): RecordChunk[] {
  if (chunks.length === 0) return [];
  if (budget === "all" || (typeof budget === "number" && budget >= chunks.length)) {
    return chunks;
  }
  const n = Math.max(0, Math.floor(budget));
  if (n === 0) return [];

  const selected = new Set<number>();
  if (chunks.length > 0) selected.add(0);
  for (let i = chunks.length - 1; i >= 0 && selected.size < Math.min(n, 4); i--) {
    selected.add(i);
  }
  if (selected.size > n) {
    const preferred = [0, chunks.length - 1, chunks.length - 2, chunks.length - 3]
      .filter((index) => index >= 0);
    selected.clear();
    for (const index of preferred) {
      if (selected.size >= n) break;
      selected.add(index);
    }
  }

  const sceneCounts = chunks.map((chunk) => splitScenes(chunk.rows).length);
  const median = medianOf(sceneCounts);
  const layers = new Map<string, number[]>();
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const key = layerKey(chunk, sceneCounts[i] ?? 0, median);
    const list = layers.get(key) ?? [];
    list.push(i);
    layers.set(key, list);
  }
  const layerKeys = [...layers.keys()].sort();
  const rng = seededRandom(seed);

  for (const key of layerKeys) {
    if (selected.size >= n) break;
    const indices = layers.get(key) ?? [];
    if (indices.some((index) => selected.has(index))) continue;
    const [pick] = pickUniform(indices, 1, rng);
    if (pick !== undefined) selected.add(pick);
  }

  const leftover = n - selected.size;
  if (leftover > 0) {
    const remaining = layerKeys
      .map((key) => ({
        key,
        indices: (layers.get(key) ?? []).filter((index) => !selected.has(index)),
      }))
      .filter((layer) => layer.indices.length > 0);
    const quotas = allocateProportional(
      remaining.map((layer) => layer.indices.length),
      leftover,
    );
    for (let i = 0; i < remaining.length; i++) {
      const layer = remaining[i];
      const quota = quotas[i] ?? 0;
      if (!layer || quota <= 0) continue;
      for (const pick of pickUniform(layer.indices, quota, rng)) selected.add(pick);
    }
  }

  if (selected.size < n) {
    const rest: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!selected.has(i)) rest.push(i);
    }
    for (const pick of pickUniform(rest, n - selected.size, rng)) selected.add(pick);
  }

  return [...selected]
    .sort((a, b) => byTimeThenIndex(chunks, a, b))
    .flatMap((index) => {
      const chunk = chunks[index];
      return chunk ? [chunk] : [];
    });
}

/**
 * Caps the blocks a preset is allowed to read.
 *
 * The draw is the stratified one: newest blocks stay in, and the rest
 * of the seats are spread across the log rather than taken from the start.
 */
export function takeChunkBudget(
  chunks: RecordChunk[],
  budget: number | "all",
  seed?: string,
): RecordChunk[] {
  return selectChunks(chunks, budget, seed ?? distillChunkSeed(0, chunks.length));
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
