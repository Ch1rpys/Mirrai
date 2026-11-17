import { copy } from "@shared/copy";
import type { RecordKind } from "@shared/records";
import { headerIndex, parseCsv } from "../csv";
import {
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeZip,
  parseDurationSeconds,
  parseExportTime,
  parseTextPlaceholder,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";

/**
 * WeChatMsg / PyWxDump CSV. Type/SubType numbers from
 * https://docs.rs/crate/wx-core/latest/source/src/orm_types/MSG.md
 * (checked 2026-11-16).
 */
const TYPE_KIND: Record<number, RecordKind> = {
  1: "text",
  3: "image",
  34: "voice",
  43: "video",
  47: "sticker",
  48: "location",
  50: "call",
  10000: "system",
};

function kindFromType(type: number, subType: number, content: string): RecordKind {
  if (type === 49) {
    if (subType === 6) return "file";
    if (subType === 2000) return "transfer";
    if (subType === 2003) return "redpacket";
    if (content.includes("music") || subType === 3) return "music";
    return "link";
  }
  return TYPE_KIND[type] ?? "text";
}

function tokenFor(
  kind: RecordKind,
  content: string,
  extras?: { mode?: string },
): { content: string; meta?: Record<string, unknown> } {
  if (kind === "text" || kind === "system") {
    const hit = parseTextPlaceholder(content);
    if (hit) return { content: hit.content, meta: hit.meta };
    return { content };
  }
  if (kind === "sticker") {
    const label = content.trim();
    return {
      content: label ? `[sticker:${label}]` : "[sticker]",
      meta: label ? { label } : undefined,
    };
  }
  if (kind === "voice") {
    const sec = content.match(/(\d+)\s*秒/)?.[1];
    const durationSec = sec ? Number(sec) : parseDurationSeconds(content);
    return {
      content: durationSec != null ? `[voice:${durationSec}]` : "[voice]",
      meta: durationSec != null ? { durationSec } : undefined,
    };
  }
  if (kind === "call") {
    const clock = content.match(/(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
    const durationSec = clock ? parseDurationSeconds(clock) ?? 0 : 0;
    const mode = extras?.mode === "video" ? "video" : "voice";
    return {
      content: `[call:${mode}:${durationSec}]`,
      meta: { mode, durationSec },
    };
  }
  if (kind === "video") return { content: "[video]" };
  if (kind === "image") return { content: "[image]" };
  if (kind === "location") {
    return { content: content ? `[location:${content}]` : "[location]", meta: content ? { name: content } : undefined };
  }
  if (kind === "file") return { content: content ? `[file:${content}]` : "[file]" };
  if (kind === "music") return { content: content ? `[music:${content}]` : "[music]" };
  if (kind === "transfer") return { content: content ? `[transfer:${content}]` : "[transfer]" };
  if (kind === "redpacket") return { content: "[redpacket]" };
  if (kind === "link") return { content: content ? `[link:${content}]` : "[link]" };
  if (kind === "pat") return { content: "[pat]" };
  if (kind === "recall") return { content: "[recall]" };
  return { content };
}

export async function parseWechatCsv(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const { headers, rows } = parseCsv(text);
  const iSender = headerIndex(headers, ["IsSender", "is_sender"]);
  const iContent = headerIndex(headers, ["StrContent", "str_content", "content"]);
  const iTime = headerIndex(headers, ["StrTime", "str_time", "CreateTime", "create_time"]);
  const iType = headerIndex(headers, ["Type", "type"]);
  const iSub = headerIndex(headers, ["SubType", "sub_type", "Subtype"]);
  const iName = headerIndex(headers, ["NickName", "nickname", "Sender", "sender", "Remark"]);
  const iStickerKey = headerIndex(headers, ["StickerKey", "stickerKey"]);
  const iTranscript = headerIndex(headers, ["Transcript", "transcript"]);
  const iDirection = headerIndex(headers, ["Direction", "direction"]);
  const iMode = headerIndex(headers, ["Mode", "mode"]);
  const warnings: ParseWarning[] = [];
  const records = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const row = rows[i]!;
    const lineNo = i + 2;
    try {
      const rawContent = iContent >= 0 ? (row[iContent] ?? "").trim() : "";
      const type = iType >= 0 ? Number(row[iType] ?? "1") : 1;
      const subType = iSub >= 0 ? Number(row[iSub] ?? "0") : 0;
      const kind = kindFromType(type, subType, rawContent);
      let content = rawContent;
      if (kind === "system") {
        // i18n:allow-input — WeChat system-message wording in the export.
        if (/拍了拍|pat/.test(content)) {
          records.push({
            speaker: (iName >= 0 ? row[iName] : "") || "system",
            fromMe: iSender >= 0 ? String(row[iSender]).trim() === "1" : undefined,
            content: "[pat]",
            timestamp: parseExportTime(iTime >= 0 ? row[iTime] : "", options.timeZone),
            kind: "pat" as RecordKind,
            lineNo,
          });
          continue;
        }
        if (/撤回|recalled/.test(content)) {
          records.push({
            speaker: (iName >= 0 ? row[iName] : "") || "system",
            fromMe: iSender >= 0 ? String(row[iSender]).trim() === "1" : undefined,
            content: "[recall]",
            timestamp: parseExportTime(iTime >= 0 ? row[iTime] : "", options.timeZone),
            kind: "recall" as RecordKind,
            lineNo,
          });
          continue;
        }
      }
      const mode = iMode >= 0 ? (row[iMode] ?? "").trim() : "";
      const token = tokenFor(kind, rawContent, mode ? { mode } : undefined);
      const meta: Record<string, unknown> = { ...(token.meta ?? {}) };
      const stickerKey = iStickerKey >= 0 ? (row[iStickerKey] ?? "").trim() : "";
      const transcript = iTranscript >= 0 ? (row[iTranscript] ?? "").trim() : "";
      const direction = iDirection >= 0 ? (row[iDirection] ?? "").trim() : "";
      if (kind === "sticker" && stickerKey) meta.stickerKey = stickerKey;
      if (kind === "voice" && transcript) meta.transcript = transcript;
      if (kind === "call" && (direction === "in" || direction === "out" || direction === "missed")) {
        meta.direction = direction;
      }
      if (!token.content) {
        skipped += 1;
        continue;
      }
      const isSender = iSender >= 0 ? String(row[iSender]).trim() === "1" : undefined;
      const speaker = (iName >= 0 ? (row[iName] ?? "").trim() : "") || (isSender ? "me" : "them");
      const resolvedKind =
        kind === "text" || kind === "system"
          ? (parseTextPlaceholder(rawContent)?.kind ?? kind)
          : kind;
      records.push({
        speaker,
        fromMe: isSender,
        content: token.content,
        timestamp: parseExportTime(iTime >= 0 ? row[iTime] : "", options.timeZone),
        kind: resolvedKind,
        lineNo,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
    } catch {
      skipped += 1;
      warnings.push({ code: "skipped_line", lineNo });
    }
  }

  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectWechatCsv(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  const first = source.text.split(/\r?\n/).find((line) => line.trim());
  if (!first) return null;
  const lower = first.toLowerCase();
  const has =
    lower.includes("issender") &&
    (lower.includes("strcontent") || lower.includes("content")) &&
    (lower.includes("strtime") || lower.includes("createtime"));
  if (!has) return null;
  return { id: "wechat-csv", confidence: 1 };
}

export const wechatCsvImporter: Importer = {
  id: "wechat-csv",
  label: {
    zh: copy("zh", "import.format.wechatCsv"),
    en: copy("en", "import.format.wechatCsv"),
  },
  source: "wechat_export",
  detect: detectWechatCsv,
  parse(source, options) {
    return parseWechatCsv(source.text, options);
  },
};
