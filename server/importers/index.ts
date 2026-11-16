/**
 * Turns an uploaded chat file into rows in the record table.
 *
 * Detection picks a format; the wizard (C1.2) can override it. A zip is
 * unpacked first, then each chat file inside it is detected. A file
 * whose two sides cannot be named stops at `needs_roles` so nothing is
 * written until the user says who is who.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { copy, type Locale } from "@shared/copy";
import {
  CHAT_IMPORT_FILE_TYPES,
  isChatImportFileType,
  type ChatImportFileType,
} from "@shared/records";
import { ENV } from "../_core/env";
import { resolveUploadPath } from "../_core/filename";
import {
  getPersonaById,
  getPersonaFileById,
  getUserById,
  getUserTimezone,
  updatePersonaFile,
} from "../db";
import { importRecords, RecordLimitError } from "../collectors/db-store";
import { afterRecordsChanged } from "../_core/style-profile";
import { resolveStoredPath } from "../storage";
import {
  importUnpackRelKey,
  unpackErrorCopyKey,
  unpackZip,
} from "./archive";
import { detectFormat, pickDetectedFormat } from "./detect";
import { parseCsv } from "./csv";
import {
  attachMediaPaths,
  cappedWarnings,
  importSourceFrom,
  yieldToEventLoop,
} from "./normalize";
import { importerById } from "./registry";
import { assignRoles, guessRoles } from "./roles";
import {
  isRedactionActive,
  redactRecords,
  redactionReportOf,
  type RedactionOptions,
} from "./redact";
import type {
  ColumnMap,
  ImportFormatId,
  ImportSource,
  ParseReport,
  ParseWarning,
} from "./types";

export { parseGenericLine } from "./formats/generic-line";
export { detectFormat, pickDetectedFormat } from "./detect";
export { IMPORTERS, importerById } from "./registry";
export { assignRoles, guessRoles } from "./roles";
export type { ParseResult, ParseReport, ImportFormatId, ColumnMap } from "./types";

export { CHAT_IMPORT_FILE_TYPES, isChatImportFileType };
export type { ChatImportFileType };

export interface StartImportInput {
  fileId: number;
  userId: number;
  /** The full file text. Upload may pass this so the truncated excerpt is not parsed. */
  text?: string;
  /** Raw bytes. Preferred over `text` so encoding is decided here. */
  bytes?: Uint8Array;
  locale?: Locale | string;
  format?: ImportFormatId;
  me?: string[];
  them?: string[];
  chatId?: string;
  columnMap?: ColumnMap;
  redaction?: Omit<RedactionOptions, "keepNames">;
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
 * The first eight data rows of a delimiter-separated file.
 *
 * The column-map wizard needs a table without parsing the rest of a
 * large export. A slice is enough for headers and those rows; a quote
 * cut in half only spoils the last one.
 */
function rawTableFrom(text: string): ParseReport["rawTable"] | undefined {
  const slice = text.length > 16_000 ? text.slice(0, 16_000) : text;
  const { headers, rows } = parseCsv(slice);
  if (headers.length === 0) return undefined;
  return { headers, rows: rows.slice(0, 8) };
}

async function loadSource(
  file: { originalName?: string | null; fileKey?: string | null },
  input: StartImportInput,
): Promise<ImportSource | null> {
  let bytes: Uint8Array | undefined = input.bytes;
  if (!bytes && input.text != null) bytes = Buffer.from(input.text, "utf8");
  if (!bytes && file.fileKey) {
    const disk = resolveStoredPath(file.fileKey);
    if (disk) {
      try {
        bytes = await readFile(disk);
      } catch {
        bytes = undefined;
      }
    }
  }
  if (!bytes) return null;
  return importSourceFrom(file.originalName ?? "file", bytes, input.bytes ? undefined : input.text);
}

async function sourceFromArchive(
  file: { id: number; userId: number; personaId: number; originalName?: string | null; fileKey?: string | null },
  input: StartImportInput,
): Promise<
  | { status: "ok"; source: ImportSource; report: ParseReport }
  | { status: "needs_format" | "needs_chat" | "failed"; report: ParseReport; reason?: string }
