import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { iterateRecords, upsertMedia } from "../db";
import { ENV } from "../_core/env";
import { fileExtension, resolveUploadPath } from "../_core/filename";
import { importUnpackRelKey } from "./archive";

/**
 * The recordings and pictures of a record.
 *
 * The file is not copied: a voice note and a video can be large, and
 * the import directory already holds them. The row points at the
 * file with the same key the uploader reads, so the owner-only upload
 * guard covers the audio without another rule.
 *
 * The identity of a row is the content hash. Importing the same export
 * twice registers the same recording once — and a re-import can bring
 * a transcript without duplicating the row.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".silk": "application/octet-stream",
  ".aud": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
};

const MEDIA_KIND: Record<string, "voice" | "photo" | "video"> = {
  voice: "voice",
  image: "photo",
  video: "video",
};

export function mimeForFile(name: string): string | null {
  return MIME_BY_EXTENSION[fileExtension(name)] ?? null;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export interface RegisterMediaResult {
  registered: number;
  skipped: number;
  total: number;
}

export async function registerMedia(params: {
  personaId: number;
  userId: number;
  /** Only the rows of this upload. Missing means every import of the persona. */
  fileId?: number;
}): Promise<RegisterMediaResult> {
  let registered = 0;
  let skipped = 0;
  let total = 0;

  for await (const row of iterateRecords(params.personaId, params.userId, {
    kinds: ["voice", "image", "video"],
    register: "all",
  })) {
    if (params.fileId != null && row.fileId !== params.fileId) continue;
    total += 1;

    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const relative = typeof meta.path === "string" ? meta.path.trim() : "";
    if (!relative || row.fileId == null) {
      skipped += 1;
      continue;
    }
    const kind = MEDIA_KIND[row.kind ?? ""];
    if (!kind) {
      skipped += 1;
      continue;
    }

    let fileKey: string;
    let bytes: number;
    let hash: string;
    try {
      fileKey = `${importUnpackRelKey(params.userId, params.personaId, row.fileId)}/${relative.replace(/^\/+/, "")}`;
      const abs = resolveUploadPath(ENV.uploadDir, fileKey);
      const info = await stat(abs);
      if (!info.isFile()) {
        skipped += 1;
        continue;
      }
      bytes = info.size;
      hash = await hashFile(abs);
    } catch {
      // The export did not carry the file; the text of the row stays.
      skipped += 1;
      continue;
    }

    const duration = Number(meta.durationSec);
    const transcript = typeof meta.transcript === "string" ? meta.transcript : null;
    try {
      await upsertMedia({
        userId: params.userId,
        personaId: params.personaId,
        kind,
        fileKey,
        mime: mimeForFile(relative),
        bytes,
        hash,
        at: row.timestamp ?? row.createdAt ?? null,
        recordId: row.id,
        fileId: row.fileId,
        fromThem: row.role === "assistant",
        durationSec: Number.isFinite(duration) ? Math.round(duration) : null,
        transcript,
        transcriptEngine: transcript ? "import" : null,
      });
      registered += 1;
    } catch (error) {
      console.warn("[Import] The media row could not be stored:", (error as Error).message);
      skipped += 1;
    }
  }

  return { registered, skipped, total };
}

/** The absolute path of a media row's file, for the transcription task. */
export function mediaAbsPath(fileKey: string): string {
  return resolveUploadPath(ENV.uploadDir, fileKey);
}

/** The name shown to the transcription engine. */
export function mediaFileName(fileKey: string): string {
  return path.basename(fileKey);
}
