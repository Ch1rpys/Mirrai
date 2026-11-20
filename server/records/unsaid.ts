/**
 * What they started and never finished (C6.5).
 *
 * The goodbye page is rebuilt from a model, and a model can always
 * produce another sentence. This module does the opposite: it finds the
 * lines the real person actually began and then dropped, and it reads
 * them straight out of the record. No model, no paraphrase.
 *
 * Two kinds count:
 *
 *   - the v5 open loops the user confirmed, when the other person was
 *     the one who said them ("下次带你去吃那家面");
 *   - a line that ends in a brush-off ("算了", "没事", "以后再说"), with
 *     the two lines before it, because the brush-off is an answer to
 *     something.
 *
 * The reconstruction is a separate call (`server/chat/unsaid.ts`), and
 * it is only made when the user asks for one line. Nothing here writes
 * anything.
 */
import * as db from "../db";
import {
  normalizeLifeEvents,
  openLoops,
  type LifeEvent,
} from "@shared/life-events";

/** The fields this reader needs. Kept small so the pure function is testable. */
export interface UnsaidRow {
  id: number;
  role: string;
  kind?: string | null;
  content: string;
  timestamp?: Date | string | null;
}

export interface UnsaidContextLine {
  recordId: number;
  role: string;
  text: string;
  at: string | null;
}

export interface UnfinishedItem {
  kind: "open_loop" | "trailing";
  recordId: number;
  text: string;
  at: string | null;
  /** The two lines before a trailing brush-off, oldest first. */
  context: UnsaidContextLine[];
}

/**
 * The brush-offs (C6.5).
 *
 * These are the ways a sentence gets closed without being finished. The
 * list is matched against the record, so it is input, not interface
 * copy — the same English and Chinese phrases a real export contains.
 */
// i18n:allow-input — matched against the imported record, not shown as app copy
const TRAILING_MARKERS: readonly string[] = [
  "算了",
  "没事",
  "没什么",
  "当我没说",
  "以后再说",
  "下次再说",
  "forget it",
  "never mind",
  "forget i said that",
  "talk later",
  "some other time",
];

const TRAILING_PUNCTUATION = /[\s。！？!?…,，.~～、；;：:]+$/u;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Whether a line ends in a brush-off, ignoring trailing punctuation. */
export function isTrailingLine(content: string): boolean {
  const trimmed = String(content ?? "").trim().replace(TRAILING_PUNCTUATION, "");
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return TRAILING_MARKERS.some((marker) => lower.endsWith(marker));
}

/** The open loops that belong to the other person. */
export function unfinishedOpenLoops(personaData: unknown): LifeEvent[] {
  const data =
    personaData && typeof personaData === "object"
      ? (personaData as { lifeEvents?: unknown })
      : {};
  return openLoops(normalizeLifeEvents(data.lifeEvents)).filter(
    (event) => event.whoSaid === "them",
  );
}

function contextLine(row: UnsaidRow): UnsaidContextLine {
  return {
    recordId: row.id,
    role: row.role,
    text: row.content,
    at: toIso(row.timestamp),
  };
}

function uniqueRows(rows: readonly UnsaidRow[]): UnsaidRow[] {
  const seen = new Set<number>();
  const out: UnsaidRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * Finds the unfinished lines in a list of records.
 *
 * Pure: it is given the rows and the persona's data and returns what it
 * found. The route reads the rows through `iterateRecords`.
 */
export function findUnfinished(
  rows: readonly UnsaidRow[],
  personaData: unknown,
): UnfinishedItem[] {
  const ordered = uniqueRows(rows);
  const out: UnfinishedItem[] = [];
  const seenRecordIds = new Set<number>();

  for (const loop of unfinishedOpenLoops(personaData)) {
    const snippets = loop.evidence
      .map((evidence) => evidence.snippet.trim())
      .filter(Boolean);
    if (!snippets.length) continue;

    const index = ordered.findIndex(
      (row) =>
        row.role === "assistant" &&
        (row.kind ?? "text") === "text" &&
        snippets.some((snippet) => {
          const text = String(row.content ?? "").trim();
          return text.includes(snippet) || snippet.includes(text);
        }),
    );
    if (index < 0) continue;
    const row = ordered[index];
    if (seenRecordIds.has(row.id)) continue;
    seenRecordIds.add(row.id);
    out.push({
      kind: "open_loop",
      recordId: row.id,
      text: row.content,
      at: toIso(row.timestamp),
      context: ordered.slice(Math.max(0, index - 2), index).map(contextLine),
    });
  }

  ordered.forEach((row, index) => {
    if (row.role !== "assistant") return;
    if ((row.kind ?? "text") !== "text") return;
    if (!isTrailingLine(row.content)) return;
    if (seenRecordIds.has(row.id)) return;
    seenRecordIds.add(row.id);
    out.push({
      kind: "trailing",
      recordId: row.id,
      text: row.content,
      at: toIso(row.timestamp),
      context: ordered.slice(Math.max(0, index - 2), index).map(contextLine),
    });
  });

  return out.sort((left, right) => {
    const a = left.at ? Date.parse(left.at) : 0;
    const b = right.at ? Date.parse(right.at) : 0;
    if (a !== b) return a - b;
    return left.recordId - right.recordId;
  });
}

/**
 * Reads the record and returns the unfinished lines.
 *
 * The whole file is paged through, but only the candidate lines and the
 * two lines before each of them are kept — a person with a million
 * records must not have the whole table in memory to open the goodbye
 * page.
 */
export async function findUnfinishedForPersona(params: {
  personaId: number;
  userId: number;
  personaData: unknown;
}): Promise<UnfinishedItem[]> {
  const loops = unfinishedOpenLoops(params.personaData);
  const snippets = loops.flatMap((loop) =>
    loop.evidence.map((evidence) => evidence.snippet.trim()).filter(Boolean),
  );
  const candidates = new Map<number, UnsaidRow>();
  let previous: UnsaidRow[] = [];

  const keep = (row: UnsaidRow) => {
    for (const line of [...previous, row]) {
      if (!candidates.has(line.id)) candidates.set(line.id, line);
    }
  };

  for await (const row of db.iterateRecords(params.personaId, params.userId, {
    kinds: ["text"],
  })) {
    const record: UnsaidRow = {
      id: row.id,
      role: row.role,
      kind: row.kind,
      content: row.content,
      timestamp: row.timestamp,
    };
    const isCandidate =
      record.role === "assistant" &&
      ((record.kind ?? "text") === "text" && isTrailingLine(record.content) ||
        snippets.some((snippet) => String(record.content ?? "").includes(snippet)));
    if (isCandidate) keep(record);
    previous = [...previous.slice(-1), record];
  }

  return findUnfinished([...candidates.values()], params.personaData);
}
