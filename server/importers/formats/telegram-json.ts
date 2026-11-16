/**
 * Telegram Desktop JSON export.
 *
 * Checked 2026-11-16 against https://core.telegram.org/import-export
 * (`messages[]` with `date` / `date_unixtime` / `from` / `from_id` / `text`
 * as a string or entity array; full takeout wraps chats in `chats.list`).
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
  parseExportTime,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";
import { asArray, asObject, parseJsonDocument } from "./json-fields";

function telegramText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const obj = asObject(part);
      return obj && typeof obj.text === "string" ? obj.text : "";
    })
    .join("");
}

function messageText(record: Record<string, unknown>): string {
  const direct = telegramText(record.text);
  if (direct) return direct;
  return telegramText(record.text_entities);
}

/** Telegram `media_type` / `action` → kind. Checked against core.telegram.org/import-export. */
const TELEGRAM_MEDIA_KIND: Record<string, RecordKind> = {
  sticker: "sticker",
  voice_message: "voice",
  video_file: "video",
  video_message: "video",
  animation: "video",
  audio_file: "music",
  photo: "image",
};

function kindAndContent(
  record: Record<string, unknown>,
  text: string,
): { kind: RecordKind; content: string; meta?: Record<string, unknown> } {
  const media = typeof record.media_type === "string" ? record.media_type : "";
  const path =
    typeof record.file === "string"
      ? record.file
      : typeof record.photo === "string"
        ? record.photo
        : undefined;
  const duration =
    typeof record.duration_seconds === "number"
      ? record.duration_seconds
      : Number(record.duration_seconds) || undefined;
  const emoji = typeof record.sticker_emoji === "string" ? record.sticker_emoji : "";

  if (record.type === "service" || record.action) {
    if (record.action === "phone_call" || record.action === "group_call") {
      return {
        kind: "call",
        content: `[call:voice:${duration ?? 0}]`,
        meta: { mode: "voice", durationSec: duration ?? 0 },
      };
    }
    return { kind: "system", content: text || String(record.action ?? "system") };
  }
  if (media === "sticker" || TELEGRAM_MEDIA_KIND[media] === "sticker") {
    return {
      kind: "sticker",
      content: emoji ? `[sticker:${emoji}]` : "[sticker]",
      meta: emoji ? { label: emoji } : undefined,
    };
  }
  if (media === "voice_message") {
    return {
      kind: "voice",
      content: duration ? `[voice:${duration}]` : "[voice]",
      meta: duration != null ? { durationSec: duration } : undefined,
    };
  }
  if (media === "video_file" || media === "video_message" || media === "animation") {
    return { kind: "video", content: "[video]" };
  }
  if (media === "audio_file") {
    const title = typeof record.title === "string" ? record.title : "";
    return { kind: "music", content: title ? `[music:${title}]` : "[music]", meta: title ? { title } : undefined };
  }
  if (record.photo || media === "photo") {
    return { kind: "image", content: "[image]" };
  }
  if (record.location_information || record.place_name) {
    const place = typeof record.place_name === "string" ? record.place_name : text;
    return {
      kind: "location",
      content: place ? `[location:${place}]` : "[location]",
      meta: place ? { name: place } : undefined,
    };
  }
  if (path && !text) {
    return { kind: "file", content: `[file:${path}]`, meta: { name: path } };
  }
  return { kind: "text", content: text };
}

interface TelegramChat {
  id: string;
  title: string;
  messages: unknown[];
}

function chatsFrom(data: unknown): TelegramChat[] {
  const root = asObject(data);
  if (!root) return [];
  const wrapped = asObject(root.chats);
  const list = wrapped ? asArray(wrapped.list) : [];
  if (list.length > 0) {
    return list.flatMap((entry, index) => {
      const chat = asObject(entry);
      if (!chat) return [];
      const id = chat.id != null ? String(chat.id) : String(index);
      const title = typeof chat.name === "string" && chat.name.trim() ? chat.name.trim() : id;
      return [{ id, title, messages: asArray(chat.messages) }];
    });
  }
  const messages = asArray(root.messages);
  if (messages.length === 0) return [];
  const title = typeof root.name === "string" && root.name.trim() ? root.name.trim() : "chat";
  const id = root.id != null ? String(root.id) : "chat";
  return [{ id, title, messages }];
}

function looksLikeTelegramMessage(record: Record<string, unknown>): boolean {
  return "from_id" in record || "date_unixtime" in record || "text_entities" in record;
}

export async function parseTelegramJson(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let data: unknown;
  try {
    data = parseJsonDocument(text);
  } catch {
    return { records: [], speakers: [], warnings: [{ code: "invalid_json" }], skipped: 1 };
  }
  const chats = chatsFrom(data);
  const selected = options.chatId ? chats.filter((chat) => chat.id === options.chatId) : chats;
  const records: ParsedRecord[] = [];
  let lineNo = 0;
  for (const chat of selected) {
    for (let i = 0; i < chat.messages.length; i++) {
      lineNo += 1;
      if (lineNo % 2000 === 0) await yieldToEventLoop();
      const item = asObject(chat.messages[i]);
      if (!item) {
        skipped += 1;
        continue;
      }
      const speaker =
        (typeof item.from === "string" && item.from.trim()) ||
        (typeof item.actor === "string" && item.actor.trim()) ||
        (typeof item.author === "string" && item.author.trim()) ||
        "system";
      const body = messageText(item);
      const mapped = kindAndContent(item, body.trim());
      if (!mapped.content && mapped.kind === "text") {
        skipped += 1;
        warnings.push({ code: "skipped_line", lineNo });
        continue;
      }
      const timestamp =
        parseExportTime(item.date_unixtime as string | number | undefined, options.timeZone) ??
        parseExportTime(item.date as string | number | undefined, options.timeZone);
      const path =
        typeof item.file === "string" ? item.file : typeof item.photo === "string" ? item.photo : undefined;
      const row = {
        speaker,
        content: mapped.content,
        timestamp,
        kind: mapped.kind,
        lineNo,
        sourceId: item.id != null ? String(item.id) : undefined,
        meta: { ...mapped.meta, ...(path ? { path } : {}) },
      };
      records.push(mapped.kind === "text" ? applyTextPlaceholder(row) : row);
    }
  }
  return {
    records,
    speakers: collectSpeakers(records),
    chats: chats.length > 1 ? chats.map((chat) => ({ id: chat.id, title: chat.title, count: chat.messages.length })) : undefined,
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectTelegramJson(source: ImportSource): DetectResult | null {
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
  const chats = chatsFrom(data);
  const items = chats.flatMap((chat) => chat.messages).slice(0, 30);
  if (items.length === 0) return null;
  let hits = 0;
  for (const item of items) {
    const record = asObject(item);
    if (record && looksLikeTelegramMessage(record)) hits += 1;
  }
  const confidence = hits / items.length;
  if (confidence < 0.3) return null;
  return { id: "telegram-json", confidence };
}

export const telegramJsonImporter: Importer = {
  id: "telegram-json",
  label: {
    zh: copy("zh", "import.format.telegramJson"),
    en: copy("en", "import.format.telegramJson"),
  },
  source: "telegram",
  detect: detectTelegramJson,
  parse(source, options) {
    return parseTelegramJson(source.text, options);
  },
};
