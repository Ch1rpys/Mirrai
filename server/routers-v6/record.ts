/**
 * The record table, as a user manages it.
 *
 * sources lists what is in the table. deleteSource drops every row
 * from one collector platform. Deleting an uploaded file is file.delete.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  countRecordsByMonth,
  deleteRecordRow,
  deleteRecordsBySource,
  getFilesByPersonaId,
  getPersonaById,
  getRecordSourceSummary,
  listMediaForRecordIds,
  listRecordMarks,
  pageRecords,
  removeRecordMark,
  upsertRecordMark,
} from "../db";
import { afterRecordsRemoved } from "../_core/style-profile";
import { renderRecordContent } from "@shared/records";
import { findHarmKind, normalizeHarmReport } from "@shared/harm";
import type { ParseReport } from "../importers/types";

export const recordRouter = router({
  sources: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const [summary, files] = await Promise.all([
        getRecordSourceSummary(input.personaId, ctx.user.id),
        getFilesByPersonaId(input.personaId, ctx.user.id),
      ]);
      const byId = new Map(files.map((file) => [file.id, file]));
      return summary.map((row) => {
        const file = row.fileId != null ? byId.get(row.fileId) : undefined;
        const report = (file?.parseReport as ParseReport | null) ?? null;
        return {
          source: row.source,
          fileId: row.fileId,
          name: file?.originalName ?? row.source,
          format: report?.format ?? file?.fileType ?? row.source,
          count: row.count,
          firstAt: row.firstAt?.toISOString() ?? null,
          lastAt: row.lastAt?.toISOString() ?? null,
          status: file?.parseStatus ?? "done",
        };
      });
    }),

  deleteSource: protectedProcedure
    .input(z.object({ personaId: z.number(), source: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const deletedRecords = await deleteRecordsBySource(
        input.personaId,
        ctx.user.id,
        input.source,
      );
      try {
        await afterRecordsRemoved({
          personaId: input.personaId,
          userId: ctx.user.id,
        });
      } catch (error) {
        console.warn("[Import] The rebuild flag could not be updated:", error);
      }
      return { deletedRecords };
    }),

  /**
   * One page of the reader (C2.10).
   *
   * The rows come back already rendered: the reader shows a sticker as
   * ［表情：狗狗探头］, not as the stored marker, and that rendering is
   * the same one the prompt and the export use.
   */
  page: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      anchor: z.union([
        z.object({ recordId: z.number() }),
        z.object({ at: z.string() }),
      ]).optional(),
      direction: z.enum(["older", "newer", "around"]).default("around"),
      limit: z.number().int().min(1).max(200).default(200),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const anchor = input.anchor
        ? "recordId" in input.anchor
          ? { recordId: input.anchor.recordId }
          : { at: new Date(input.anchor.at) }
        : undefined;
      const page = await pageRecords(input.personaId, ctx.user.id, {
        anchor,
        direction: input.direction,
        limit: input.limit,
      });
      const ids = page.rows.map((row) => row.id);
      const [marks, mediaRows] = await Promise.all([
        listRecordMarks(input.personaId, ctx.user.id),
        listMediaForRecordIds(input.personaId, ctx.user.id, ids),
      ]);
      const marksByRecord = new Map<number, Array<{ kind: string; note: string | null }>>();
      for (const mark of marks) {
        const list = marksByRecord.get(mark.recordId) ?? [];
        list.push({ kind: mark.kind, note: mark.note });
        marksByRecord.set(mark.recordId, list);
      }
      const mediaByRecord = new Map(
        mediaRows
          .filter((row) => row.recordId != null)
          .map((row) => [row.recordId as number, row]),
      );
      const report = normalizeHarmReport(
        (persona.personaData as { harmReport?: unknown } | null)?.harmReport,
      );
      const keepHarm = report?.decision === "keep";
      return {
        rows: page.rows.map((row) => {
          const media = mediaByRecord.get(row.id);
          return {
            id: row.id,
            role: row.role,
            speaker: row.speaker,
            kind: row.kind,
            timestamp: (row.timestamp ?? row.createdAt).toISOString(),
            content: renderRecordContent(
              {
                kind: row.kind,
                content: row.content,
                meta: (row.meta ?? null) as Record<string, unknown> | null,
              },
              ctx.locale,
            ),
            source: row.source,
            fileId: row.fileId,
            meta: row.meta ?? null,
            media: media
              ? {
                  url: `/uploads/${media.fileKey}`,
                  kind: media.kind,
                  durationSec: media.durationSec,
                  transcript: media.transcript,
                }
              : null,
            /** C10.1: folded until the user opens it, unless they kept it. */
            harmful: !keepHarm && findHarmKind(row.content) != null,
            marks: marksByRecord.get(row.id) ?? [],
          };
        }),
        hasOlder: page.hasOlder,
        hasNewer: page.hasNewer,
      };
    }),

  /** The chapter list of the reader: months with counts, and the periods. */
  outline: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const months = await countRecordsByMonth(
        input.personaId,
        ctx.user.id,
        ctx.user.timezone,
      );
      const periods = (((persona.personaData as { periods?: unknown } | null)?.periods ?? []) as Array<{
        id?: string;
        label?: string;
        from?: string;
        to?: string;
      }>).map((period) => ({
        id: period.id ?? "",
        label: period.label ?? null,
        from: period.from ?? null,
        to: period.to ?? null,
      }));
      return { months, periods };
    }),

  marks: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const marks = await listRecordMarks(input.personaId, ctx.user.id);
        return marks.map((mark) => ({
          id: mark.id,
          recordId: mark.recordId,
          kind: mark.kind,
          note: mark.note,
          createdAt: mark.createdAt.toISOString(),
          content:
            mark.content == null
              ? null
              : renderRecordContent(
                  { kind: "text", content: mark.content },
                  ctx.locale,
                ),
          timestamp: mark.timestamp?.toISOString() ?? null,
        }));
      }),

    add: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        recordId: z.number(),
        kind: z.enum(["bookmark", "note"]),
        note: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const mark = await upsertRecordMark({
          userId: ctx.user.id,
          personaId: input.personaId,
          recordId: input.recordId,
          kind: input.kind,
          note: input.kind === "note" ? input.note ?? "" : null,
        });
        if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
        return mark;
      }),

    remove: protectedProcedure
      .input(z.object({ personaId: z.number(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const removed = await removeRecordMark(input.id, ctx.user.id, input.personaId);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { removed: true };
      }),
  }),

  /** Removes one line from the record. */
  delete: protectedProcedure
    .input(z.object({ personaId: z.number(), recordId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const deleted = await deleteRecordRow(input.recordId, input.personaId, ctx.user.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        await afterRecordsRemoved({ personaId: input.personaId, userId: ctx.user.id });
      } catch (error) {
        console.warn("[Record] The rebuild flag could not be updated:", error);
      }
      return { deleted: true };
    }),
});
