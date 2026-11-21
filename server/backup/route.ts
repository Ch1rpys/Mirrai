/**
 * The two streaming routes of C8.3: download and restore.
 *
 * tRPC has no streaming, and a restore body is a file rather than JSON,
 * so both live here as plain Express routes. The settings themselves go
 * through the `backup.*` tRPC group.
 *
 * Security notes, because this is the one route pair that writes a whole
 * database:
 *
 *  - a download is the signed-in user's own data, not the instance: on a
 *    multi-account instance "download everything" must not hand one
 *    person another person's conversations;
 *  - a restore only works while there is no user at all, is rate
 *    limited by IP, and refuses a body larger than `BACKUP_MAX_BYTES`;
 *  - the passphrase for a restore is sent base64-encoded in a header, so
 *    it does not end up in an access log's URL.
 */
import type { Express, Request, Response } from "express";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copy, type CopyKey } from "@shared/copy";
import { authenticateRequest } from "../_core/auth";
import { refreshRequestLock } from "../_core/app-lock";
import { readLocale } from "../_core/context";
import { getClientIp, RATE_LIMITS, rateLimiter } from "../_core/rate-limit";
import { createBackupForDownload } from "../_core/backup";
import { instanceIsEmptyForRoute, restoreBackupForRoute } from "./service";

/** The largest restore body accepted. */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024 * 1024;

/** The passphrase header, base64 of the UTF-8 bytes. */
export const PASSPHRASE_HEADER = "x-mirrai-backup-passphrase";

function errorKeyFor(error: unknown): { key: CopyKey; status: number } {
  const name =
    error instanceof Error
      ? [error.constructor.name, error.name].find((candidate) => candidate !== "Error") ?? "Error"
      : "";
  if (name === "BackupNotEmptyError") return { key: "backup.errorNotEmpty", status: 403 };
  if (name === "BackupTooNewError") return { key: "backup.errorTooNew", status: 409 };
  if (name === "BackupPassphraseError") {
    const kind = (error as { kind?: string }).kind;
    return kind === "passphrase_required"
      ? { key: "backup.errorPassphraseRequired", status: 400 }
      : { key: "backup.errorWrongPassphrase", status: 400 };
  }
  if (name === "BackupIntegrityError" || name === "BackupFormatError") {
    return { key: "backup.errorCorrupt", status: 400 };
  }
  return { key: "errors.code.internalServerError", status: 500 };
}

function decodePassphrase(req: Request): string | null {
  const raw = req.headers[PASSPHRASE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/** Writes the request body to a temporary file, refusing an oversized one. */
async function receiveBody(req: Request, file: string): Promise<number> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const out = createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      if (bytes > BACKUP_MAX_BYTES) {
        out.destroy();
        throw new Error("too_large");
      }
      if (!out.write(chunk as Buffer)) {
        await new Promise<void>((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.once("error", reject);
      out.end(() => resolve());
    });
    return bytes;
  } catch (error) {
    out.destroy();
    throw error;
  }
}

export function registerBackupRoutes(app: Express): void {
  /** Whether the first-run page should offer a restore at all. */
  app.get("/api/backup/available", async (req: Request, res: Response) => {
    try {
      const available = await instanceIsEmptyForRoute();
      res.json({ available });
    } catch {
      res.status(503).json({ available: false });
    }
  });

  /**
   * Creates the signed-in user's backup and streams it back.
   *
   * The body is `{ passphrase }`. The archive is written to a temporary
   * file first, because the zip writer needs a sink it can seek back
   * from when it writes the central directory.
   */
  app.post("/api/backup/download", async (req: Request, res: Response) => {
    const locale = readLocale(req);
    let user: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: copy(locale, "errors.code.unauthorized") });
      return;
    }
    // The app lock covers the backup download too (C8.4): it is the
    // whole database in one file.
    if (await refreshRequestLock(req, user)) {
      res.status(403).json({ error: copy(locale, "errors.locked") });
      return;
    }
    const limit = await rateLimiter.check(String(user.id), RATE_LIMITS.backupDownload);
    if (!limit.allowed) {
      res.status(429).json({ error: copy(locale, "errors.rateLimited") });
      return;
    }
    const passphrase =
      typeof req.body?.passphrase === "string" ? req.body.passphrase : "";
    if (passphrase.length < 8 || passphrase.length > 1024) {
      res.status(400).json({ error: copy(locale, "backup.errorRemotePassphrase") });
      return;
    }

    let temporary: { path: string; fileName: string } | null = null;
    try {
      temporary = await createBackupForDownload({ scope: user.id, passphrase });
      /**
       * A full backup is a precondition for enabling database
       * encryption (C8.5): if the password and the recovery code are
       * both lost, this file is the way back. Recording the marker here
       * is what the enable route checks.
       */
      const { recordFullBackupAt } = await import("../db");
      await recordFullBackupAt(user.id).catch(() => undefined);
      const stat = await fs.stat(temporary.path);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${temporary.fileName}"`,
      );
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "no-store");
      const stream = createReadStream(temporary.path);
      const cleanup = () => {
        void fs.rm(path.dirname(temporary!.path), { recursive: true, force: true });
      };
      stream.on("error", () => {
        cleanup();
        res.destroy();
      });
      res.on("close", cleanup);
      stream.pipe(res);
    } catch (error) {
      if (temporary) {
        await fs.rm(path.dirname(temporary.path), { recursive: true, force: true });
      }
      console.warn("[Backup] The download could not be made:", error);
      res.status(500).json({ error: copy(locale, "backup.downloadFailed") });
    }
  });

  /**
   * Restores a backup into an empty instance.
   *
   * The body is the archive itself (`application/octet-stream`); the
   * passphrase, when the archive is encrypted, is in a header. This is
   * used from the first-run page, where there is no account to sign in
   * with yet.
   */
  app.post("/api/backup/restore", async (req: Request, res: Response) => {
    const locale = readLocale(req);
    const limit = await rateLimiter.check(getClientIp(req), RATE_LIMITS.backupRestore);
    if (!limit.allowed) {
      res.status(429).json({ error: copy(locale, "errors.rateLimited") });
      return;
    }
    try {
      if (!(await instanceIsEmptyForRoute())) {
        res.status(403).json({ error: copy(locale, "backup.errorNotEmpty") });
        return;
      }
    } catch {
      res.status(503).json({ error: copy(locale, "backup.errorFailed") });
      return;
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-restore-body-"));
    const file = path.join(dir, "backup");
    try {
      // The global JSON body parser ignores `application/octet-stream`,
      // so the request stream is still unread here.
      const bytes = await receiveBody(req, file);
      if (bytes === 0) {
        res.status(400).json({ error: copy(locale, "backup.errorMissingFile") });
        return;
      }
      const restored = await restoreBackupForRoute({
        file,
        passphrase: decodePassphrase(req),
      });
      res.json({
        ok: true,
        message: copy(locale, "backup.restored"),
        rows: restored.rows,
        files: restored.files,
        tables: restored.tables,
        createdAt: restored.manifest.createdAt,
        appVersion: restored.manifest.appVersion,
      });
    } catch (error) {
      const mapped = errorKeyFor(error);
      if (mapped.status === 500) console.warn("[Backup] The restore failed:", error);
      res.status(mapped.status).json({ error: copy(locale, mapped.key) });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
