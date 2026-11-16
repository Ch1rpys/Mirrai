/**
 * Unpacks a zip of chat exports and media into the uploads directory.
 *
 * The unpacker is streaming: each entry is inflated onto disk as it
 * arrives, so a large archive is not held decompressed in memory.
 * Names that climb out of the destination, absolute names, and
 * extensions outside the chat/media lists are skipped.
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import {
  importEntryKind,
  resolveUploadPath,
  sanitizeFileName,
} from "../_core/filename";
import { cappedWarnings } from "./normalize";
import type { ParseWarning } from "./types";

const GiB = 1024 * 1024 * 1024;
/** Signed int4 ceiling: `persona_files.fileSize` cannot hold a full 2 GiB. */
const INT4_MAX = 2147483647;

export const DEFAULT_MAX_ARCHIVE_ENTRIES = 200_000;
export const DEFAULT_MAX_UNPACKED_BYTES = 8 * GiB;
export const DEFAULT_MAX_FILE_BYTES = 2 * GiB;

const PUSH_CHUNK = 64 * 1024;

export type UnpackErrorCode =
  | "broken"
  | "too-many-entries"
  | "too-large"
  | "file-too-large";

export interface UnpackOptions {
  maxEntries?: number;
  maxUnpackedBytes?: number;
  maxFileBytes?: number;
}

export interface UnpackedEntry {
  relativePath: string;
  absPath: string;
  kind: "chat" | "media";
  bytes: number;
}

export interface UnpackResult {
  ok: boolean;
  destDir: string;
  chatFiles: UnpackedEntry[];
  mediaFiles: UnpackedEntry[];
  skipped: number;
  warnings: ParseWarning[];
  errorCode?: UnpackErrorCode;
}

/**
 * The storage key of the directory an uploaded zip unpacks into.
 */
export function importUnpackRelKey(
  userId: number,
  personaId: number,
  fileId: number,
): string {
  return `personas/${userId}/${personaId}/imports/${fileId}`;
}

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function maxImportUnpackedBytes(): number {
  return readLimit("MAX_IMPORT_UNPACKED_BYTES", DEFAULT_MAX_UNPACKED_BYTES);
}

export function maxImportFileBytes(): number {
  return Math.min(readLimit("MAX_IMPORT_BYTES", DEFAULT_MAX_FILE_BYTES), INT4_MAX);
}

/**
 * A zip entry name that is safe to write under destDir, or null.
 *
 * `..`, absolute paths, and drive letters are refused before anything
 * is resolved. Each remaining segment is sanitised so a reserved
 * Windows name cannot be used as a path component.
 */
export function safeZipRelPath(name: string): string | null {
  const raw = String(name ?? "").replace(/\\/g, "/");
  if (!raw || raw.endsWith("/")) return null;
  const drive = raw.charCodeAt(0);
  const isLetter = (drive >= 65 && drive <= 90) || (drive >= 97 && drive <= 122);
  if (raw.startsWith("/") || (isLetter && raw.charAt(1) === ":")) return null;
  const parts = raw.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "..")) return null;
  return parts.map((part) => sanitizeFileName(part)).join("/");
}

function warning(code: string, detail: string): ParseWarning {
  const clipped = detail.length > 200 ? `${detail.slice(0, 200)}…` : detail;
  return { code, detail: clipped };
}

function drain(file: UnzipFile): void {
  file.ondata = () => {};
  try {
    file.start();
  } catch {
    // Unknown compression on a skipped entry is not a reason to fail.
  }
}

/**
 * Inflates `bytes` into `destDir` using fflate's streaming Unzip.
 *
 * On any cap being exceeded the destination is removed and `ok` is
 * false. Skipped entries are counted and described in `warnings`.
 */
