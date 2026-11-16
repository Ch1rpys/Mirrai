/**
 * Any delimiter-separated table whose columns the user names.
 *
 * Comma, tab, and semicolon, with RFC 4180 quotes. When the wizard has
 * not sent a map yet, headers named time/speaker/content (and the usual
 * aliases) are guessed so a well-labelled file can still parse.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
import { detectDelimiter, headerIndex, parseCsv } from "../csv";
import {
  cappedWarnings,
  collectSpeakers,
  looksLikeJson,
  looksLikeMht,
  looksLikeSqlite,
  looksLikeXml,
  looksLikeZip,
  parseExportTime,
  yieldToEventLoop,
} from "../normalize";
import type { ColumnMap, DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";

function guessMap(headers: string[]): ColumnMap | null {
  const time = headerIndex(headers, ["time", "timestamp", "date", "datetime", "strtime", "created_at"]);
  const speaker = headerIndex(headers, ["speaker", "sender", "name", "user", "nickname", "from"]);
  const content = headerIndex(headers, ["content", "message", "body", "text", "strcontent"]);
  const fromMe = headerIndex(headers, ["fromme", "is_sender", "issender", "sent"]);
  if (content < 0) return null;
  return {
    content,
    time: time >= 0 ? time : undefined,
    speaker: speaker >= 0 ? speaker : undefined,
    fromMe: fromMe >= 0 ? fromMe : undefined,
    fromMeTrue: fromMe >= 0 ? "1" : undefined,
  };
}

function looksLikeWechat(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  return lower.includes("issender") && lower.some((h) => h.includes("strcontent"));
}

export async function parseColumnMap(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const { headers, rows } = parseCsv(text);
  const map = options.columnMap ?? guessMap(headers);
  if (!map) {
    return {
      records: [],
      speakers: [],
      warnings: [{ code: "needs_column_map" }],
      skipped: rows.length,
    };
  }
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const row = rows[i]!;
    const content = (row[map.content] ?? "").trim();
    const speaker = (map.speaker != null ? row[map.speaker] : "")?.trim() || "unknown";
    if (!content) {
      skipped += 1;
      continue;
    }
    const fromMeRaw = map.fromMe != null ? (row[map.fromMe] ?? "").trim() : "";
    const fromMe =
      map.fromMe == null
        ? undefined
        : fromMeRaw === (map.fromMeTrue ?? "1") || fromMeRaw.toLowerCase() === "true";
    records.push({
      speaker,
      fromMe,
      content,
      timestamp: parseExportTime(map.time != null ? row[map.time] : "", options.timeZone),
      kind: "text",
      lineNo: i + 2,
    });
  }
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectColumnMap(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const first = source.text.split(/\r?\n/).find((line) => line.trim());
  if (!first) return null;
  const delim = detectDelimiter(first);
  if (delim === "," && (first.match(/,/g) ?? []).length < 2) return null;
  const { headers, rows } = parseCsv(source.text.slice(0, 8000), delim);
  if (headers.length < 3 || rows.length === 0) return null;
  if (looksLikeWechat(headers)) return null;
  const guessed = guessMap(headers);
  if (!guessed) return { id: "column-map", confidence: 0.45 };
  return { id: "column-map", confidence: 0.7 };
}

export const columnMapImporter: Importer = {
  id: "column-map",
  label: {
    zh: copy("zh", "import.format.columnMap"),
    en: copy("en", "import.format.columnMap"),
  },
  source: "generic",
  detect: detectColumnMap,
  parse(source, options) {
    return parseColumnMap(source.text, options);
  },
};
