/**
 * The recordings of one persona (B7.3).
 *
 * The soundtrack is a list of what is in the record — with a player,
 * the transcript, and a link to the line it came from. Nothing here
 * synthesises a voice: that is the point.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getPersonaById, listVoices } from "../db";
import { startMediaTranscription, transcriptionStatus } from "../media/transcribe";
import { sttEngine } from "../_core/stt";

function urlOf(fileKey: string): string {
  return `/uploads/${fileKey}`;
}

export const mediaRouter = router({
  listVoices: protectedProcedure
    .input(
      z.object({
        personaId: z.number(),
        q: z.string().max(200).optional(),
        fromThem: z.boolean().optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const page = await listVoices(input.personaId, ctx.user.id, {
        q: input.q,
        fromThem: input.fromThem,
        cursor: input.cursor,
        limit: input.limit,
      });
      return {
        voices: page.rows.map((row) => ({
          id: row.id,
          at: row.at,
          durationSec: row.durationSec,
          fromThem: row.fromThem,
          transcript: row.transcript,
          transcriptEngine: row.transcriptEngine,
          url: urlOf(row.fileKey),
          recordId: row.recordId,
        })),
        nextCursor: page.nextCursor,
      };
    }),

  transcribe: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return startMediaTranscription({
        personaId: input.personaId,
        userId: ctx.user.id,
      });
    }),

  transcribeStatus: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return transcriptionStatus(input.personaId);
    }),

  /** What this machine can do, for the upload and soundtrack pages. */
  capabilities: protectedProcedure.query(() => {
    return { sttEngine: sttEngine() };
  }),
});
