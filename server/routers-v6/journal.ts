/**
 * The user's own diary (C4.5).
 *
 * The diary page used to be the app's summary of a conversation. This is
 * the other half: what the person wrote themselves. Those words are never
 * sent to a model, never extracted into memories, and never part of the
 * persona — they are kept, listed and exported, and that is all.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntryById,
  getPersonaById,
  listJournalEntries,
  updateJournalEntry,
} from "../db";
import { isRealDayKey, zonedDateKey } from "@shared/timezone";

const dayKey = z.string().refine(isRealDayKey, { message: "Not a day." });

export const journalRouter = router({
  list: protectedProcedure
    .input(z.object({
      personaId: z.number().optional(),
      cursor: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (input.personaId !== undefined) {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      }
      const rows = await listJournalEntries({
        userId: ctx.user.id,
        personaId: input.personaId ?? null,
        cursor: input.cursor ?? null,
      });
      return {
        entries: rows,
        /** The next page starts below this id; absent on the last page. */
        next: rows.length === 30 ? rows[rows.length - 1].id : null,
      };
    }),

  create: protectedProcedure
    .input(z.object({
      personaId: z.number().optional(),
      body: z.string().trim().min(1).max(20_000),
      mood: z.string().max(16).optional(),
      entryDate: dayKey.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.personaId !== undefined) {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      }
      const id = await createJournalEntry({
        userId: ctx.user.id,
        personaId: input.personaId ?? null,
        body: input.body,
        mood: input.mood ?? null,
        entryDate: input.entryDate ?? zonedDateKey(new Date(), ctx.user.timezone),
      });
      if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      body: z.string().trim().min(1).max(20_000).optional(),
      mood: z.string().max(16).nullable().optional(),
      entryDate: dayKey.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const entry = await getJournalEntryById(input.id, ctx.user.id);
      if (!entry) throw new TRPCError({ code: "NOT_FOUND" });
      const changed = await updateJournalEntry(input.id, ctx.user.id, {
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.mood !== undefined ? { mood: input.mood } : {}),
        ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
      });
      if (!changed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await deleteJournalEntry(input.id, ctx.user.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
});

export default journalRouter;