> {
  const zipSource = await loadSource(file, input);
  if (!zipSource) {
    return { status: "failed", report: {}, reason: copy(input.locale === "en" ? "en" : "zh", "errors.importFailed") };
  }

  const locale: Locale = input.locale === "en" ? "en" : "zh";
  let destDir: string;
  try {
    destDir = resolveUploadPath(
      ENV.uploadDir,
      importUnpackRelKey(file.userId, file.personaId, file.id),
    );
  } catch {
    return { status: "failed", report: {}, reason: copy(locale, "errors.importFailed") };
  }

  const unpacked = await unpackZip(zipSource.bytes, destDir);
  const report: ParseReport = {
    mediaFiles: unpacked.mediaFiles.map((row) => row.relativePath),
    chatFiles: [],
    skipped: unpacked.skipped,
    warnings: unpacked.warnings,
    progress: 0,
  };

  if (!unpacked.ok) {
    return {
      status: "failed",
      report,
      reason: copy(locale, unpackErrorCopyKey(unpacked.errorCode)),
    };
  }

  const chats: Array<{
    path: string;
    format?: ImportFormatId;
    confidence?: number;
    source: ImportSource;
  }> = [];
  for (const entry of unpacked.chatFiles) {
    const bytes = await readFile(entry.absPath);
    const chatSource = importSourceFrom(entry.relativePath, bytes);
    const detected = detectFormat(chatSource);
    chats.push({
      path: entry.relativePath,
      format: detected[0]?.id,
      confidence: detected[0]?.confidence,
      source: chatSource,
    });
    await yieldToEventLoop();
  }
  report.chatFiles = chats.map((row) => ({
    path: row.path,
    format: row.format,
    confidence: row.confidence,
  }));

  if (chats.length === 0) {
    return { status: "needs_format", report };
  }
  if (chats.length > 1 && !input.chatId) {
    report.chats = chats.map((row) => ({
      id: row.path,
      title: path.posix.basename(row.path),
      count: 0,
    }));
    return { status: "needs_chat", report };
  }

  const chosen = input.chatId
    ? chats.find((row) => row.path === input.chatId)
    : chats[0];
  if (!chosen) {
    return { status: "failed", report, reason: copy(locale, "errors.importFailed") };
  }
  return { status: "ok", source: chosen.source, report };
}

