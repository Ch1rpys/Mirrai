/**
 * KakaoTalk chat export.
 *
 * Checked 2026-11-16 against recorded mobile/PC/Mac shapes
 * ([talkinsight export format](https://talkinsight.kr/guide/export-file-format.html),
 * [TalkCut Mac CSV](https://talkcut.kr/en/use-cases/export-text)):
 * mobile `YYYY. M. D. 오전 H:mm, Name : msg`; PC `[Name] [오전 H:mm]` under a
 * `YYYY년 M월 D일` date rule; Mac CSV `Date,User,Message`.
 */
import { copy } from "@shared/copy";
import type { ParsedRecord, RecordKind } from "@shared/records";
import { headerIndex, parseCsv } from "../csv";
import {
  applyTextPlaceholder,
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

/**
 * KakaoTalk whole-message markers, checked 2026-11-16 against
 * [lalalab export guide](https://lalalab.kr/talk/guide/)
 * (`사진`, `사진 N장`, `동영상`, `음성메시지`, `이모티콘`).
 */
const KAKAO_PLACEHOLDER: Record<string, RecordKind> = {
  "사진": "image",
  "동영상": "video",
  "음성메시지": "voice",
  "이모티콘": "sticker",
};

function parseKakaoPlaceholder(raw: string): {
  kind: RecordKind;
  content: string;
  meta?: Record<string, unknown>;
} | null {
  const text = raw.trim();
  if (/^사진(\s*\d+\s*장)?$/.test(text)) {
    return { kind: "image", content: "[image]" };
  }
  const mapped = KAKAO_PLACEHOLDER[text];
  if (mapped) {
    return { kind: mapped, content: mapped === "sticker" ? "[sticker]" : `[${mapped}]` };
  }
  return null;
}

function applyKakaoPlaceholder(row: ParsedRecord): ParsedRecord {
  const hit = parseKakaoPlaceholder(row.content);
  if (!hit) return applyTextPlaceholder(row);
  return {
    ...row,
    kind: hit.kind,
    content: hit.content,
    meta: hit.meta ? { ...row.meta, ...hit.meta } : row.meta,
  };
}

const MOBILE =
  /^(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후|AM|PM)\s*\d{1,2}:\d{2}(?::\d{2})?),\s*(.+?)\s*:\s*(.*)$/i;
const PC = /^\[([^\]]+)\]\s+\[((?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/i;
const DATE_LINE = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;

export function isKakaoHeader(line: string): boolean {
  const trimmed = line.trim();
  return MOBILE.test(trimmed) || PC.test(trimmed);
}

function kakaoStamp(raw: string): string {
  const match = raw.match(
    /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*((?:오전|오후|AM|PM)\s*)?(\d{1,2}:\d{2}(?::\d{2})?)/i,
  );
  if (!match) return raw;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4] ?? ""}${match[5]}`;
}

/** i18n:allow-input — Kakao CSV header names in the export, not shown. */
function looksLikeKakaoCsv(headers: string[]): boolean {
  const time = headerIndex(headers, ["Date", "date", "날짜", "일시"]);
  const speaker = headerIndex(headers, ["User", "user", "Name", "name", "사용자", "보낸사람"]);
  const content = headerIndex(headers, ["Message", "message", "본문", "내용", "메시지"]);
  return time >= 0 && speaker >= 0 && content >= 0 && headerIndex(headers, ["IsSender", "StrContent"]) < 0;
}

/** i18n:allow-input — Kakao CSV header names in the export, not shown. */
async function parseKakaoCsv(text: string, options: ParseOptions): Promise<ParseResult> {
  const { headers, rows } = parseCsv(text);
  const iTime = headerIndex(headers, ["Date", "date", "날짜", "일시"]);
  const iSpeaker = headerIndex(headers, ["User", "user", "Name", "name", "사용자", "보낸사람"]);
  const iContent = headerIndex(headers, ["Message", "message", "본문", "내용", "메시지"]);
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const row = rows[i]!;
    const speaker = (row[iSpeaker] ?? "").trim();
    const content = (row[iContent] ?? "").trim();
    if (!speaker || !content) {
      skipped += 1;
      continue;
    }
    records.push(
      applyKakaoPlaceholder({
        speaker,
        content,
        timestamp: parseExportTime(row[iTime], options.timeZone),
        kind: "text",
        lineNo: i + 2,
      }),
    );
  }
  return { records, speakers: collectSpeakers(records), warnings: cappedWarnings(warnings), skipped };
}

export async function parseKakaoTxt(text: string, options: ParseOptions = {}): Promise<ParseResult> {
  const { headers } = parseCsv(text.split(/\r?\n/, 1)[0] ?? "");
  if (looksLikeKakaoCsv(headers) && text.includes(",")) {
    return parseKakaoCsv(text, options);
  }

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const records: ParsedRecord[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let day: string | null = null;
  let current: ParsedRecord | null = null;

  const flush = () => {
    if (!current) return;
    current.content = current.content.replace(/\s+$/, "");
    if (current.content) records.push(applyKakaoPlaceholder(current));
    else skipped += 1;
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (current && current.content) flush();
      continue;
    }
    const date = DATE_LINE.exec(trimmed);
    if (date && !MOBILE.test(trimmed) && !PC.test(trimmed)) {
      flush();
      day = `${date[1]}-${date[2]}-${date[3]}`;
      skipped += 1;
      continue;
    }
    const mobile = MOBILE.exec(trimmed);
    if (mobile) {
      flush();
      current = {
        speaker: mobile[2].trim(),
        content: mobile[3],
        timestamp: parseExportTime(kakaoStamp(mobile[1]), options.timeZone),
        kind: "text",
        lineNo,
      };
      continue;
    }
    const pc = PC.exec(trimmed);
    if (pc) {
      flush();
      current = {
        speaker: pc[1].trim(),
        content: pc[3],
        timestamp: parseExportTime(day ? `${day} ${pc[2]}` : pc[2], options.timeZone),
        kind: "text",
        lineNo,
      };
      continue;
    }
    if (current) {
      current.content += `\n${lines[i]}`;
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

function detectKakaoTxt(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const firstLine = source.text.split(/\r?\n/, 1)[0] ?? "";
  const { headers } = parseCsv(firstLine);
  if (looksLikeKakaoCsv(headers)) {
    return { id: "kakao-txt", confidence: 0.8 };
  }
  const confidence = headerRatio(source.text, isKakaoHeader);
  if (confidence < 0.3) return null;
  return { id: "kakao-txt", confidence };
}

export const kakaoTxtImporter: Importer = {
  id: "kakao-txt",
  label: {
    zh: copy("zh", "import.format.kakaoTxt"),
    en: copy("en", "import.format.kakaoTxt"),
  },
  source: "kakao",
  detect: detectKakaoTxt,
  parse(source, options) {
    return parseKakaoTxt(source.text, options);
  },
};
