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
import { getPersonaById, listMedia, listVoices } from "../db";
import { startMediaTranscription, transcriptionStatus } from "../media/transcribe";
import { sttEngine } from "../_core/stt";
import { measureProsody } from "../_core/prosody";
import { faceModelsAvailable } from "../_core/face-models";
import { assertPersonaWritable } from "../_core/persona-access";
import { resolveRecordScope } from "@shared/persona-sharing";

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
      /**
       * A shared persona's recordings are the owner's (C7.2): the family
       * member gets the same real voice, not an empty shelf. The uploads
       * guard lets them fetch those files while the share is active.
       */
      const scope = resolveRecordScope(persona);
      const page = await listVoices(scope.personaId, scope.userId, {
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

  /**
   * The photographs of one persona (B7.8).
   *
   * Newest first, with the camera's time when it had one. This is the
   * album, the avatar picker's source, and the memory panel's photos —
   * all from the same `media` rows.
   */
  listPhotos: protectedProcedure
    .input(z.object({ personaId: z.number(), limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await listMedia(input.personaId, ctx.user.id, { kind: "photo" });
      return {
        photos: rows.slice(0, input.limit).map((row) => ({
          id: row.id,
          url: urlOf(row.fileKey),
          at: row.at,
          width: row.width,
          height: row.height,
          fromThem: row.fromThem,
        })),
        total: rows.length,
      };
    }),

  transcribe: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      // The transcriptions land on the owner's recordings (C7.2).
      assertPersonaWritable(persona, ctx.locale);
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

  /**
   * Measures how the person speaks from the transcribed recordings.
   *
   * Needs at least eight transcribed voice notes; the rate is measured
   * without ffmpeg, the pauses are not.
   */
  measureProsody: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      // A measurement writes the owner's style profile (C7.2).
      assertPersonaWritable(persona, ctx.locale);
      const prosody = await measureProsody({
        personaId: input.personaId,
        userId: ctx.user.id,
      });
      return { prosody };
    }),

  /** What this machine can do, for the upload and soundtrack pages. */
  capabilities: protectedProcedure.query(() => {
    return {
      sttEngine: sttEngine(),
      /** Whether the face weights are on disk; the picker hides the button when not. */
      faceModels: faceModelsAvailable(),
    };
  }),
});
