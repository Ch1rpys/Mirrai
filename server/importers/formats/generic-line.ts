import { copy } from "@shared/copy";
import type { ParsedRecord } from "@shared/records";
import {
  applyTextPlaceholder,
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
import type { DetectResult, Importer, ImportSource, ParseOptions, ParseResult } from "../types";

/**
 * A speaker label in front of a message. Same rule as `parseTranscriptMessages`.
 * Non-text bodies use the shared placeholders in `parseTextPlaceholder`.
 */
const SPEAKER = /^([^\s:：/\\]{1,20})\s*[:：]\s*(.*)$/;

function splitTimestamp(line: string): { at?: string; rest: string } {
  const bracket = line.match(/^\[([^\]]{4,32})\]\s*/);
  if (bracket && /\d/.test(bracket[1])) {
    return { at: bracket[1], rest: line.slice(bracket[0].length) };
  }
  const date = line.match(
    /^(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+/,
  );
  if (date) return { at: date[1], rest: line.slice(date[0].length) };
  const clock = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/);
  if (clock) return { at: clock[1], rest: line.slice(clock[0].length) };
  return { rest: line };
}

function hasSpeaker(line: string): boolean {
  const { rest } = splitTimestamp(line);
  const match = rest.match(SPEAKER);
  if (!match || match[2].startsWith("//")) return false;
  // `2022-03-01 20:00:00,小满,在吗` would otherwise take `2022-03-01` or
  // `20` as the speaker because of the colon in the clock.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(match[1])) return false;
  if (/^\d+$/.test(match[1])) return false;
  return true;
}

export function isGenericLineHeader(line: string): boolean {
  const trimmed = line.trim();
  // WhatsApp iOS puts a comma inside the brackets (`[3/1/22, 8:00:00 PM]`).
  const bracket = trimmed.match(/^\[([^\]]{4,32})\]\s*/);
  if (bracket && bracket[1].includes(",")) return false;
  return hasSpeaker(trimmed);
}

/**
 * One line per message: `[time] speaker：content`, `time speaker：content`,
 * or `speaker：content`. A line without a speaker continues the one above.
 */
export async function parseGenericLine(
  text: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const stripped = text.replace(/^\uFEFF/, "");
  const lines = stripped.split(/\r?\n/);
  const records: ParsedRecord[] = [];
  const warnings: ParseResult["warnings"] = [];
  let skipped = 0;

  const hasAnySpeaker = lines.some((line) => line.trim() && hasSpeaker(line.trim()));

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && i % 2000 === 0) await yieldToEventLoop();
    const lineNo = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!hasAnySpeaker) {
      skipped += 1;
      warnings.push({ code: "no_speaker", lineNo, detail: trimmed.slice(0, 80) });
      continue;
    }
    const { at, rest } = splitTimestamp(trimmed);
    const match = rest.match(SPEAKER);
    if (!match || match[2].startsWith("//")) {
      const last = records[records.length - 1];
      if (last) {
        last.content = `${last.content} ${rest}`.trim();
      } else {
        skipped += 1;
        warnings.push({ code: "skipped_line", lineNo, detail: trimmed.slice(0, 80) });
      }
      continue;
    }
    const speaker = match[1].trim();
    const content = match[2].trim();
    if (!content) {
      skipped += 1;
      continue;
    }
    records.push({
      speaker,
      content,
      timestamp: parseExportTime(at, options.timeZone),
      kind: "text",
      lineNo,
    });
  }

  const placed = records.map(applyTextPlaceholder);
  return {
    records: placed,
    speakers: collectSpeakers(placed),
    warnings: warnings.slice(0, 50),
    skipped,
  };
}

function detectGenericLine(source: ImportSource): DetectResult | null {
  if (looksLikeSqlite(source.bytes) || looksLikeZip(source.bytes)) return null;
  if (looksLikeJson(source.text) || looksLikeXml(source.text) || looksLikeMht(source.text)) {
    return null;
  }
  const confidence = headerRatio(source.text, isGenericLineHeader);
  if (confidence < 0.3) return null;
  return { id: "generic-line", confidence };
}

export const genericLineImporter: Importer = {
  id: "generic-line",
  label: {
    zh: copy("zh", "import.format.genericLine"),
    en: copy("en", "import.format.genericLine"),
  },
  source: "generic",
  detect: detectGenericLine,
  parse(source, options) {
    return parseGenericLine(source.text, options);
  },
};
