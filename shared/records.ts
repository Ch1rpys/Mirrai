/**
 * The record table's closed set of kinds, roles, and the helpers that
 * turn a stored row into text a person or a model can read.
 *
 * Every real chat line — from an upload, a collector, a screenshot or
 * a spoken account — lands in `collected_messages`. The table name
 * stays; the documents and the interface call it a record.
 */

export const RECORD_KINDS = [
  "text",
  "sticker",
  "image",
  "voice",
  "video",
  "location",
  "link",
  "music",
  "transfer",
  "redpacket",
  "pat",
  "recall",
  "call",
  "file",
  "system",
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_ROLES = ["user", "assistant", "other"] as const;
export type RecordRole = (typeof RECORD_ROLES)[number];

export const RECORD_REGISTERS = ["private", "public", "written", "group"] as const;
export type RecordRegister = (typeof RECORD_REGISTERS)[number];

/**
 * What an importer produces before the row is written.
 *
 * The writer fills in `role` from the speaker map; the parser itself
 * only knows the name on the line and, when the format says so, whether
 * it came from the user.
 */
export interface ParsedRecord {
  speaker: string;
  /** Set when the format itself can tell (WeChat CSV IsSender, SMS type). */
  fromMe?: boolean;
  content: string;
  timestamp: Date | null;
  kind: RecordKind;
  meta?: Record<string, unknown>;
  sourceId?: string;
  lineNo: number;
}

export interface RecordContentRow {
  kind?: string | null;
  content: string;
  meta?: Record<string, unknown> | null;
}

export function isRecordKind(value: string): value is RecordKind {
  return (RECORD_KINDS as readonly string[]).includes(value);
}

/**
 * Whether a row is ordinary chat text.
 *
 * A row written before the kind column existed has no kind of its
 * own — it is text, the same way a missing register is private.
 */
export function isTextRecord(row: { kind?: string | null }): boolean {
  return (row.kind ?? "text") === "text";
}

/**
 * The words a measurement of *content* should read.
 *
 * Tone (fingerprint, n-grams, exemplars) only looks at `kind === "text"`.
 * Content (facts, people, likes, search) uses this, so a voice note
 * with a transcript still counts.
 */
export function recordText(row: RecordContentRow): string {
  if ((row.kind ?? "text") === "voice") {
    const transcript = row.meta?.transcript;
    if (typeof transcript === "string" && transcript.trim()) return transcript;
  }
  return row.content;
}

/**
 * Renders a stored token into words a person can read.
 *
 * Non-text rows store a language-independent token in `content`
 * (`[sticker:狗狗探头]`, `[call:voice:2592]`). The pretty form, with
 * copy(), arrives in C1.3; until then the token itself is what the
 * interface shows.
 */
export function renderRecordContent(
  row: RecordContentRow,
  _locale: "zh" | "en" = "zh",
): string {
  return row.content;
}

/** The register a stored row belongs to. Missing means private. */
export function recordRegister(
  row: { meta?: Record<string, unknown> | null },
): RecordRegister {
  const value = row.meta?.register;
  if (typeof value === "string" && (RECORD_REGISTERS as readonly string[]).includes(value)) {
    return value as RecordRegister;
  }
  return "private";
}
