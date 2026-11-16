import { copy } from "@shared/copy";
import type { RecordKind } from "@shared/records";
import { headerIndex, parseCsv } from "../csv";
import {
  cappedWarnings,
  collectSpeakers,
  looksLikeSqlite,
  looksLikeZip,
  parseExportTime,
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

function tokenFor(kind: RecordKind, content: string): string {
  if (kind === "text" || kind === "system") return content;
  if (kind === "sticker") return content ? `[sticker:${content}]` : "[sticker]";
  if (kind === "voice") return "[voice]";
  if (kind === "video") return "[video]";
  if (kind === "image") return "[image]";
  if (kind === "location") return content ? `[location:${content}]` : "[location]";
  if (kind === "file") return content ? `[file:${content}]` : "[file]";
  if (kind === "music") return content ? `[music:${content}]` : "[music]";
  if (kind === "transfer") return content ? `[transfer:${content}]` : "[transfer]";
  if (kind === "redpacket") return "[redpacket]";
  if (kind === "call") return "[call:voice:0]";
  if (kind === "link") return content ? `[link:${content}]` : "[link]";
  if (kind === "pat") return "[pat]";
  if (kind === "recall") return "[recall]";
  return content;
}

export async function parseWechatCsv(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const { headers, rows } = parseCsv(text);
  const iSender = headerIndex(headers, ["IsSender", "is_sender"]);
  const iContent = headerIndex(headers, ["StrContent", "str_content", "content"]);
  const iTime = headerIndex(headers, ["StrTime", "str_time", "CreateTime", "create_time"]);
  const iType = headerIndex(headers, ["Type", "type"]);
  const iSub = headerIndex(headers, ["SubType", "sub_type", "Subtype"]);
  const iName = headerIndex(headers, ["NickName", "nickname", "Sender", "sender", "Remark"]);
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
      content = tokenFor(kind, rawContent);
      if (!content) {
        skipped += 1;
        continue;
      }
      const isSender = iSender >= 0 ? String(row[iSender]).trim() === "1" : undefined;
      const speaker = (iName >= 0 ? (row[iName] ?? "").trim() : "") || (isSender ? "me" : "them");
      records.push({
        speaker,
        fromMe: isSender,
        content,
        timestamp: parseExportTime(iTime >= 0 ? row[iTime] : "", options.timeZone),
        kind,
        lineNo,
        meta: { type, subType },
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
