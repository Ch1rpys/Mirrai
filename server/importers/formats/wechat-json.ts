import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
import {
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeXml,
  looksLikeZip,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";
import { jsonString, jsonTime, messageList, parseJsonDocument } from "./json-fields";

const SENDER_KEYS = ["sender", "sender_name", "from", "user_name", "author", "name", "NickName", "nickname"];
const CONTENT_KEYS = ["content", "text", "message", "body", "content_text", "StrContent"];
const TIME_KEYS = ["timestamp", "create_time", "time", "ts", "date", "StrTime", "str_time", "CreateTime"];

export async function parseWechatJson(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let data: unknown;
  try {
    data = parseJsonDocument(text);
  } catch {
    return { records: [], speakers: [], warnings: [{ code: "invalid_json" }], skipped: 1 };
  }
  const items = messageList(data);
  const records: ParsedRecord[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const item = items[i];
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const content = jsonString(record, CONTENT_KEYS);
    const speaker = jsonString(record, SENDER_KEYS);
    if (!content || !speaker) {
      skipped += 1;
      warnings.push({ code: "skipped_line", lineNo: i + 1 });
      continue;
    }
    const isSender = record.IsSender ?? record.is_sender ?? record.isSender;
    const fromMe =
      isSender === 1 || isSender === "1" || isSender === true
        ? true
        : isSender === 0 || isSender === "0" || isSender === false
          ? false
          : undefined;
    records.push({
      speaker,
      content,
      timestamp: jsonTime(record, TIME_KEYS, options.timeZone),
      kind: "text",
      lineNo: i + 1,
      fromMe,
    });
  }
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectWechatJson(source: ImportSource): DetectResult | null {
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
  const items = messageList(data).slice(0, 30);
  if (items.length === 0) return null;
  // Telegram has from_id / date_unixtime; Discord has author objects;
  // Meta has timestamp_ms. WeChat-shaped rows use sender/content/time.
  let hits = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const hasSender = SENDER_KEYS.some((key) => typeof record[key] === "string");
    const hasContent = CONTENT_KEYS.some((key) => typeof record[key] === "string");
    const hasTime = TIME_KEYS.some((key) => record[key] != null);
    const telegram = "from_id" in record || "date_unixtime" in record;
    const discord = record.author && typeof record.author === "object";
    const meta = "timestamp_ms" in record || "sender_name" in record;
    if (telegram || discord || meta) continue;
    if (hasSender && hasContent && hasTime) hits += 1;
  }
  const confidence = hits / items.length;
  if (confidence < 0.3) return null;
  return { id: "wechat-json", confidence };
}

export const wechatJsonImporter: Importer = {
  id: "wechat-json",
  label: {
    zh: copy("zh", "import.format.wechatJson"),
    en: copy("en", "import.format.wechatJson"),
  },
  source: "wechat_export",
  detect: detectWechatJson,
  parse(source, options) {
    return parseWechatJson(source.text, options);
  },
};
