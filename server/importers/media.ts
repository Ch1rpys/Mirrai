import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { iterateRecords, upsertMedia } from "../db";
import type { Media } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { fileExtension, resolveUploadPath } from "../_core/filename";
import { readImageExif } from "../_core/image-exif";
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

/** The EXIF fields worth keeping: the time is `at`, the place is here. */
function placeOf(exif: { lat: number | null; lng: number | null }): Record<string, number> | null {
  if (exif.lat == null || exif.lng == null) return null;
  return { lat: exif.lat, lng: exif.lng };
}

/**
 * Registers a photograph uploaded on its own, not through an export.
 *
 * The image is already on disk under the persona's directory. This
 * makes it part of the album and reads its camera tags. A failure to
 * read EXIF is not a failure to upload.
 */
export async function registerUploadedImage(params: {
  personaId: number;
  userId: number;
  fileKey: string;
  /** The `persona_files` row this image came from, when there is one. */
  fileId?: number | null;
  buffer: Buffer;
  mime: string;
  timeZone?: string | null;
}): Promise<Media | null> {
  try {
    const exif = await readImageExif(params.buffer, params.timeZone);
    const hash = createHash("sha256").update(params.buffer).digest("hex");
    return await upsertMedia({
      userId: params.userId,
      personaId: params.personaId,
      kind: "photo",
      fileKey: params.fileKey,
      mime: params.mime,
      bytes: params.buffer.length,
      hash,
      at: exif.at ?? new Date(),
      recordId: null,
      fileId: params.fileId ?? null,
      fromThem: false,
      width: exif.width,
      height: exif.height,
      exif: placeOf(exif),
    });
  } catch (error) {
    console.warn("[Import] The uploaded photo could not be registered:", (error as Error).message);
    return null;
  }
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
  /** The user's zone, for the wall clock a camera wrote into EXIF. */
  timeZone?: string | null;
  /**
   * The original names of media files whose stored path redaction
   * replaced (C1.7). The unpacked file keeps its own name for the
   * import; the record only stores the redacted one, so the registrar
   * has to map back to find the bytes. Keys are the redacted relative
   * path, values every original path it replaced — more than one when
   * two names redacted to the same token.
   */
  pathCandidates?: Map<string, string[]>;
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

    /**
     * Find the file the export carried.
     *
     * Usually the stored path is the file's path. After a redacted
     * import the stored path may be `IMG_[phone].jpg` while the file is
     * still `IMG_13800138000.jpg`, so every original candidate is tried
     * in turn; the first one that exists is the file.
     */
    let fileKey: string | null = null;
    let bytes = 0;
    let hash = "";
    for (const candidate of params.pathCandidates?.get(relative) ?? [relative]) {
      const key = `${importUnpackRelKey(params.userId, params.personaId, row.fileId)}/${candidate.replace(/^\/+/, "")}`;
      try {
        const abs = resolveUploadPath(ENV.uploadDir, key);
        const info = await stat(abs);
        if (!info.isFile()) continue;
        bytes = info.size;
        hash = await hashFile(abs);
        fileKey = key;
        break;
      } catch {
        // This candidate is not on disk; try the next original name.
      }
    }
    if (!fileKey) {
      // The export did not carry the file; the text of the row stays.
      skipped += 1;
      continue;
    }

    const duration = Number(meta.durationSec);
    const transcript = typeof meta.transcript === "string" ? meta.transcript : null;
    let at: Date | null = row.timestamp ?? row.createdAt ?? null;
    let width: number | null = null;
    let height: number | null = null;
    let exif: Record<string, number> | null = null;
    if (kind === "photo") {
      /**
       * A picture knows when it was taken better than the export does.
       *
       * The record's time is when the message was sent, which is often
       * a moment later. The camera's time is what a memory dated that
       * afternoon should line up with.
       */
      const read = await readImageExif(resolveUploadPath(ENV.uploadDir, fileKey), params.timeZone);
      if (read.at) at = read.at;
      width = read.width;
      height = read.height;
      exif = placeOf(read);
    }
    try {
      await upsertMedia({
        userId: params.userId,
        personaId: params.personaId,
        kind,
        fileKey,
        mime: mimeForFile(relative),
        bytes,
        hash,
        at,
        recordId: row.id,
        fileId: row.fileId,
        fromThem: row.role === "assistant",
        durationSec: Number.isFinite(duration) ? Math.round(duration) : null,
        width,
        height,
        exif,
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