/**
 * Parses one uploaded file and writes the rows it can already assign.
 *
 * Stops at `needs_format` when detection cannot pick a format, at
 * `needs_chat` when a file holds several conversations (or a zip holds
 * several chat files), and at `needs_roles` when the two sides cannot
 * be named.
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

  let source: ImportSource | null = null;
  let archiveReport: ParseReport = {};

  if (file.fileType === "archive") {
    const fromZip = await sourceFromArchive(file, input);
    archiveReport = fromZip.report;
    if (fromZip.status !== "ok") {
      if (fromZip.status === "failed") {
        return fail(fromZip.reason ?? copy(locale, "errors.importFailed"), fromZip.report);
      }
      await updatePersonaFile(file.id, input.userId, {
        parseStatus: fromZip.status,
        parseReport: reportOf(fromZip.report),
      });
      return { status: fromZip.status, written: 0 };
    }
    source = fromZip.source;
  } else {
    source = await loadSource(file, input);
  }

  if (!source) {
    return fail(copy(locale, "errors.importFailed"), archiveReport);
  }

  const detected = detectFormat(source);
  const picked = input.format
    ? { id: input.format, confidence: 1 }
    : pickDetectedFormat(detected);

  if (!picked || picked === "ambiguous") {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_format",
      parseReport: reportOf({
        format: detected[0]?.id,
        confidence: detected[0]?.confidence,
        progress: 0,
        rawTable: rawTableFrom(source.text),
      }),
    });
    return { status: "needs_format", written: 0 };
  }

  const importer = importerById(picked.id);
  if (!importer) {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_format",
      parseReport: reportOf({ format: picked.id, confidence: picked.confidence, progress: 0 }),
    });
    return { status: "needs_format", written: 0 };
  }

  const parsed = await importer.parse(source, {
    timeZone: (await getUserTimezone(input.userId)) ?? undefined,
    chatId: input.chatId,
    columnMap: input.columnMap,
    mediaFiles: archiveReport.mediaFiles,
  });
  parsed.records = attachMediaPaths(parsed.records, archiveReport.mediaFiles);
  const speakers = parsed.speakers.map((row) => row.name);
  const times = parsed.records
    .map((row) => row.timestamp)
    .filter((value): value is Date => value instanceof Date);
  const timeRange = {
    firstAt: asIso(times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : undefined),
    lastAt: asIso(times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : undefined),
  };
  const warnings: ParseWarning[] = cappedWarnings([
    ...(archiveReport.warnings ?? []),
    ...parsed.warnings,
  ]);
  const baseReport: ParseReport = {
    format: importer.id,
    confidence: picked.confidence,
    speakers: parsed.speakers.map((row) => ({
      name: row.name,
      count: row.count,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
    })),
    timeRange,
    skipped: (archiveReport.skipped ?? 0) + parsed.skipped,
    warnings,
    kindCounts: countBy(parsed.records.map((row) => row.kind)),
    chats: parsed.chats ?? archiveReport.chats,
    chatFiles: archiveReport.chatFiles,
    mediaFiles: archiveReport.mediaFiles,
    progress: 0,
    rawTable: importer.id === "column-map" ? rawTableFrom(source.text) : undefined,
  };

  if (parsed.chats && parsed.chats.length > 1 && !input.chatId) {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_chat",
      parseReport: reportOf({ ...baseReport, progress: 0 }),
    });
    return { status: "needs_chat", written: 0 };
  }

  if (parsed.records.length === 0) {
    return fail(copy(locale, "errors.importFailed"), baseReport);
  }

  const persona = await getPersonaById(file.personaId, input.userId);
  const user = await getUserById(input.userId);
  const mapping =
    input.me && input.them && input.me.length > 0 && input.them.length > 0
      ? { me: input.me, them: input.them }
      : guessRoles(speakers, {
          personaName: persona?.name,
          userName: user?.name,
        }, parsed.records);
  if (!mapping) {
    await updatePersonaFile(file.id, input.userId, {
      parseStatus: "needs_roles",
      parseReport: reportOf({ ...baseReport, progress: 0 }),
    });
    return { status: "needs_roles", written: 0 };
  }

  const assigned = assignRoles(parsed.records, mapping);
  const keepNames = [
    ...(mapping.me ?? []),
    ...(mapping.them ?? []),
    persona?.name,
    user?.name,
  ].filter((name): name is string => Boolean(name && name.trim()));
  const redactionOptions: RedactionOptions = {
    ...(input.redaction ?? {}),
    keepNames,
  };
  const redacted = isRedactionActive(input.redaction)
    ? redactRecords(assigned, redactionOptions)
    : { records: assigned, counts: undefined };
  const toWrite = redacted.records;
  const redactionReport = redacted.counts
    ? redactionReportOf(redactionOptions, redacted.counts)
    : undefined;
  const withRoles: ParseReport = {
    ...baseReport,
    roleCounts: countBy(assigned.map((row) => row.role)),
    ...(redactionReport ? { redaction: redactionReport } : {}),
  };

  await updatePersonaFile(file.id, input.userId, {
    parseStatus: "importing",
    parseReport: reportOf({ ...withRoles, progress: 0 }),
  });

  try {
    const written = await importRecords({
      personaId: file.personaId,
      userId: input.userId,
      source: importer.source,
      fileId: file.id,
      records: toWrite,
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
        existing: toWrite.length - written,
        progress: 100,
      }),
    });
    try {
      await afterRecordsChanged({
        personaId: file.personaId,
        userId: input.userId,
        added: written,
      });
    } catch (error) {
      console.warn("[Import] The style profile could not be updated:", error);
    }
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

export interface ImportStatus {
  fileId: number;
  personaId: number;
  parseStatus: string | null;
  parseReport: ParseReport | null;
  originalName: string;
  fileType: string;
  fileSize: number;
}

export async function getImportStatus(
  fileId: number,
  userId: number,
): Promise<ImportStatus | null> {
  const file = await getPersonaFileById(fileId, userId);
  if (!file) return null;
  return {
    fileId: file.id,
    personaId: file.personaId,
    parseStatus: file.parseStatus ?? null,
    parseReport: (file.parseReport as ParseReport | null) ?? null,
    originalName: file.originalName,
    fileType: file.fileType,
    fileSize: file.fileSize,
  };
}

export async function cancelImport(
  fileId: number,
  userId: number,
  locale: Locale | string = "zh",
): Promise<{ status: string } | null> {
  const file = await getPersonaFileById(fileId, userId);
  if (!file) return null;
  const lang: Locale = locale === "en" ? "en" : "zh";
  const reason = copy(lang, "errors.importCancelled");
  await updatePersonaFile(file.id, userId, {
    parseStatus: "failed",
    parseReport: reportOf({
      ...((file.parseReport as ParseReport | null) ?? {}),
      failedReason: reason,
      progress: 0,
    }),
  });
  return { status: "failed" };
}

export interface PreviewRow {
  timestamp: string | null;
  speaker: string;
  content: string;
  kind: string;
  lineNo: number;
}

export interface PreviewResult {
  status: string;
  records: PreviewRow[];
  total: number;
  report: ParseReport;
}

function previewRowsOf(records: Array<{ timestamp: Date | null; speaker: string; content: string; kind: string; lineNo: number }>): PreviewRow[] {
  return records.slice(0, 20).map((row) => ({
    timestamp: row.timestamp ? row.timestamp.toISOString() : null,
    speaker: row.speaker,
    content: row.content,
    kind: row.kind,
    lineNo: row.lineNo,
  }));
}

/**
 * Parses a file the way startImport does, without writing records or
 * touching parseStatus.
 */
