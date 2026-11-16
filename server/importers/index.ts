/**
 * Turns an uploaded chat file into rows in the record table.
 *
 * A1 only knows `generic-line`. C1.1 adds the rest of the formats,
 * detection, archives, and the wizard routes; this file stays the
 * place `file.upload` calls.
 */
import { copy, type Locale } from "@shared/copy";
import {
  getPersonaById,
  getPersonaFileById,
  getUserById,
  getUserTimezone,
  updatePersonaFile,
} from "../db";
import { importRecords, RecordLimitError } from "../collectors/db-store";
import { parseGenericLine } from "./formats/generic-line";
import { assignRoles, guessRoles } from "./roles";
import type { ParseReport, ParseWarning } from "./types";

export { parseGenericLine } from "./formats/generic-line";
export { assignRoles, guessRoles } from "./roles";
export type { ParseResult, ParseReport } from "./types";

/** File types that should be parsed into records after upload. */
export const CHAT_IMPORT_FILE_TYPES = [
  "chat_txt",
  "chat_csv",
  "chat_export",
  "archive",
] as const;

export type ChatImportFileType = (typeof CHAT_IMPORT_FILE_TYPES)[number];

export function isChatImportFileType(value: string): value is ChatImportFileType {
  return (CHAT_IMPORT_FILE_TYPES as readonly string[]).includes(value);
}

export interface StartImportInput {
  fileId: number;
  userId: number;
  /** The full file text. Upload passes this so the truncated excerpt is not parsed. */
  text?: string;
  locale?: Locale | string;
}

export interface StartImportResult {
  status: string;
  written: number;
}

function asIso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

function reportOf(partial: ParseReport): ParseReport {
  return partial;
}

/**
 * Parses one uploaded file and writes the rows it can already assign.
 *
 * Stops at `needs_format` for an archive (C1.1 unpacks those) and at
 * `needs_roles` when the two sides cannot be named. A file the parser
 * cannot turn into lines is `failed`.
 */
export async function startImport(input: StartImportInput): Promise<StartImportResult> {
  const locale: Locale = input.locale === "en" ? "en" : "zh";
  const file = await getPersonaFileById(input.fileId, input.userId);
  if (!file) {
    return { status: "failed", written: 0 };
  }

  const fail = async (reason: string, extra: ParseReport = {}): Promise<StartImportResult> => {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "failed",
      parseReport: reportOf({ ...extra, failedReason: reason, progress: 0 }),
    });
    return { status: "failed", written: 0 };
  };

  await updatePersonaFile(file.id, input.userId, {
    parseStatus: "detecting",
    parseReport: reportOf({ progress: 0 }),
  });

  if (file.fileType === "archive") {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_format",
      parseReport: reportOf({ progress: 0 }),
    });
    return { status: "needs_format", written: 0 };
  }

  const text = input.text;
  if (text == null) {
    return fail(copy(locale, "errors.importFailed"));
  }

  const parsed = await parseGenericLine(text, {
    timeZone: (await getUserTimezone(input.userId)) ?? undefined,
  });
  const speakers = parsed.speakers.map((row) => row.name);
  const times = parsed.records
    .map((row) => row.timestamp)
    .filter((value): value is Date => value instanceof Date);
  const timeRange = {
    firstAt: asIso(times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : undefined),
    lastAt: asIso(times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : undefined),
  };
  const warnings: ParseWarning[] = parsed.warnings;
  const baseReport: ParseReport = {
    format: "generic-line",
    confidence: 1,
    speakers: parsed.speakers.map((row) => ({
      name: row.name,
      count: row.count,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
    })),
    timeRange,
    skipped: parsed.skipped,
    warnings,
    kindCounts: countBy(parsed.records.map((row) => row.kind)),
    progress: 0,
  };

  if (parsed.records.length === 0) {
    return fail(copy(locale, "errors.importFailed"), baseReport);
  }

  const persona = await getPersonaById(file.personaId, input.userId);
  const user = await getUserById(input.userId);
  const mapping = guessRoles(speakers, {
    personaName: persona?.name,
    userName: user?.name,
  });
  if (!mapping) {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_roles",
      parseReport: reportOf({ ...baseReport, progress: 0 }),
    });
    return { status: "needs_roles", written: 0 };
  }

  const assigned = assignRoles(parsed.records, mapping);
  const withRoles = {
    ...baseReport,
    roleCounts: countBy(assigned.map((row) => row.role)),
  };

  await updatePersonaFile(file.id, input.userId, {
    parseStatus: "importing",
    parseReport: reportOf({ ...withRoles, progress: 0 }),
  });

  try {
    const written = await importRecords({
      personaId: file.personaId,
      userId: input.userId,
      source: "generic",
      fileId: file.id,
      records: assigned,
      onProgress: async (soFar, total) => {
        await updatePersonaFile(file.id, input.userId, {
          parseStatus: "importing",
          parseReport: reportOf({
            ...withRoles,
            written: soFar,
            progress: total === 0 ? 100 : Math.round((soFar / total) * 100),
          }),
        });
      },
    });
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "done",
      parseReport: reportOf({
        ...withRoles,
        written,
        progress: 100,
      }),
    });
    return { status: "done", written };
  } catch (error) {
    if (error instanceof RecordLimitError) {
      return fail(
        copy(locale, "errors.recordsLimit", {
          current: error.current,
          incoming: error.incoming,
          max: error.max,
        }),
        withRoles,
      );
    }
    return fail(copy(locale, "errors.importFailed"), withRoles);
  }
}
