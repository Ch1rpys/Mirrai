import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { countStickers, iterateRecords, listStickers, upsertSticker } from "../db";
import { ENV } from "../_core/env";
import { fileExtension, resolveUploadPath } from "../_core/filename";
import { storagePut } from "../storage";
import { importUnpackRelKey } from "./archive";
import { pathCandidatesFor, type RedactedMediaPathCandidates } from "./media";

/**
 * The stickers the record says they used.
 *
 * The library is copied out of the import directory on purpose: an
 * import can be deleted, and a persona that sends `[sticker:狗狗探头]`
 * has to still have it. Only what is in the record is registered —
 * there is no pack of default stickers, because a persona who never
 * sent one would then start sending them.
 */

export const STICKER_MAX_BYTES = 2 * 1024 * 1024;
export const STICKER_LIBRARY_MAX = 500;
const STICKER_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface StickerRowLike {
  role: string;
  kind?: string | null;
  content?: string | null;
  timestamp?: Date | string | null;
  fileId?: number | null;
  lineNo?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface StickerGroup {
  /** The name as it was written, or empty when the record gives none. */
  label: string;
  usesByThem: number;
  usesByMe: number;
  firstUsedAt: Date | null;
  lastUsedAt: Date | null;
  /** The first row whose `meta.path` points at something on disk. */
  image: { fileId: number | null; relativePath: string; lineNo: number | null } | null;
}

function at(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tokenLabel(content: string | null | undefined): string {
  const match = String(content ?? "").trim().match(/^\[sticker(?::([^\]]*))?\]$/i);
  return match?.[1]?.trim() ?? "";
}

/** What this row calls the sticker: the export's label, its key, or the token. */
export function stickerName(row: StickerRowLike): string {
  const label = typeof row.meta?.label === "string" ? row.meta.label.trim() : "";
  if (label) return label;
  const fromToken = tokenLabel(row.content);
  if (fromToken) return fromToken;
  const key = typeof row.meta?.stickerKey === "string" ? row.meta.stickerKey.trim() : "";
  return key;
}

/**
 * Groups the sticker rows by what they are called.
 *
 * The key is computed from the image when there is one, so this first
 * pass can only group by name; `registerStickers` adds the hash. Two
 * different pictures under one name stay one sticker — the record does
 * not say which picture went with which line, and guessing would put
 * the wrong picture in an answer.
 */
export function groupStickerRows(rows: StickerRowLike[]): StickerGroup[] {
  const groups = new Map<string, StickerGroup>();
  for (const row of rows) {
    if ((row.kind ?? "text") !== "sticker") continue;
    const label = stickerName(row);
    const group = groups.get(label) ?? {
      label,
      usesByThem: 0,
      usesByMe: 0,
      firstUsedAt: null,
      lastUsedAt: null,
      image: null,
    };
    if (row.role === "assistant") group.usesByThem += 1;
    else if (row.role === "user") group.usesByMe += 1;
    const when = at(row.timestamp);
    if (when) {
      if (!group.firstUsedAt || when < group.firstUsedAt) group.firstUsedAt = when;
      if (!group.lastUsedAt || when > group.lastUsedAt) group.lastUsedAt = when;
    }
    const relativePath = typeof row.meta?.path === "string" ? row.meta.path : "";
    if (!group.image && relativePath) {
      group.image = {
        fileId: row.fileId ?? null,
        relativePath,
        lineNo: typeof row.lineNo === "number" ? row.lineNo : null,
      };
    }
    groups.set(label, group);
  }
  return [...groups.values()];
}

async function absoluteMediaPath(
  userId: number,
  personaId: number,
  group: StickerGroup,
  pathCandidates?: RedactedMediaPathCandidates,
): Promise<string | null> {
  if (!group.image) return null;
  const base = group.image.fileId != null
    ? `${importUnpackRelKey(userId, personaId, group.image.fileId)}/`
    : "";
  /**
   * The stored path may be the redacted one (C1.7): the picture on disk
   * still has the name the export gave it. The row's own line picks its
   * original out of the list, so two names that redacted to one token
   * are not confused for each other.
   */
  for (const relativePath of pathCandidatesFor(
    pathCandidates,
    group.image.relativePath,
    group.image.lineNo,
  )) {
    try {
      const abs = resolveUploadPath(ENV.uploadDir, `${base}${relativePath}`);
      const info = await stat(abs);
      if (info.isFile()) return abs;
    } catch {
      // Not this name; try the next original.
    }
  }
  return null;
}

export interface RegisterStickersResult {
  registered: number;
  copied: number;
  skipped: number;
  total: number;
}

/**
 * Registers the stickers of one persona from its records.
 *
 * Called after an import finishes. A failure here is not a failed
 * import: the records are already written, and the library can be
 * rebuilt from them.
 */
export async function registerStickers(params: {
  personaId: number;
  userId: number;
  /**
   * The original names of sticker files whose stored path redaction
   * replaced (C1.7). Keys are the redacted relative path; values are
   * the original names, tagged with the line that wrote them.
   */
  pathCandidates?: RedactedMediaPathCandidates;
}): Promise<RegisterStickersResult> {
  const rows: StickerRowLike[] = [];
  for await (const row of iterateRecords(params.personaId, params.userId, {
    kinds: ["sticker"],
    // Group chats and moments use stickers too; the library is about
    // what the person sends, wherever they sent it.
    register: "all",
  })) {
    rows.push(row as StickerRowLike);
  }

  const groups = groupStickerRows(rows);
  const existing = await listStickers(params.personaId, params.userId);
  const existingKeys = new Set(existing.map((row) => row.key));
  /**
   * The already-registered sticker for each name (C1.7).
   *
   * This scan covers the whole persona, so it re-reads rows an earlier
   * redacted import wrote. Those rows name a file inside an import
   * directory that is now gone; the picture itself was copied out under
   * a hash when it was registered. Reusing that row keeps one sticker
   * per name instead of adding an image-less `label:` duplicate of it
   * on every later import.
   */
  const existingByLabel = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    if (!existingByLabel.has(row.label)) existingByLabel.set(row.label, row);
  }
  let registered = 0;
  let copied = 0;
  let skipped = 0;

  for (const group of groups) {
    let key = `label:${group.label}`;
    let fileKey: string | null = null;
    let mime: string | null = null;
    let imageBytes: Buffer | null = null;

    const sourcePath = await absoluteMediaPath(
      params.userId,
      params.personaId,
      group,
      params.pathCandidates,
    );
    if (sourcePath) {
      const extension = fileExtension(sourcePath);
      if ((STICKER_EXTENSIONS as readonly string[]).includes(extension)) {
        try {
          const bytes = await readFile(sourcePath);
          if (bytes.length > 0 && bytes.length <= STICKER_MAX_BYTES) {
            const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
            key = hash;
            fileKey = `personas/${params.userId}/${params.personaId}/stickers/${hash}${extension}`;
            mime = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
            imageBytes = bytes;
          } else {
            skipped += 1;
          }
        } catch {
          // The export did not carry the picture; the name is still useful.
        }
      } else {
        skipped += 1;
      }
    }

    if (imageBytes && fileKey && mime) {
      if (!existingKeys.has(key) && existingKeys.size >= STICKER_LIBRARY_MAX) {
        skipped += 1;
        continue;
      }
      try {
        await storagePut(fileKey, imageBytes, mime);
        copied += 1;
      } catch {
        fileKey = null;
        mime = null;
        key = `label:${group.label}`;
      }
    }

    /**
     * No picture this time: keep the row that already has one (C1.7).
     *
     * Either the source is gone with its import directory or its bytes
     * were unusable. The name is the identity of a sticker here, and the
     * library already has a row under that name — the one the earlier
     * import registered with its copied picture. Writing a `label:` key
     * now would add a second, image-less sticker with the same name; the
     * uses and timestamps belong on the existing row instead.
     */
    if (key === `label:${group.label}`) {
      const sameLabel = existingByLabel.get(group.label);
      if (sameLabel) {
        key = sameLabel.key;
        fileKey = sameLabel.fileKey ?? null;
        mime = sameLabel.mime ?? null;
      }
    }

    if (!existingKeys.has(key) && existingKeys.size >= STICKER_LIBRARY_MAX) {
      skipped += 1;
      continue;
    }

    await upsertSticker({
      userId: params.userId,
      personaId: params.personaId,
      key,
      label: group.label.slice(0, 64),
      fileKey,
      mime,
      usesByThem: group.usesByThem,
      usesByMe: group.usesByMe,
      firstUsedAt: group.firstUsedAt,
      lastUsedAt: group.lastUsedAt,
    });
    existingKeys.add(key);
    registered += 1;
  }

  return { registered, copied, skipped, total: groups.length };
}

/** How many stickers this persona has, for the upload cap. */
export async function stickerLibrarySize(personaId: number, userId: number): Promise<number> {
  return countStickers(personaId, userId);
}
