/**
 * The record table's closed set of kinds, roles, and the helpers that
 * turn a stored row into text a person or a model can read.
 *
 * Every real chat line — from an upload, a collector, a screenshot or
 * a spoken account — lands in `collected_messages`. The table name
 * stays; the documents and the interface call it a record.
 */
import { copy } from "./copy";

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

function formatDuration(seconds: number, locale: "zh" | "en"): string {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(copy(locale, "record.duration.hour", { n: h }));
  if (m) parts.push(copy(locale, "record.duration.minute", { n: m }));
  if (s || parts.length === 0) parts.push(copy(locale, "record.duration.second", { n: s }));
  return parts.join(" ");
}

function tokenParts(content: string): { kind: string; parts: string[] } | null {
  const match = content.trim().match(/^\[([a-z]+)(?::([^\]]*))?\]$/i);
  if (!match) return null;
  return {
    kind: match[1].toLowerCase(),
    parts: match[2] ? match[2].split(":") : [],
  };
}

/**
 * Renders a stored token into words a person can read.
 *
 * Non-text rows store a language-independent token in `content`
 * (`[sticker:狗狗探头]`, `[call:voice:2592]`). The interface and the
 * model see the copy() form.
 */
export function renderRecordContent(
  row: RecordContentRow,
  locale: "zh" | "en" = "zh",
): string {
  const kind = row.kind ?? "text";
  if (kind === "text" || kind === "system") return row.content;

  const token = tokenParts(row.content);

  if (kind === "sticker") {
    const label =
      (token?.parts.length ? token.parts.join(":") : "") ||
      (typeof row.meta?.label === "string" ? row.meta.label : "");
    return label
      ? copy(locale, "record.kind.sticker", { label })
      : copy(locale, "record.kind.stickerBare");
  }
  if (kind === "image") return copy(locale, "record.kind.image");
  if (kind === "voice") {
    const sec = Number(token?.parts[0] ?? row.meta?.durationSec);
    return Number.isFinite(sec)
      ? copy(locale, "record.kind.voice", { duration: formatDuration(sec, locale) })
      : copy(locale, "record.kind.voiceBare");
  }
  if (kind === "video") {
    const sec = Number(token?.parts[0] ?? row.meta?.durationSec);
    return Number.isFinite(sec)
      ? copy(locale, "record.kind.video", { duration: formatDuration(sec, locale) })
      : copy(locale, "record.kind.videoBare");
  }
  if (kind === "location") {
    const name = token?.parts[0] || (typeof row.meta?.name === "string" ? row.meta.name : "");
    return name
      ? copy(locale, "record.kind.location", { name })
      : copy(locale, "record.kind.locationBare");
  }
  if (kind === "link") {
    const title = token?.parts.join(":") || (typeof row.meta?.title === "string" ? row.meta.title : "");
    return title
      ? copy(locale, "record.kind.link", { title })
      : copy(locale, "record.kind.linkBare");
  }
  if (kind === "music") {
    const title = token?.parts.join(":") || (typeof row.meta?.title === "string" ? row.meta.title : "");
    return title
      ? copy(locale, "record.kind.music", { title })
      : copy(locale, "record.kind.musicBare");
  }
  if (kind === "transfer") {
    const amount = token?.parts[0] || (typeof row.meta?.amount === "string" ? row.meta.amount : "");
    return amount
      ? copy(locale, "record.kind.transfer", { amount })
      : copy(locale, "record.kind.transferBare");
  }
  if (kind === "redpacket") return copy(locale, "record.kind.redpacket");
  if (kind === "pat") return copy(locale, "record.kind.pat");
  if (kind === "recall") return copy(locale, "record.kind.recall");
  if (kind === "call") {
    const mode = token?.parts[0] === "video" || row.meta?.mode === "video" ? "video" : "voice";
    const sec = Number(token?.parts[1] ?? row.meta?.durationSec ?? 0);
    const duration = formatDuration(Number.isFinite(sec) ? sec : 0, locale);
    return copy(locale, mode === "video" ? "record.kind.callVideo" : "record.kind.callVoice", {
      duration,
    });
  }
  if (kind === "file") {
    const name = token?.parts.join(":") || (typeof row.meta?.name === "string" ? row.meta.name : "");
    return name
      ? copy(locale, "record.kind.file", { name })
      : copy(locale, "record.kind.fileBare");
  }
  return row.content;
}

/** File types the import wizard turns into records. */
export const CHAT_IMPORT_FILE_TYPES = [
  "chat_txt",
  "chat_csv",
  "chat_export",
  "archive",
] as const;

export type ChatImportFileType = (typeof CHAT_IMPORT_FILE_TYPES)[number];

export function isChatImportFileType(value: string): value is ChatImportFileType {
  return (CHAT_IMPORT_FILE_TYPES as readonly string[]).includes(value);
}

/**
 * Whether an uploaded chat file still needs to be turned into records.
 *
 * Empty `parseStatus` is the upgrade case: files stored before the
 * import path existed. A file that already ran (done, failed, or
 * waiting for a role) is not counted again.
 */
export function isUnparsedChatUpload(file: {
  fileType: string;
  parseStatus?: string | null;
}): boolean {
  if (!isChatImportFileType(file.fileType)) return false;
  return file.parseStatus == null || file.parseStatus === "";
}

/**
 * Whether a row is the private one-to-one conversation.
 *
 * Moments, letters and group chats are other registers. The private
 * voice is measured from the private rows only; a public post speaks to
 * everyone and must not quietly change how the persona talks to one
 * person (B7.12).
 */
export function isPrivateRecord(row: { meta?: Record<string, unknown> | null }): boolean {
  return recordRegister(row) !== "public";
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
