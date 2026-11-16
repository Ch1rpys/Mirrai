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
  deleteRecordsBySource,
  getFilesByPersonaId,
  getPersonaById,
  getRecordSourceSummary,
} from "../db";
import { afterRecordsRemoved } from "../_core/style-profile";
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
});
