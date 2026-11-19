/**
 * Instagram / Messenger data-download JSON.
 *
 * Checked 2026-11-16 against Facebook/Instagram takeout threads
 * ([stackoverflow latin1 repair](https://stackoverflow.com/questions/50008296/facebook-json-badly-encoded)):
 * `participants[]`, `messages[]` with `sender_name`, `timestamp_ms`,
 * `content`, `photos`, `audio_files`, `videos`, `share`. Text was stored
 * as UTF-8 bytes misread as latin1; `Buffer.from(s, "latin1").toString("utf8")`
 * restores it. Threads are newest-first.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord, RecordKind } from "@shared/records";
import {
  applyTextPlaceholder,
  cappedWarnings,
  collectSpeakers,
  decodeImportBytes,
  looksLikeSqlite,
  looksLikeXml,
  looksLikeZip,
  parseUnixTime,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";
import { asArray, asObject, parseJsonDocument } from "./json-fields";

/**
 * The JSON as it was decoded, before `cleanText`.
 *
 * A Messenger export stores UTF-8 bytes as latin1 characters. Those
 * characters are U+0080-U+00FF, and two of them — the no-break space
 * (0xA0) and the soft hyphen (0xAD) — are exactly what `cleanText`
 * rewrites or strips. Repairing the mojibake after that cleaning would
 * lose those bytes and leave a name like `阿树` as mojibake. So this
 * importer reads the raw decode, not the cleaned `source.text`.
 */
function rawSourceText(source: ImportSource): string {
  if (source.bytes.length > 0) return decodeImportBytes(source.bytes);
  return source.text;
}

function fixMojibake(value: string): string {
  if (/[一-鿿]/.test(value)) return value;
  if (![...value].some((ch) => ch.charCodeAt(0) > 127 && ch.charCodeAt(0) <= 255)) {
    return value;
  }
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (repaired.includes("\uFFFD")) return value;
    return repaired;
  } catch {
    return value;
  }
}

function firstPath(value: unknown): string | undefined {
  const list = asArray(value);
  const first = asObject(list[0]);
  return first && typeof first.uri === "string" ? first.uri : undefined;
}

/** Instagram / Messenger attachment fields → kind. */
function kindFromMeta(record: Record<string, unknown>, text: string): { kind: RecordKind; content: string; path?: string } {
  const photo = firstPath(record.photos);
  if (photo) return { kind: "image", content: "[image]", path: photo };
  const audio = firstPath(record.audio_files);
  if (audio) return { kind: "voice", content: "[voice]", path: audio };
  const video = firstPath(record.videos);
  if (video) return { kind: "video", content: "[video]", path: video };
  const sticker = asObject(record.sticker);
  if (sticker && typeof sticker.uri === "string") {
    return { kind: "sticker", content: "[sticker]", path: sticker.uri };
  }
  const share = asObject(record.share);
  if (share && typeof share.link === "string") {
    return { kind: "link", content: `[link:${share.link}]` };
  }
  return { kind: "text", content: text };
}

export async function parseMetaJson(text: string, _options: ParseOptions = {}): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let data: unknown;
  try {
    data = parseJsonDocument(text);
  } catch {
    return { records: [], speakers: [], warnings: [{ code: "invalid_json" }], skipped: 1 };
  }
  const root = asObject(data);
  const items = asArray(root?.messages ?? data);
  const records: ParsedRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const item = asObject(items[i]);
    if (!item) {
      skipped += 1;
      continue;
    }
    const speaker = typeof item.sender_name === "string" ? fixMojibake(item.sender_name).trim() : "";
    const body = typeof item.content === "string" ? fixMojibake(item.content) : "";
    const { kind, content, path } = kindFromMeta(item, body.trim());
    if (!speaker || (!content && kind === "text")) {
      skipped += 1;
      warnings.push({ code: "skipped_line", lineNo: i + 1 });
      continue;
    }
    const row = {
      speaker,
      content,
      timestamp: parseUnixTime(Number(item.timestamp_ms)),
      kind,
      lineNo: i + 1,
      meta: path ? { path } : undefined,
    };
    records.push(kind === "text" ? applyTextPlaceholder(row) : row);
  }
  records.sort((a, b) => {
    const at = a.timestamp?.getTime() ?? 0;
    const bt = b.timestamp?.getTime() ?? 0;
    return at - bt;
  });
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectMetaJson(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes) || looksLikeXml(source.text)) {
    return null;
  }
  const trimmed = source.text.trimStart();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  let data: unknown;
  try {
    data = parseJsonDocument(source.text);
  } catch {
    return null;
  }
  const root = asObject(data);
  const items = asArray(root?.messages ?? data).slice(0, 30);
  if (items.length === 0) return null;
  let hits = 0;
  for (const item of items) {
    const record = asObject(item);
    if (record && "sender_name" in record && "timestamp_ms" in record) hits += 1;
  }
  const confidence = hits / items.length;
  if (confidence < 0.3) return null;
  return { id: "meta-json", confidence };
}

export const metaJsonImporter: Importer = {
  id: "meta-json",
  label: {
    zh: copy("zh", "import.format.metaJson"),
    en: copy("en", "import.format.metaJson"),
  },
  source: "meta",
  detect: detectMetaJson,
  parse(source, options) {
    return parseMetaJson(rawSourceText(source), options);
  },
};
