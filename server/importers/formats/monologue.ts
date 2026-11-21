/**
 * Monologue — what the person wrote, not what they said (C1.8).
 *
 * A letter, a diary, an article. There is no conversation in the file, so
 * this is a format the user chooses; detection never claims it, because a
 * chat log and somebody's diary look nothing alike only to a person.
 *
 * One paragraph is one record: the person's own words, in the `written`
 * register. The register is what keeps them out of the chat-voice
 * measurements — a letter is read for what it says, not for how they
 * texted. A date line, when the file has them, dates the paragraphs after
 * it; without one nothing is dated rather than guessed at.
 */
import { copy } from "@shared/copy";
import { parseZoneless } from "@shared/timezone";
import type { ParsedRecord } from "@shared/records";
import { collectSpeakers } from "../normalize";
import type { Importer, ImportSource, ParseOptions, ParseResult } from "../types";

/** A date line with a year, with an optional weekday after it. */
const FULL_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(?:星期|周|礼拜)\S+)?$/;
/** The Chinese form of the same line. */
const FULL_DATE_ZH = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(?:星期|周|礼拜)\S+)?$/;
/** A year on its own: the entries after it belong to that year. */
const YEAR_ONLY = /^(\d{4})年$/;
/** A month and a day: the year comes from the last full date, if any. */
const MONTH_DAY = /^(\d{1,2})月(\d{1,2})日(?:\s+(?:星期|周|礼拜)\S+)?$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function validDate(year: number, month: number, day: number): CalendarDate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

type DateLine =
  | { kind: "date"; date: CalendarDate }
  | { kind: "year"; year: number }
  | { kind: "monthDay"; month: number; day: number };

/** Reads a line that is only a date, or null when it is ordinary text. */
export function parseMonologueDateLine(line: string): DateLine | null {
  const text = line.trim();
  if (!text || text.length > 40) return null;

  const full = text.match(FULL_DATE);
  if (full) {
    const date = validDate(Number(full[1]), Number(full[2]), Number(full[3]));
    return date ? { kind: "date", date } : null;
  }
  const fullZh = text.match(FULL_DATE_ZH);
  if (fullZh) {
    const date = validDate(Number(fullZh[1]), Number(fullZh[2]), Number(fullZh[3]));
    return date ? { kind: "date", date } : null;
  }
  const yearOnly = text.match(YEAR_ONLY);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return Number.isInteger(year) && year > 0 ? { kind: "year", year } : null;
  }
  const monthDay = text.match(MONTH_DAY);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { kind: "monthDay", month, day };
  }
  return null;
}

function noonOf(date: CalendarDate, timeZone?: string | null): Date | null {
  const stamp = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")} 12:00:00`;
  return parseZoneless(stamp, timeZone);
}

export interface MonologueParagraph {
  text: string;
  timestamp: Date | null;
}

/**
 * Splits a file into paragraphs, dating them from the date lines.
 *
 * A block that is only a date line is not a paragraph: it dates the
 * paragraphs after it. A date line at the top of a block dates that
 * block. Nothing else is a date, so a paragraph that begins with
 * something that looks like a date but is not one stays text.
 */
export function splitMonologue(
  text: string,
  options: { timeZone?: string | null } = {},
): MonologueParagraph[] {
  const blocks = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "")
    .split(/\n\s*\n/);
  const paragraphs: MonologueParagraph[] = [];
  let currentDate: CalendarDate | null = null;
  let currentYear: number | null = null;

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const first = parseMonologueDateLine(lines[0] ?? "");
    let contentLines = lines;
    if (first) {
      contentLines = lines.slice(1);
      if (first.kind === "date") {
        currentDate = first.date;
        currentYear = first.date.year;
      } else if (first.kind === "year") {
        currentYear = first.year;
        currentDate = null;
      } else {
        /**
         * A month-day before the last full date is the next year.
         *
         * A diary runs forwards, so "12月31日" followed by "1月2日" is
         * the new year — not a jump backwards.
         */
        if (currentYear === null) {
          currentDate = null;
        } else {
          const year: number =
            currentDate && first.month < currentDate.month
              ? currentYear + 1
              : currentYear;
          currentDate = validDate(year, first.month, first.day);
          if (currentDate) currentYear = year;
        }
      }
    }
    if (contentLines.length === 0) continue;
    const body = contentLines.join("\n").trim();
    if (!body) continue;
    paragraphs.push({
      text: body,
      timestamp: currentDate ? noonOf(currentDate, options.timeZone) : null,
    });
  }
  return paragraphs;
}

/** Turns the paragraphs into the rows the record table takes. */
export function monologueParagraphsToRecords(
  paragraphs: MonologueParagraph[],
): ParsedRecord[] {
  return paragraphs.map((paragraph, index) => ({
    speaker: "them",
    content: paragraph.text,
    timestamp: paragraph.timestamp,
    kind: "text",
    meta: { register: "written" },
    lineNo: index + 1,
  }));
}

export async function parseMonologue(
  text: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const records = monologueParagraphsToRecords(
    splitMonologue(text, { timeZone: options.timeZone }),
  );
  return {
    records,
    speakers: collectSpeakers(records),
    warnings: [],
    skipped: 0,
  };
}

/**
 * A format the user has to choose.
 *
 * Returning null is the whole point: a monologue is not a chat log, and
 * no detection score may turn somebody's diary into one side of a
 * conversation.
 */
function detectMonologue(_source: ImportSource): null {
  return null;
}

export const monologueImporter: Importer = {
  id: "monologue",
  label: {
    zh: copy("zh", "import.format.monologue"),
    en: copy("en", "import.format.monologue"),
  },
  source: "monologue",
  detect: detectMonologue,
  parse(source, options) {
    return parseMonologue(source.text, options);
  },
};