export async function previewImport(input: StartImportInput): Promise<PreviewResult | null> {
  const locale: Locale = input.locale === "en" ? "en" : "zh";
  const file = await getPersonaFileById(input.fileId, input.userId);
  if (!file) return null;

  let source: ImportSource | null = null;
  let archiveReport: ParseReport = {};

  if (file.fileType === "archive") {
    const fromZip = await sourceFromArchive(file, input);
    archiveReport = fromZip.report;
    if (fromZip.status !== "ok") {
      return {
        status: fromZip.status,
        records: [],
        total: 0,
        report: fromZip.report,
      };
    }
    source = fromZip.source;
  } else {
    source = await loadSource(file, input);
  }

  if (!source) {
    return {
      status: "failed",
      records: [],
      total: 0,
      report: { ...archiveReport, failedReason: copy(locale, "errors.importFailed") },
    };
  }

  const detected = detectFormat(source);
  const picked = input.format
    ? { id: input.format, confidence: 1 }
    : pickDetectedFormat(detected);

  if (!picked || picked === "ambiguous") {
    return {
      status: "needs_format",
      records: [],
      total: 0,
      report: {
        ...archiveReport,
        format: detected[0]?.id,
        confidence: detected[0]?.confidence,
        rawTable: rawTableFrom(source.text),
      },
    };
  }

  const importer = importerById(picked.id);
  if (!importer) {
    return {
      status: "needs_format",
      records: [],
      total: 0,
      report: { ...archiveReport, format: picked.id, confidence: picked.confidence },
    };
  }

  const parsed = await importer.parse(source, {
    timeZone: (await getUserTimezone(input.userId)) ?? undefined,
    chatId: input.chatId,
    columnMap: input.columnMap,
    mediaFiles: archiveReport.mediaFiles,
  });
  parsed.records = attachMediaPaths(parsed.records, archiveReport.mediaFiles);
  const times = parsed.records
    .map((row) => row.timestamp)
    .filter((value): value is Date => value instanceof Date);
  const report: ParseReport = {
    ...archiveReport,
    format: importer.id,
    confidence: picked.confidence,
    speakers: parsed.speakers,
    timeRange: {
      firstAt: asIso(times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : undefined),
      lastAt: asIso(times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : undefined),
    },
    skipped: (archiveReport.skipped ?? 0) + parsed.skipped,
    warnings: cappedWarnings([...(archiveReport.warnings ?? []), ...parsed.warnings]),
    kindCounts: countBy(parsed.records.map((row) => row.kind)),
    chats: parsed.chats ?? archiveReport.chats,
    rawTable: importer.id === "column-map" ? rawTableFrom(source.text) : archiveReport.rawTable,
  };

  if (parsed.chats && parsed.chats.length > 1 && !input.chatId) {
    return { status: "needs_chat", records: [], total: parsed.records.length, report };
  }

  if (input.me && input.them && input.me.length > 0 && input.them.length > 0) {
    const assigned = assignRoles(parsed.records, { me: input.me, them: input.them });
    report.roleCounts = countBy(assigned.map((row) => row.role));
  }

  return {
    status: "ok",
    records: previewRowsOf(parsed.records),
    total: parsed.records.length,
    report,
  };
}
