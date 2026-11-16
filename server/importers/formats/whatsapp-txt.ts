/**
 * WhatsApp "Export chat" TXT.
 *
 * Checked 2026-11-16 against WhatsApp's own iOS/Android export shapes
 * as documented by [Preserve Chat](https://preserve.chat/whatsapp-guides/whatsapp-chat-export-format/)
 * and [starkdmi/whats_json](https://github.com/starkdmi/whats_json):
 * iOS `[date, time] Name: text`, Android `date, time - Name: text`.
 * A line without `Name:` is a system message. Attachments are
 * `<attached: file>` or `file (file attached)`.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord, RecordKind } from "@shared/records";
import {
  cappedWarnings,
  collectSpeakers,
  headerRatio,
  looksLikeJson,
  looksLikeMht,
  looksLikeSqlite,
  looksLikeXml,
  looksLikeZip,
  parseExportTime,
  yieldToEventLoop,
} from "../normalize";
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult, ParseWarning } from "../types";

const MARKS = /[\u200e\u200f\u202a-\u202e]/g;
const CLOCK = "(\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[APap][Mm])?)";
const DATE = "(\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4})";
const IOS = new RegExp(`^\\[${DATE},\\s+${CLOCK}\\]\\s(?:([^:]+): )?(.*)$`);
const ANDROID = new RegExp(`^${DATE},\\s+${CLOCK}\\s+-\\s+(?:([^:]+): )?(.*)$`);

export function isWhatsappHeader(line: string): boolean {
  const trimmed = line.replace(MARKS, "").trim();
  return IOS.test(trimmed) || ANDROID.test(trimmed);
}

function matchHeader(line: string): { date: string; time: string; speaker: string; content: string; system: boolean } | null {
  const trimmed = line.replace(MARKS, "").trim();
  const ios = IOS.exec(trimmed);
  if (ios) {
    const speaker = (ios[3] ?? "").trim();
    return { date: ios[1], time: ios[2], speaker, content: ios[4] ?? "", system: !speaker };
  }
  const android = ANDROID.exec(trimmed);
  if (android) {
    const speaker = (android[3] ?? "").trim();
    return { date: android[1], time: android[2], speaker, content: android[4] ?? "", system: !speaker };
  }
  return null;
}

function inferDateOrder(dates: string[]): "ymd" | "mdy" | "dmy" {
  let ymd = 0;
  let mdy = 0;
  let dmy = 0;
  for (const value of dates) {
    const parts = value.split(/[-/.]/).map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a > 31) ymd += 1;
    else if (a > 12) dmy += 1;
    else if (b > 12) mdy += 1;
  }
  if (ymd >= dmy && ymd >= mdy && ymd > 0) return "ymd";
  if (dmy >= mdy && dmy > 0) return "dmy";
  if (mdy > 0) return "mdy";
  return "dmy";
}

function kindFromAttachment(content: string): { kind: RecordKind; content: string; path?: string } {
  const attached = content.match(/<attached:\s*([^>]+)>/i);
  const fileAttached = content.match(/^(.+?)\s+\(file attached\)\s*$/i);
  const name = (attached?.[1] ?? fileAttached?.[1] ?? "").trim();
  const omitted = /<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted/i.test(
    content,
  );
  if (!name && !omitted) return { kind: "text", content };
  const lower = name.toLowerCase();
  if (/^img[-.]|photo|\.(jpg|jpeg|png|webp|heic|gif)$/i.test(lower) || /image omitted/i.test(content)) {
    return { kind: "image", content: "[image]", path: name || undefined };
  }
  if (/^vid[-.]|\.(mp4|mov|webm)$/i.test(lower) || /video omitted/i.test(content)) {
    return { kind: "video", content: "[video]", path: name || undefined };
  }
  if (/^ptt[-.]|\.(opus|m4a|aac|mp3)$/i.test(lower) || /audio omitted/i.test(content)) {
    return { kind: "voice", content: "[voice]", path: name || undefined };
  }
  if (/sticker|\.webp$/i.test(lower) || /sticker omitted/i.test(content)) {
    return { kind: "sticker", content: "[sticker]", path: name || undefined };
  }
  if (name || /document omitted/i.test(content)) {
    return { kind: "file", content: name ? `[file:${name}]` : "[file]", path: name || undefined };
  }
  return { kind: "image", content: "[image]" };
}

export async function parseWhatsappTxt(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers = lines.map((line) => matchHeader(line)).filter((row) => row != null);
  const order = inferDateOrder(headers.map((row) => row.date));
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let current: ParsedRecord | null = null;

  const flush = () => {
    if (!current) return;
    current.content = current.content.replace(/\s+$/, "");
    if (current.content || current.kind !== "text") records.push(current);
    else skipped += 1;
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const lineNo = i + 1;
    const header = matchHeader(lines[i]);
    if (header) {
      flush();
      const attached = kindFromAttachment(header.content);
      const kind: RecordKind = header.system ? "system" : attached.kind;
      current = {
        speaker: header.speaker || "system",
        content: header.system ? header.content : attached.content,
        timestamp: parseExportTime(`${header.date} ${header.time}`, options.timeZone, order),
        kind,
        lineNo,
        meta: attached.path ? { path: attached.path } : undefined,
      };
      continue;
    }
    if (current) {
      current.content = `${current.content}\n${lines[i]}`.replace(/^\n/, "");
      continue;
    }
    if (!lines[i].trim()) continue;
    skipped += 1;
    warnings.push({ code: "skipped_line", lineNo, detail: lines[i].trim().slice(0, 80) });
  }
  flush();

  return {
    records,
    speakers: collectSpeakers(records.filter((row) => row.kind !== "system")),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectWhatsappTxt(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const confidence = headerRatio(source.text, isWhatsappHeader);
  if (confidence < 0.3) return null;
  return { id: "whatsapp-txt", confidence };
}

export const whatsappTxtImporter: Importer = {
  id: "whatsapp-txt",
  label: {
    zh: copy("zh", "import.format.whatsappTxt"),
    en: copy("en", "import.format.whatsappTxt"),
  },
  source: "whatsapp",
  detect: detectWhatsappTxt,
  parse(source, options) {
    return parseWhatsappTxt(source.text, options);
  },
};
