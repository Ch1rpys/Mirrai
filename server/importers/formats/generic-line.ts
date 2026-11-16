import { parseZoneless } from "@shared/timezone";
import type { ParsedRecord } from "@shared/records";
import type { ParseOptions, ParseResult } from "../types";

/** A speaker label in front of a message. Same rule as `parseTranscriptMessages`. */
const SPEAKER = /^([^\s:：/\\]{1,20})\s*[:：]\s*(.*)$/;

// i18n:allow-input — date particles in a chat export's timestamp, not shown.
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
  return !!match && !match[2].startsWith("//");
}

// i18n:allow-input — the same date particles, normalised before parseZoneless.
function readTimestamp(raw: string | undefined, timeZone?: string | null): Date | null {
  if (!raw) return null;
  const normalised = raw
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .trim();
  return parseZoneless(normalised, timeZone ?? undefined);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(setImmediate);
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
  const speakerStats = new Map<string, { name: string; count: number; firstAt?: Date; lastAt?: Date }>();

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
    const timestamp = readTimestamp(at, options.timeZone);
    records.push({
      speaker,
      content,
      timestamp,
      kind: "text",
      lineNo,
    });
    const stat = speakerStats.get(speaker) ?? { name: speaker, count: 0 };
    stat.count += 1;
    if (timestamp && (!stat.firstAt || timestamp < stat.firstAt)) stat.firstAt = timestamp;
    if (timestamp && (!stat.lastAt || timestamp > stat.lastAt)) stat.lastAt = timestamp;
    speakerStats.set(speaker, stat);
  }

  return {
    records,
    speakers: [...speakerStats.values()],
    warnings: warnings.slice(0, 50),
    skipped,
  };
}
