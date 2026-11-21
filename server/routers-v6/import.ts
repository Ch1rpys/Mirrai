/**
 * Turning uploaded files into records.
 *
 * status / preview / confirm / cancel are the wizard's calls. backfill
 * walks old uploads. preview parses and does not write rows.
 */
import { readFile } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isUnparsedChatUpload, RECORD_KINDS, type RecordKind } from "@shared/records";
import { contentLocale, copy } from "@shared/copy";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { assertPersonaWritable } from "../_core/persona-access";
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
import { resolveProviderForPurpose } from "../llm/user-provider";
import { importRecords } from "../collectors/db-store";
import { afterRecordsChanged } from "../_core/style-profile";
import { readScreenshotPages } from "../importers/screenshot";
import { mergeScreenshotPages } from "../importers/screenshot-merge";
import {
  momentPostsToRecords,
  readMomentScreenshots,
  splitMomentText,
} from "../importers/moments";

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
      label: row.label[contentLocale(ctx.locale)] ?? row.label.zh,
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
      const persona = await getPersonaById(file.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertPersonaWritable(persona, ctx.locale);
      /**
       * A monologue has no two sides to name.
       *
       * Every row in it is the persona's own written words, so confirming
       * it needs no roles. Every other format still does.
       */
      const writtenOnly = input.format === "monologue";
      if (
        !writtenOnly
        && (input.me.length === 0 || input.them.length === 0)
      ) {
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
      const persona = await getPersonaById(file.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      assertPersonaWritable(persona, ctx.locale);
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
   * Reads the public register — pasted text or screenshots (B7.12).
   *
   * Nothing is written here. Each post is the persona's own words, and
   * the register is `public`, so the private voice is not touched.
   */
  momentsPreview: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({
      personaId: z.number(),
      text: z.string().max(200_000).optional(),
      date: z.string().max(20).optional(),
      images: z.array(z.object({
        name: z.string().min(1).max(200),
        base64: z.string().min(1).max(14_000_000),
      })).max(30).optional(),
    }).refine(
      (value) => Boolean(value.text?.trim()) || Boolean(value.images?.length),
      { message: "text or images required" },
    ))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const images = input.images ?? [];
      if (images.length > 0) {
        const provider = await resolveProviderForPurpose({
          userId: ctx.user.id,
          purpose: "extract",
        });
        if (!provider || !provider.capabilities.vision) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.screenshotNoVision"),
          });
        }
        const read = await readMomentScreenshots({
          userId: ctx.user.id,
          personaId: input.personaId,
          images,
          provider,
          name: persona.name,
          date: input.date ?? null,
          timeZone: ctx.user.timezone ?? null,
          locale: ctx.locale,
        });
        return {
          posts: read.posts.map((post) => ({
            text: post.text,
            at: post.at ? post.at.toISOString() : null,
            timeApprox: post.timeApprox,
          })),
          failures: read.failures,
        };
      }
      const posts = splitMomentText(input.text ?? "", {
        date: input.date ?? null,
        timeZone: ctx.user.timezone ?? null,
      });
      return {
        posts: posts.map((post) => ({
          text: post.text,
          at: post.at ? post.at.toISOString() : null,
          timeApprox: post.timeApprox,
        })),
        failures: [],
      };
    }),

  /** Writes the moments the user confirmed (B7.12). */
  momentsConfirm: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      posts: z.array(z.object({
        text: z.string().min(1).max(20000),
        at: z.string().nullable(),
      })).min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      let written = 0;
      try {
        written = await importRecords({
          personaId: input.personaId,
          userId: ctx.user.id,
          source: "moments",
          records: momentPostsToRecords(input.posts),
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.importFailed"),
        });
      }
      await afterRecordsChanged({
        personaId: input.personaId,
        userId: ctx.user.id,
        added: written,
      }).catch(() => {});
      return { written };
    }),

  /**
   * Reads a batch of screenshots and returns rows to correct (B7.11).
   *
   * Nothing is written here. The model's reading is a draft; the user
   * sees every row and confirms it before it becomes a record.
   */
  screenshotPreview: protectedProcedure
    .use(rateLimit(RATE_LIMITS.upload))
    .input(z.object({
      personaId: z.number(),
      date: z.string().max(20).optional(),
      images: z.array(z.object({
        name: z.string().min(1).max(200),
        base64: z.string().min(1).max(14_000_000),
      })).min(1).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const provider = await resolveProviderForPurpose({
        userId: ctx.user.id,
        purpose: "extract",
      });
      if (!provider || !provider.capabilities.vision) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.screenshotNoVision"),
        });
      }
      for (const image of input.images) {
        const bytes = Buffer.from(
          image.base64.startsWith("data:") ? image.base64.split(",")[1] ?? "" : image.base64,
          "base64",
        );
        if (bytes.length > 10 * 1024 * 1024) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.screenshotTooLarge"),
          });
        }
      }
      const read = await readScreenshotPages({
        userId: ctx.user.id,
        personaId: input.personaId,
        images: input.images,
        provider,
        name: persona.name,
        locale: ctx.locale,
      });
      const merged = mergeScreenshotPages(read.pages, {
        date: input.date ?? null,
        timeZone: ctx.user.timezone ?? null,
      });
      return {
        rows: merged.rows.map((row) => ({
          ...row,
          at: row.at ? row.at.toISOString() : null,
        })),
        timeApprox: merged.timeApprox,
        needsDate: merged.needsDate,
        failures: read.failures,
        providerName: provider.name,
      };
    }),

  /**
   * Writes the rows the user confirmed (B7.11).
   *
   * The source is `screenshot`, so the records can be found and removed
   * as one import later.
   */
  screenshotConfirm: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      rows: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(20000),
        kind: z.enum(RECORD_KINDS),
        at: z.string().nullable(),
        unclear: z.boolean().optional(),
        /**
         * The time came from the date the user chose, not from a time
         * bar on the screenshot. Stored on the record so a later reader
         * can tell an exact time from an approximation.
         */
        timeApprox: z.boolean().optional(),
      })).min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const records = input.rows.map((row, index) => ({
        speaker: row.role === "user" ? "me" : "them",
        role: row.role,
        content: row.content,
        timestamp: row.at ? new Date(row.at) : null,
        kind: row.kind as RecordKind,
        lineNo: index + 1,
        ...(row.timeApprox ? { meta: { timeApprox: true } } : {}),
      }));
      let written = 0;
      try {
        written = await importRecords({
          personaId: input.personaId,
          userId: ctx.user.id,
          source: "screenshot",
          records,
        });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.importFailed"),
        });
      }
      await afterRecordsChanged({
        personaId: input.personaId,
        userId: ctx.user.id,
        added: written,
      }).catch(() => {});
      return { written };
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
