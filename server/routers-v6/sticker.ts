/**
 * The sticker library of one persona (B7.1).
 *
 * A sticker is shown because the person used it, never because a pack
 * was bundled. So this group can say how many times each one was used,
 * turn one off, remove one, and add a picture to one that the export
 * only gave a name for.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import {
  deleteSticker,
  getPersonaById,
  listStickers,
  setStickerEnabled,
  setStickerImage,
  upsertSticker,
} from "../db";
import { storageDelete, storagePut } from "../storage";
import {
  STICKER_LIBRARY_MAX,
  STICKER_MAX_BYTES,
} from "../importers/stickers";

const MAX_BASE64_CHARS = Math.ceil(STICKER_MAX_BYTES / 3) * 4;

/** What kind of picture the bytes are, or null when it is not one we take. */
export function sniffImageType(bytes: Buffer): { extension: string; mime: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mime: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: ".jpg", mime: "image/jpeg" };
  }
  if (bytes.length >= 6 && bytes.subarray(0, 4).toString("ascii") === "GIF8") {
    return { extension: ".gif", mime: "image/gif" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: ".webp", mime: "image/webp" };
  }
  return null;
}

function urlOf(fileKey: string | null): string | null {
  return fileKey ? `/uploads/${fileKey}` : null;
}

export const stickerRouter = router({
  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await listStickers(input.personaId, ctx.user.id);
      return {
        stickers: rows.map((row) => ({
          id: row.id,
          key: row.key,
          label: row.label,
          usesByThem: row.usesByThem,
          usesByMe: row.usesByMe,
          enabled: row.enabled,
          imageUrl: urlOf(row.fileKey),
          lastUsedAt: row.lastUsedAt,
        })),
        limit: STICKER_LIBRARY_MAX,
      };
    }),

  setEnabled: protectedProcedure
    .input(
      z.object({
        personaId: z.number(),
        stickerId: z.number(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const row = await setStickerEnabled(
        input.personaId,
        ctx.user.id,
        input.stickerId,
        input.enabled,
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return { enabled: row.enabled };
    }),

  delete: protectedProcedure
    .input(z.object({ personaId: z.number(), stickerId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const row = await deleteSticker(input.personaId, ctx.user.id, input.stickerId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.fileKey) await storageDelete(row.fileKey);
      return { deleted: true };
    }),

  /**
   * Gives a name-only sticker a picture.
   *
   * The export names a sticker but does not always carry the image. The
   * person choosing one can supply it, and it is stored as a copy like
   * every other sticker.
   */
  upload: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(
      z.object({
        personaId: z.number(),
        label: z.string().min(1).max(64),
        base64: z.string().max(MAX_BASE64_CHARS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.stickerImage") });
      }
      if (bytes.length > STICKER_MAX_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.fileTooLarge") });
      }
      const type = sniffImageType(bytes);
      if (!type) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.stickerImage"),
        });
      }

      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
      const fileKey = `personas/${ctx.user.id}/${input.personaId}/stickers/${hash}${type.extension}`;
      const rows = await listStickers(input.personaId, ctx.user.id);
      const existing = rows.find(
        (row) => row.label === input.label || row.key === `label:${input.label}`,
      );
      if (!existing && rows.length >= STICKER_LIBRARY_MAX) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.stickerLimit", { max: STICKER_LIBRARY_MAX }) });
      }

      await storagePut(fileKey, bytes, type.mime);
      if (existing) {
        await setStickerImage(input.personaId, ctx.user.id, existing.id, {
          fileKey,
          mime: type.mime,
        });
        /**
         * A replacement makes the old copy dead. It was left in the
         * uploads directory for ever because only the row was updated.
         */
        if (existing.fileKey && existing.fileKey !== fileKey) {
          await storageDelete(existing.fileKey);
        }
        return { stickerId: existing.id, imageUrl: urlOf(fileKey) };
      }
      const created = await upsertSticker({
        userId: ctx.user.id,
        personaId: input.personaId,
        key: hash,
        label: input.label,
        fileKey,
        mime: type.mime,
        usesByThem: 0,
        usesByMe: 0,
      });
      return { stickerId: created.id, imageUrl: urlOf(fileKey) };
    }),
});
