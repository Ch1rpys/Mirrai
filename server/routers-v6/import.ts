/**
 * Turning uploaded files into records.
 *
 * status / preview / confirm / cancel are the wizard's calls. backfill
 * walks old uploads. preview parses and does not write rows.
 */
import { readFile } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isUnparsedChatUpload } from "@shared/records";
import { copy } from "@shared/copy";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS } from "../_core/rate-limit";
import { getFilesByPersonaId, getPersonaById, getPersonaFileById } from "../db";
import {
  cancelImport,
  getImportStatus,
  IMPORTERS,
  previewImport,
  startImport,
  type ImportFormatId,
} from "../importers";
import { resolveStoredPath } from "../storage";

const formatIds = IMPORTERS.map((row) => row.id) as [ImportFormatId, ...ImportFormatId[]];
const formatId = z.enum(formatIds);

const columnMap = z.object({
  time: z.number().int().optional(),
  speaker: z.number().int().optional(),
  content: z.number().int(),
  fromMe: z.number().int().optional(),
  fromMeTrue: z.string().optional(),
});

const redaction = z.object({
  phones: z.boolean().optional(),
  ids: z.boolean().optional(),
  emails: z.boolean().optional(),
  cards: z.boolean().optional(),
  names: z.array(z.string()).optional(),
});

export const importRouter = router({
  /**
   * The formats the wizard may offer. A format is listed only when it
   * is in the registry.
   */
  formats: protectedProcedure.query(({ ctx }) => {
    return IMPORTERS.map((row) => ({
      id: row.id,
      label: row.label[ctx.locale] ?? row.label.zh,
    }));
  }),

  status: protectedProcedure
    .input(z.object({ fileId: z.number() }))
    .query(async ({ ctx, input }) => {
      const status = await getImportStatus(input.fileId, ctx.user.id);
      if (!status) throw new TRPCError({ code: "NOT_FOUND" });
      return status;
    }),

  preview: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({
      fileId: z.number(),
      format: formatId.optional(),
      columnMap: columnMap.optional(),
      chatId: z.string().optional(),
      me: z.array(z.string()).optional(),
      them: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const result = await previewImport({
        fileId: input.fileId,
        userId: ctx.user.id,
        locale: ctx.locale,
        format: input.format,
        columnMap: input.columnMap,
        chatId: input.chatId,
        me: input.me,
        them: input.them,
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND" });
      return result;
    }),

  confirm: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({
      fileId: z.number(),
      format: formatId,
      me: z.array(z.string()),
      them: z.array(z.string()),
      chatId: z.string().optional(),
      columnMap: columnMap.optional(),
      redaction: redaction.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const file = await getPersonaFileById(input.fileId, ctx.user.id);
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      if (file.parseStatus === "needs_roles" && (input.me.length === 0 || input.them.length === 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.importRolesRequired"),
        });
      }
      if (input.me.length === 0 || input.them.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.importRolesRequired"),
        });
      }
      return startImport({
        fileId: input.fileId,
        userId: ctx.user.id,
        locale: ctx.locale,
        format: input.format,
        me: input.me,
        them: input.them,
        chatId: input.chatId,
        columnMap: input.columnMap,
        redaction: input.redaction,
      });
    }),

  /**
   * Continues an import that is waiting on format, chat, or a retry.
   *
   * Roles are not required here. confirm is the call that names both
   * sides and is allowed to write.
   */
  resume: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({
      fileId: z.number(),
      format: formatId.optional(),
      chatId: z.string().optional(),
      columnMap: columnMap.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const file = await getPersonaFileById(input.fileId, ctx.user.id);
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      return startImport({
        fileId: input.fileId,
        userId: ctx.user.id,
        locale: ctx.locale,
        format: input.format,
        chatId: input.chatId,
        columnMap: input.columnMap,
      });
    }),

  cancel: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({ fileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const result = await cancelImport(input.fileId, ctx.user.id, ctx.locale);
      if (!result) throw new TRPCError({ code: "NOT_FOUND" });
      return result;
    }),

  /**
   * Walks the persona's old chat uploads into the record table.
   *
   * It is not run on upgrade: a file from before the import path
   * existed may need the user to say who is who. The upload page
   * shows a banner; this is the button.
   */
  backfill: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const files = await getFilesByPersonaId(input.personaId, ctx.user.id);
      const pending = files.filter(isUnparsedChatUpload);
      const results: Array<{ fileId: number; status: string; written: number }> = [];

      for (const file of pending) {
        let bytes: Uint8Array | undefined;
        const diskPath = resolveStoredPath(file.fileKey);
        if (diskPath) {
          try {
            bytes = await readFile(diskPath);
          } catch {
            bytes = undefined;
          }
        }
        const result = await startImport({
          fileId: file.id,
          userId: ctx.user.id,
          bytes,
          locale: ctx.locale,
        });
        results.push({ fileId: file.id, status: result.status, written: result.written });
      }

      return { count: pending.length, results };
    }),
});
