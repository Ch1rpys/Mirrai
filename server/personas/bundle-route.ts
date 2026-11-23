/**
 * The two streaming routes of the persona bundle (C9.5).
 *
 * An export is a file, not JSON; an import is a file being uploaded. tRPC
 * has no streaming, so both live here as plain Express routes — the same
 * shape as the backup's download/restore pair (C8.3).
 *
 * Security notes:
 *
 *  - the export is the signed-in user's own persona: the id is checked
 *    against the account before anything is written;
 *  - the import always creates a persona for the caller, whatever the
 *    bundle's manifest says about where it came from;
 *  - a passphrase travels base64-encoded in a header, never in the URL.
 */
import type { Express, Request, Response } from "express";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { copy } from "@shared/copy";
import { authenticateRequest } from "../_core/auth";
import { refreshRequestLock } from "../_core/app-lock";
import { readLocale } from "../_core/context";
import { RATE_LIMITS, rateLimiter } from "../_core/rate-limit";
import { isEncryptionLocked } from "../encryption/lock";
import {
  exportPersonaBundle,
  importPersonaBundle,
} from "./bundle";
import { PERSONA_BUNDLE_MAX_BYTES } from "../_core/bundle";

/** The passphrase header, base64 of the UTF-8 bytes. */
export const BUNDLE_PASSPHRASE_HEADER = "x-mirrai-bundle-passphrase";

const includeSchema = z.object({
  memories: z.boolean().optional(),
  records: z.boolean().optional(),
  conversation: z.boolean().optional(),
});

const exportSchema = z.object({
  personaId: z.number().int().positive(),
  include: includeSchema.optional(),
  passphrase: z.string().min(8).max(1024).nullish(),
});

function decodePassphrase(req: Request): string | null {
  const raw = req.headers[BUNDLE_PASSPHRASE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    return decoded || null;
  } catch {
    return null;
  }
}

/**
 * A `Content-Disposition` that survives a Chinese persona name.
 *
 * HTTP header values are bytes; a raw UTF-8 name is rejected by Node's
 * own `setHeader` and the export fails with a 500. The ASCII form is the
 * fallback for old clients, the RFC 5987 form carries the real name.
 */
export function dispositionFor(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Writes the request body to a temporary file, refusing an oversized one. */
async function receiveBody(req: Request, file: string): Promise<number> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const out = createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      if (bytes > PERSONA_BUNDLE_MAX_BYTES) {
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

export function registerPersonaBundleRoutes(app: Express): void {
  /**
   * Exports one persona as a `.mirrai-persona` file.
   *
   * The body is `{ personaId, include, passphrase }`. The archive is
   * written to a temporary file first and then streamed, because the zip
   * writer needs a sink it can seek back from when it writes the central
   * directory.
   */
  app.post("/api/persona/bundle", async (req: Request, res: Response) => {
    const locale = readLocale(req);
    let user: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: copy(locale, "errors.code.unauthorized") });
      return;
    }
    if (await refreshRequestLock(req, user)) {
      res.status(403).json({ error: copy(locale, "errors.locked") });
      return;
    }
    const limit = await rateLimiter.check(String(user.id), RATE_LIMITS.backupDownload);
    if (!limit.allowed) {
      res.status(429).json({ error: copy(locale, "errors.rateLimited") });
      return;
    }
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: copy(locale, "errors.bundleCorrupt") });
      return;
    }
    const include = {
      memories: parsed.data.include?.memories === true,
      records: parsed.data.include?.records === true,
      conversation: parsed.data.include?.conversation === true,
    };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-bundle-out-"));
    try {
      const outPath = path.join(dir, "persona-bundle");
      const written = await exportPersonaBundle({
        personaId: parsed.data.personaId,
        userId: user.id,
        include,
        passphrase: parsed.data.passphrase ?? null,
        outPath,
      });
      const stat = await fs.stat(outPath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", dispositionFor(written.fileName));
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("Cache-Control", "no-store");
      const stream = createReadStream(outPath);
      const cleanup = () => {
        void fs.rm(dir, { recursive: true, force: true });
      };
      stream.on("error", () => {
        cleanup();
        res.destroy();
      });
      res.on("close", cleanup);
      stream.pipe(res);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if ((error as Error).message === "Persona not found") {
        res.status(404).json({ error: copy(locale, "errors.bundleNoPersona") });
        return;
      }
      console.warn("[Bundle] The export could not be made:", error);
      res.status(500).json({ error: copy(locale, "errors.bundleFailed") });
    }
  });

  /**
   * Imports a bundle as a new persona.
   *
   * The body is the file itself (`application/octet-stream`); the
   * passphrase, when there is one, is in a header. A failure leaves no
   * persona and no copied file behind.
   */
  app.put("/api/persona/import-bundle", async (req: Request, res: Response) => {
    const locale = readLocale(req);
    let user: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: copy(locale, "errors.code.unauthorized") });
      return;
    }
    if (await refreshRequestLock(req, user)) {
      res.status(403).json({ error: copy(locale, "errors.locked") });
      return;
    }
    if (await isEncryptionLocked(user.id).catch(() => false)) {
      res.status(423).json({ error: copy(locale, "errors.bundleEncryptionLocked") });
      return;
    }
    const limit = await rateLimiter.check(String(user.id), RATE_LIMITS.upload);
    if (!limit.allowed) {
      res.status(429).json({ error: copy(locale, "errors.rateLimited") });
      return;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-bundle-in-"));
    const file = path.join(dir, "bundle");
    try {
      const bytes = await receiveBody(req, file);
      if (bytes === 0) {
        res.status(400).json({ error: copy(locale, "errors.bundleCorrupt") });
        return;
      }
      const imported = await importPersonaBundle({
        userId: user.id,
        filePath: file,
        passphrase: decodePassphrase(req),
      });
      res.status(201).json({
        ok: true,
        personaId: imported.personaId,
        name: imported.name,
        counts: imported.counts,
      });
    } catch (error) {
      const name = error instanceof Error ? error.constructor.name : "";
      if (name === "BackupPassphraseError") {
        const kind = (error as { kind?: string }).kind;
        res.status(400).json({
          error: copy(
            locale,
            kind === "passphrase_required"
              ? "errors.bundlePassphraseRequired"
              : "errors.bundleWrongPassphrase",
          ),
        });
        return;
      }
      if (name === "BackupFormatError") {
        res.status(400).json({ error: copy(locale, "errors.bundleCorrupt") });
        return;
      }
      if ((error as Error).message === "too_large") {
        res.status(413).json({ error: copy(locale, "errors.bundleTooLarge") });
        return;
      }
      console.warn("[Bundle] The import failed:", error);
      res.status(500).json({ error: copy(locale, "errors.bundleImportFailed") });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
