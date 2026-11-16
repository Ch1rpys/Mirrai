/**
 * DiscordChatExporter JSON.
 *
 * Checked 2026-11-16 against
 * [JsonMessageWriter.cs](https://github.com/Tyrrrz/DiscordChatExporter/blob/prime/DiscordChatExporter.Core/Exporting/JsonMessageWriter.cs):
 * `messages[]` with ISO `timestamp`, `content`, `author.name`,
 * `attachments[]`, `stickers[]`.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord, RecordKind } from "@shared/records";
import {
  applyTextPlaceholder,
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeXml,
  looksLikeZip,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";
import { asArray, asObject, jsonString, parseJsonDocument } from "./json-fields";

function authorName(record: Record<string, unknown>): string {
  const author = asObject(record.author);
  if (!author) return "";
  const nick = typeof author.nickname === "string" ? author.nickname.trim() : "";
  if (nick) return nick;
  return jsonString(author, ["name", "displayName", "username"]);
}

/** DiscordChatExporter `stickers[]` / `attachments[]` → kind. */
function kindFromDiscord(record: Record<string, unknown>, text: string): { kind: RecordKind; content: string; path?: string } {
  const stickers = asArray(record.stickers);
  const sticker = asObject(stickers[0]);
  if (sticker) {
    const name = typeof sticker.name === "string" ? sticker.name : "";
    return { kind: "sticker", content: name ? `[sticker:${name}]` : "[sticker]" };
  }
  const attachments = asArray(record.attachments);
  const file = asObject(attachments[0]);
  if (file) {
    const name = typeof file.fileName === "string" ? file.fileName : typeof file.url === "string" ? file.url : "";
    const lower = name.toLowerCase();
    const path = name || undefined;
    if (/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(lower)) return { kind: "image", content: "[image]", path };
    if (/\.(mp4|mov|webm)$/i.test(lower)) return { kind: "video", content: "[video]", path };
    if (/\.(mp3|ogg|wav|m4a)$/i.test(lower)) return { kind: "voice", content: "[voice]", path };
    return { kind: "file", content: name ? `[file:${name}]` : "[file]", path };
  }
  return { kind: "text", content: text };
}

export async function parseDiscordJson(text: string, _options: ParseOptions = {}): Promise<ParseResult> {
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
    const speaker = authorName(item);
    const body = typeof item.content === "string" ? item.content : "";
    const { kind, content, path } = kindFromDiscord(item, body.trim());
    if (!speaker || (!content && kind === "text")) {
      skipped += 1;
      warnings.push({ code: "skipped_line", lineNo: i + 1 });
      continue;
    }
    const stamp = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : Number.NaN;
    const row = {
      speaker,
      content,
      timestamp: Number.isNaN(stamp) ? null : new Date(stamp),
      kind,
      lineNo: i + 1,
      sourceId: item.id != null ? String(item.id) : undefined,
      meta: path ? { path } : undefined,
    };
    records.push(kind === "text" ? applyTextPlaceholder(row) : row);
  }
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectDiscordJson(source: ImportSource): DetectResult | null {
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
    if (!record) continue;
    if (asObject(record.author) && typeof record.timestamp === "string") hits += 1;
  }
  const confidence = hits / items.length;
  if (confidence < 0.3) return null;
  return { id: "discord-json", confidence };
}

export const discordJsonImporter: Importer = {
  id: "discord-json",
  label: {
    zh: copy("zh", "import.format.discordJson"),
    en: copy("en", "import.format.discordJson"),
  },
  source: "discord",
  detect: detectDiscordJson,
  parse(source, options) {
    return parseDiscordJson(source.text, options);
  },
};