export async function unpackZip(
  bytes: Uint8Array,
  destDir: string,
  options: UnpackOptions = {},
): Promise<UnpackResult> {
  const dest = path.resolve(destDir);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
  const maxUnpacked = options.maxUnpackedBytes ?? maxImportUnpackedBytes();
  const maxFile = options.maxFileBytes ?? maxImportFileBytes();

  const chatFiles: UnpackedEntry[] = [];
  const mediaFiles: UnpackedEntry[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;
  let entries = 0;
  let unpacked = 0;
  let aborted = false;
  let errorCode: UnpackErrorCode | undefined;
  const pending: Promise<void>[] = [];

  const abort = (code: UnpackErrorCode) => {
    aborted = true;
    errorCode = errorCode ?? code;
  };

  await rm(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate);

  unzipper.onfile = (file) => {
    pending.push(
      new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          if (error) reject(error);
          else resolve();
        };

        if (aborted) {
          drain(file);
          finish();
          return;
        }

        entries += 1;
        if (entries > maxEntries) {
          abort("too-many-entries");
          drain(file);
          finish();
          return;
        }

        const originalName = file.name ?? "";
        if (originalName.endsWith("/") || originalName.endsWith("\\")) {
          drain(file);
          finish();
          return;
        }

        const rel = safeZipRelPath(originalName);
        if (!rel) {
          skipped += 1;
          warnings.push(warning("zip-slip", originalName));
          drain(file);
          finish();
          return;
        }

        const kind = importEntryKind(rel);
        if (kind !== "chat" && kind !== "media") {
          skipped += 1;
          warnings.push(warning("zip-skipped-ext", rel));
          drain(file);
          finish();
          return;
        }

        if (file.originalSize != null && file.originalSize > maxFile) {
          abort("file-too-large");
          drain(file);
          finish();
          return;
        }
        if (file.originalSize != null && unpacked + file.originalSize > maxUnpacked) {
          abort("too-large");
          drain(file);
          finish();
          return;
        }

        let abs: string;
        try {
          abs = resolveUploadPath(dest, rel);
        } catch {
          skipped += 1;
          warnings.push(warning("zip-slip", originalName));
          drain(file);
          finish();
          return;
        }

        mkdirSync(path.dirname(abs), { recursive: true });
        const stream = createWriteStream(abs);
        let size = 0;
        let settled = false;
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          finish(error);
        };

        stream.on("error", (error) => {
          abort("broken");
          settle(error);
        });

        file.ondata = (error, data, final) => {
          if (error) {
            abort("broken");
            stream.destroy();
            settle(error);
            return;
          }
          size += data.length;
          if (size > maxFile) {
            abort("file-too-large");
            stream.destroy();
            file.terminate();
            settle();
            return;
          }
          if (unpacked + size > maxUnpacked) {
            abort("too-large");
            stream.destroy();
            file.terminate();
            settle();
            return;
          }
          if (data.length) stream.write(data);
          if (final) {
            stream.end(async () => {
              try {
                const stat = await lstat(abs);
                if (stat.isSymbolicLink()) {
                  skipped += 1;
                  warnings.push(warning("zip-symlink", rel));
                  await rm(abs, { force: true });
                  settle();
                  return;
                }
                unpacked += size;
                const entry: UnpackedEntry = {
                  relativePath: rel,
                  absPath: abs,
                  kind,
                  bytes: size,
                };
                if (kind === "chat") chatFiles.push(entry);
                else mediaFiles.push(entry);
                settle();
              } catch (caught) {
                abort("broken");
                settle(caught instanceof Error ? caught : new Error("stat"));
              }
            });
          }
        };

        try {
          file.start();
        } catch (caught) {
          abort("broken");
          stream.destroy();
          settle(caught instanceof Error ? caught : new Error("inflate"));
        }
      }),
    );
  };

  try {
    for (let offset = 0; offset < bytes.length; offset += PUSH_CHUNK) {
      const end = Math.min(offset + PUSH_CHUNK, bytes.length);
      unzipper.push(bytes.subarray(offset, end), end === bytes.length);
      if (aborted) break;
    }
  } catch {
    abort("broken");
  }

  const settled = await Promise.allSettled(pending);
  if (settled.some((row) => row.status === "rejected")) {
    abort("broken");
  }

  if (aborted) {
    await rm(dest, { recursive: true, force: true });
    return {
      ok: false,
      destDir: dest,
      chatFiles: [],
      mediaFiles: [],
      skipped,
      warnings: cappedWarnings(warnings),
      errorCode: errorCode ?? "broken",
    };
  }

  return {
    ok: true,
    destDir: dest,
    chatFiles,
    mediaFiles,
    skipped,
    warnings: cappedWarnings(warnings),
  };
}

export function unpackErrorCopyKey(
  code: UnpackErrorCode | undefined,
): "errors.importArchiveBroken" | "errors.importArchiveTooMany" | "errors.importArchiveTooLarge" {
  if (code === "too-many-entries") return "errors.importArchiveTooMany";
  if (code === "too-large" || code === "file-too-large") return "errors.importArchiveTooLarge";
  return "errors.importArchiveBroken";
}
