/**
 * Streaming upload for a chat export that does not fit in the JSON
 * `file.upload` body.
 *
 * `PUT /api/import/upload?personaId=&name=` takes the raw bytes, writes
 * them to disk as they arrive, then starts the same import path the
 * JSON upload uses. Failures are copy() strings — never a path or a
 * stack.
 */
import { createWriteStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Express, Request, Response } from "express";
import { nanoid } from "nanoid";
import { copy, type Locale } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { authenticateRequest } from "../_core/auth";
import { isRequestLocked, personaLocked, sessionKeyFromRequest } from "../_core/app-lock";
import { ENV } from "../_core/env";
import {
  checkFileExtension,
  IMPORT_ARCHIVE_EXTENSIONS,
  IMPORT_CHAT_EXTENSIONS,
  importEntryKind,
  resolveUploadPath,
  sanitizeFileName,
} from "../_core/filename";
import { RATE_LIMITS, rateLimiter, resolveRateLimitKey } from "../_core/rate-limit";
import { createPersonaFile, getPersonaById } from "../db";
import { maxImportFileBytes } from "./archive";
import { isChatImportFileType, startImport } from "./index";

const MAX_EXTRACTED_CHARS = 500_000;

class ImportTooLargeError extends Error {
  constructor() {
    super("too large");
    this.name = "ImportTooLargeError";
  }
}

function localeOf(req: Request): Locale {
  const header = req.headers["x-mirrai-locale"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === "en") return "en";
  if (value === "zh-Hant") return "zh-Hant";
  return "zh";
}

function queryValue(req: Request, key: string): string {
  const raw = req.query[key];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

function fileTypeFor(kind: "chat" | "archive"): "chat_export" | "archive" {
  return kind === "archive" ? "archive" : "chat_export";
}

async function excerptHead(absPath: string): Promise<string | undefined> {
  const handle = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(MAX_EXTRACTED_CHARS);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead <= 0) return undefined;
    return buf.subarray(0, bytesRead).toString("utf8").slice(0, MAX_EXTRACTED_CHARS);
  } finally {
    await handle.close();
  }
}

async function removeQuietly(absPath: string | null): Promise<void> {
  if (!absPath) return;
  try {
    await unlink(absPath);
  } catch {
    // A file that was never created, or already gone, is the outcome we want.
  }
}

export function registerImportUploadRoute(app: Express): void {
  // codeql[js/missing-rate-limiting]
  app.put("/api/import/upload", (req: Request, res: Response) => {
    handleImportUpload(req, res).catch((error) => {
      console.error("[ImportUpload] The request failed:", error);
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      res.status(500).json({ error: copy(localeOf(req), "errors.importFailed") });
    });
  });
}

async function handleImportUpload(req: Request, res: Response): Promise<void> {
  const locale = localeOf(req);

  let user;
  try {
    user = await authenticateRequest(req);
  } catch {
    res.status(401).json({ error: copy(locale, "errors.streamUnauthorized") });
    return;
  }

  // The app lock covers the streaming import too (C8.4).
  if (await isRequestLocked(req, user)) {
    res.status(403).json({ error: copy(locale, "errors.locked") });
    return;
  }

  const limit = await rateLimiter.check(
    resolveRateLimitKey(req, RATE_LIMITS.upload, user.id),
    RATE_LIMITS.upload,
  );
  if (!limit.allowed) {
    res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
    res.status(429).json({ error: copy(locale, "errors.importTooManyRequests") });
    return;
  }

  const personaId = Number(queryValue(req, "personaId"));
  const rawName = queryValue(req, "name");
  if (!Number.isInteger(personaId) || personaId <= 0 || !rawName) {
    res.status(400).json({ error: copy(locale, "errors.streamInvalidRequest") });
    return;
  }

  const persona = await getPersonaById(personaId, user.id);
  if (!persona) {
    res.status(404).json({ error: copy(locale, "errors.importPersonaNotFound") });
    return;
  }
  // A locked persona does not take new records either (C8.4).
  if (await personaLocked(
    normalizePersonaSettings((persona as { settings?: unknown }).settings),
    sessionKeyFromRequest(req),
  )) {
    res.status(403).json({ error: copy(locale, "errors.locked") });
    return;
  }

  const safeName = sanitizeFileName(rawName);
  const kind = importEntryKind(safeName);
  if (kind !== "chat" && kind !== "archive") {
    const allowed = [...IMPORT_CHAT_EXTENSIONS, ...IMPORT_ARCHIVE_EXTENSIONS].join(" / ");
    res.status(400).json({
      error: copy(locale, "errors.fileExtensionNotSupported", {
        ext: path.extname(safeName) || "(none)",
        allowed,
      }),
    });
    return;
  }

  const fileType = fileTypeFor(kind);
  const extensionProblem = checkFileExtension(safeName, fileType, locale);
  if (extensionProblem) {
    res.status(400).json({ error: extensionProblem });
    return;
  }

  const maxBytes = maxImportFileBytes();
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.status(413).json({ error: copy(locale, "errors.fileTooLarge") });
    return;
  }

  const fileKey = `personas/${user.id}/${personaId}/${nanoid()}-${safeName}`;
  let absPath: string;
  try {
    absPath = resolveUploadPath(ENV.uploadDir, fileKey);
  } catch {
    res.status(400).json({ error: copy(locale, "errors.importFailed") });
    return;
  }

  await mkdir(path.dirname(absPath), { recursive: true });

  let written = 0;
  const counter = new Transform({
    transform(chunk, _enc, callback) {
      written += chunk.length;
      if (written > maxBytes) {
        callback(new ImportTooLargeError());
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, counter, createWriteStream(absPath));
  } catch (error) {
    await removeQuietly(absPath);
    if (error instanceof ImportTooLargeError) {
      res.status(413).json({ error: copy(locale, "errors.fileTooLarge") });
      return;
    }
    res.status(400).json({ error: copy(locale, "errors.importFailed") });
    return;
  }

  if (written <= 0) {
    await removeQuietly(absPath);
    res.status(400).json({ error: copy(locale, "errors.importUploadEmpty") });
    return;
  }

  let extractedMemory: string | undefined;
  if (fileType === "chat_export") {
    try {
      extractedMemory = await excerptHead(absPath);
    } catch {
      extractedMemory = undefined;
    }
  }

  const url = `/uploads/${fileKey}`;
  let fileId: number;
  try {
    fileId = await createPersonaFile({
      personaId,
      userId: user.id,
      fileType,
      originalName: safeName,
      fileKey,
      fileUrl: url,
      fileSize: written,
      extractedMemory,
      processStatus: "done",
    });
  } catch {
    await removeQuietly(absPath);
    res.status(500).json({ error: copy(locale, "errors.importFailed") });
    return;
  }

  if (isChatImportFileType(fileType)) {
    try {
      await startImport({
        fileId,
        userId: user.id,
        locale,
      });
    } catch (error) {
      console.error("[ImportUpload] startImport failed:", error);
    }
  }

  res.status(200).json({ fileId, fileUrl: url });
}
