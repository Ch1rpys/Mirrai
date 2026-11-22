/**
 * A stretch of the record, taken into the conversation (C8.10).
 *
 * The user can select a few consecutive lines in the record reader and
 * bring them into a chat turn — "let's talk about this". The lines are
 * old records, so they go into the prompt as material, dated, and
 * fenced like every other piece of material; the persona is told they
 * are what the two of them said, not instructions.
 *
 * The limits are small on purpose: eight lines, 1,200 characters. A
 * whole conversation pasted into one turn stops being a quotation.
 */
import { copy } from "@shared/copy";
import { zonedDateKey } from "@shared/timezone";
import * as db from "../db";
import type { Locale } from "@shared/copy";

export const MAX_QUOTED_RECORDS = 8;
export const MAX_QUOTED_CHARS = 1200;

/** A quotation that cannot be used, with a reason the user can act on. */
export class QuotedRecordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotedRecordsError";
  }
}

export interface QuotedRecordLine {
  id: number;
  role: string;
  speaker: string | null;
  content: string;
  timestamp: Date | null;
  createdAt?: Date | null;
}

/** The section, as the prompt receives it (the caller fences it). */
export function buildQuotedRecordsSection(
  lines: QuotedRecordLine[],
  params: { locale: Locale; timeZone?: string | null; themName: string; meName?: string },
): string {
  const zone = params.timeZone ?? "UTC";
  const rendered = lines.map((line) => {
    const at = line.timestamp ?? line.createdAt ?? null;
    const date = at ? zonedDateKey(at, zone) : "";
    const who = line.role === "user"
      ? (params.meName ?? copy(params.locale, "prompt.roleUser"))
      : (line.speaker || params.themName);
    return copy(params.locale, "prompt.quotedRecordsLine", {
      date,
      who,
      content: line.content,
    });
  });
  return [
    copy(params.locale, "prompt.quotedRecordsHeading"),
    ...rendered,
  ].join("\n");
}

/**
 * Loads the lines and checks they may be quoted.
 *
 * Every id has to be a record of this persona and this user. The total
 * is counted on the rendered text, which is what the prompt pays for.
 */
export async function readQuotableRecords(params: {
  persona: { id: number };
  userId: number;
  ids: number[];
  locale: Locale;
}): Promise<QuotedRecordLine[]> {
  const unique = [...new Set(params.ids)];
  if (unique.length === 0) return [];
  if (unique.length > MAX_QUOTED_RECORDS) {
    throw new QuotedRecordsError(copy(params.locale, "errors.quotedRecordsTooLong"));
  }
  const rows = await db.getRecordsByIds(unique, params.userId);
  if (
    rows.length !== unique.length ||
    rows.some((row) => row.personaId !== params.persona.id)
  ) {
    throw new QuotedRecordsError(copy(params.locale, "errors.quotedRecordsNotYours"));
  }
  const chars = rows.reduce((sum, row) => sum + String(row.content ?? "").length, 0);
  if (chars > MAX_QUOTED_CHARS) {
    throw new QuotedRecordsError(copy(params.locale, "errors.quotedRecordsTooLong"));
  }
  return rows as QuotedRecordLine[];
}

export async function loadQuotedRecordsSection(params: {
  persona: { id: number; name: string };
  userId: number;
  ids: number[];
  locale: Locale;
  timeZone?: string | null;
  meName?: string;
}): Promise<string> {
  const rows = await readQuotableRecords({
    persona: params.persona,
    userId: params.userId,
    ids: params.ids,
    locale: params.locale,
  });
  if (rows.length === 0) return "";
  return buildQuotedRecordsSection(rows, {
    locale: params.locale,
    timeZone: params.timeZone,
    themName: params.persona.name,
    meName: params.meName,
  });
}
