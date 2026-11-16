/**
 * LINE "Export chat history" TXT.
 *
 * Checked 2026-11-16 against LINE Help Center
 * (https://help.line.me/line/smartphone/?contentId=20007388)
 * and recorded file shapes
 * ([littlefish0331/LINE_record2datatable](https://github.com/littlefish0331/LINE_record2datatable)):
 * a date heading, then `HH:mm<TAB>name<TAB>content`. Japanese exports
 * put 上午/下午 in the time field. Quoted bodies may span lines.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
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

const MSG = /^((?:上午|下午)?\d{1,2}:\d{2})\t([^\t]+)\t(.*)$/;

export function isLineHeader(line: string): boolean {
  return MSG.test(line.replace(/\r$/, ""));
}

function parseDateLine(line: string): string | null {
  const trimmed = line.trim();
  const ymd = trimmed.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const mdy = trimmed.match(/^[A-Za-z]{3},?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return null;
}

/** i18n:allow-input — LINE export banner and save-date labels, not shown. */
function isPreamble(line: string): boolean {
  return (
    line.startsWith("[LINE]") ||
    line.startsWith("Saved on:") ||
    line.startsWith("儲存日期") ||
    line.startsWith("保存日時")
  );
}

export async function parseLineTxt(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let day: string | null = null;
  let current: ParsedRecord | null = null;
  let inQuote = false;

  const flush = () => {
    if (!current) return;
    let content = current.content;
    if (content.startsWith('"') && content.endsWith('"') && content.length >= 2) {
      content = content.slice(1, -1);
    }
    current.content = content;
    if (current.content) records.push(current);
    else skipped += 1;
    current = null;
    inQuote = false;
  };

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const lineNo = i + 1;
    const raw = lines[i];
    if (inQuote && current) {
      current.content += `\n${raw}`;
      if (raw.endsWith('"')) flush();
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isPreamble(trimmed)) {
      skipped += 1;
      continue;
    }
    const nextDay = parseDateLine(trimmed);
    if (nextDay && !MSG.test(raw)) {
      flush();
      day = nextDay;
      skipped += 1;
      continue;
    }
    const match = MSG.exec(raw);
    if (match) {
      flush();
      const content = match[3];
      current = {
        speaker: match[2].trim(),
        content,
        timestamp: parseExportTime(day ? `${day} ${match[1]}` : match[1], options.timeZone),
        kind: "text",
        lineNo,
      };
      if (content.startsWith('"') && !content.endsWith('"')) {
        inQuote = true;
      } else {
        flush();
      }
      continue;
    }
    if (current) {
      current.content += `\n${raw}`;
      continue;
    }
    skipped += 1;
    warnings.push({ code: "skipped_line", lineNo, detail: trimmed.slice(0, 80) });
  }
  flush();

  return {
    records,
    speakers: collectSpeakers(records),
    warnings: cappedWarnings(warnings),
    skipped,
  };
}

function detectLineTxt(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const head = source.text.slice(0, 400);
  const confidence = headerRatio(source.text, isLineHeader);
  if (confidence < 0.3 && !head.startsWith("[LINE]")) return null;
  if (confidence < 0.3) return null;
  return { id: "line-txt", confidence: Math.max(confidence, head.includes("[LINE]") ? 0.85 : confidence) };
}

export const lineTxtImporter: Importer = {
  id: "line-txt",
  label: {
    zh: copy("zh", "import.format.lineTxt"),
    en: copy("en", "import.format.lineTxt"),
  },
  source: "line",
  detect: detectLineTxt,
  parse(source, options) {
    return parseLineTxt(source.text, options);
  },
};
