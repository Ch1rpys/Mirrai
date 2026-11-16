/**
 * Shared reading of export bytes: encoding, clocks, and the small
 * predicates the detectors share.
 *
 * Importers stay pure. They take bytes (or the decoded text) and return
 * records. Time is a wall clock in the user's zone, via `parseZoneless`.
 */
import { parseZoneless } from "@shared/timezone";
import type { ParsedRecord } from "@shared/records";
import type { ImportSource, ParseResult, ParseWarning } from "./types";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

export function yieldToEventLoop(): Promise<void> {
  return new Promise(setImmediate);
}

export function cleanText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(ZERO_WIDTH, "")
    .replace(/\u202F|\u00A0/g, " ");
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function applyMeridiem(hour: number, mer: "am" | "pm"): number {
  if (mer === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function meridiemOf(text: string): "am" | "pm" | null {
  // i18n:allow-input — clock words in an export file, not shown.
  if (/(下午|午後|오후|\bPM\b)/i.test(text)) return "pm";
  if (/(上午|午前|오전|\bAM\b)/i.test(text)) return "am";
  return null;
}

export function parseUnixTime(value: number): Date | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e11 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone?: string | null,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  return parseZoneless(
    `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
    timeZone,
  );
}

/**
 * Reads a timestamp as it appears in an export file.
 *
 * Telegram's `date_unixtime` and SMS `date` are numbers; everything
 * else is a wall clock (with or without a zone) and is read in the
 * user's zone.
 */
export function parseExportTime(
  raw: string | number | null | undefined,
  timeZone?: string | null,
  dateOrder: "ymd" | "mdy" | "dmy" = "ymd",
): Date | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return parseUnixTime(raw);

  const original = cleanText(String(raw)).trim();
  if (!original) return null;
  if (/^\d+(\.\d+)?$/.test(original)) return parseUnixTime(Number(original));

  if (/^\d{4}-\d{2}-\d{2}T/.test(original)) {
    const parsed = Date.parse(original);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  const mer = meridiemOf(original);
  // i18n:allow-input — date particles and 12-hour words in an export.
  let text = original
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, " ")
    .replace(/(上午|下午|午前|午後|오전|오후|\bAM\b|\bPM\b)/gi, " ")
    .replace(/[./]/g, "-")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim();

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let hour = 0;
  let minute = 0;
  let second = 0;

  let match = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4] ?? "0");
    minute = Number(match[5] ?? "0");
    second = Number(match[6] ?? "0");
  } else {
    match = text.match(
      /^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) return null;
    const first = Number(match[1]);
    const secondPart = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    hour = Number(match[4] ?? "0");
    minute = Number(match[5] ?? "0");
    second = Number(match[6] ?? "0");
    if (first > 12 && secondPart <= 12) {
      day = first;
      month = secondPart;
    } else if (secondPart > 12 && first <= 12) {
      month = first;
      day = secondPart;
    } else if (dateOrder === "mdy") {
      month = first;
      day = secondPart;
    } else {
      day = first;
      month = secondPart;
    }
  }

  if (mer) hour = applyMeridiem(hour, mer);
  if (year == null || month == null || day == null) return null;
  return wallClock(year, month, day, hour, minute, second, timeZone);
}

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC[i]) return false;
  }
  return true;
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return true;
  if (!trimmed.startsWith("[")) return false;
  // A generic-line or WhatsApp iOS file also starts with `[`, so only
  // treat it as JSON when the next token is a value, not a date.
  const inner = trimmed.slice(1).trimStart();
  return inner.startsWith("{") || inner.startsWith("[") || inner.startsWith("]") || inner.startsWith("\"");
}

export function looksLikeXml(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<sms") ||
    trimmed.startsWith("<mms") ||
    trimmed.startsWith("<calls")
  );
}

export function looksLikeMht(text: string): boolean {
  const head = text.slice(0, 800);
  return /MIME-Version\s*:/i.test(head) || /^From:\s*<Saved by/im.test(head);
}

/**
 * UTF-8 first (BOM or not). If that cannot be decoded, UTF-16LE, then
 * GB18030. The collectors already had this order in Python; this is
 * the same rule for a file the user uploaded.
 */
export function decodeImportBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // UTF-16LE without a BOM is only tried when the file looks like it:
    // even length, and a lot of NUL bytes. Arbitrary GB18030 would
    // otherwise decode as a pair of BMP characters and look like success.
    const even = bytes.length % 2 === 0;
    let nuls = 0;
    if (even) {
      for (let i = 0; i < bytes.length; i += 2) {
        if (bytes[i + 1] === 0) nuls += 1;
      }
    }
    if (even && nuls / (bytes.length / 2) >= 0.3) {
      try {
        return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
      } catch {
        // Fall through to GB18030.
      }
    }
    return new TextDecoder("gb18030").decode(bytes);
  }
}

export function importSourceFrom(fileName: string, bytes: Uint8Array, text?: string): ImportSource {
  return {
    fileName,
    bytes,
    text: text != null ? cleanText(text) : cleanText(decodeImportBytes(bytes)),
  };
}

export function nonemptyLines(text: string, max = Infinity): string[] {
  const out: string[] = [];
  for (const line of cleanText(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

export function headerRatio(
  text: string,
  isHeader: (line: string) => boolean,
  maxLines = 300,
): number {
  const lines = nonemptyLines(text, maxLines);
  if (lines.length === 0) return 0;
  let hits = 0;
  for (const line of lines) {
    if (isHeader(line)) hits += 1;
  }
  return hits / lines.length;
}

export function collectSpeakers(
  records: ParsedRecord[],
): ParseResult["speakers"] {
  const stats = new Map<string, { name: string; count: number; firstAt?: Date; lastAt?: Date }>();
  for (const row of records) {
    const name = row.speaker.trim();
    if (!name) continue;
    const stat = stats.get(name) ?? { name, count: 0 };
    stat.count += 1;
    if (row.timestamp && (!stat.firstAt || row.timestamp < stat.firstAt)) {
      stat.firstAt = row.timestamp;
    }
    if (row.timestamp && (!stat.lastAt || row.timestamp > stat.lastAt)) {
      stat.lastAt = row.timestamp;
    }
    stats.set(name, stat);
  }
  return [...stats.values()];
}

export function emptyParseResult(extra: Partial<ParseResult> = {}): ParseResult {
  return {
    records: [],
    speakers: [],
    warnings: [],
    skipped: 0,
    ...extra,
  };
}

export function cappedWarnings(warnings: ParseWarning[]): ParseWarning[] {
  return warnings.slice(0, 50);
}
