/**
 * The user's decisions about the changes the timeline found (C2.5).
 *
 * A turning point is only shown as confirmed or annotated because the
 * user said so. A rejected one is kept in the persona data, so the
 * next recomputation does not put it back.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { withPersonaDataLock } from "../_core/lock";
import { getPersonaById } from "../db";
import { TIMELINE_SERIES, setTurningPointDecision } from "../records/timeline";

/**
 * The changes the user is looking at when they decide (C2.5).
 *
 * They travel with the decision so the page can still show the line and
 * "what changed" after a later run stops detecting the week. The list
 * is small by construction — the detector groups nearby boundaries into
 * at most a handful of series — so the cap only bounds what a client
 * can store on the persona.
 */
const turningChangeSchema = z.object({
  series: z.enum(TIMELINE_SERIES),
  before: z.number(),
  after: z.number(),
});
const turningChangesSchema = z.array(turningChangeSchema).max(12).optional();

export const turningPointRouter = router({
  confirm: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      id: z.string().min(1).max(32),
      note: z.string().max(500).optional(),
      changes: turningChangesSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      return withPersonaDataLock(input.personaId, async () => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const saved = await setTurningPointDecision({
          personaId: input.personaId,
          userId: ctx.user.id,
          id: input.id,
          status: "confirmed",
          note: input.note,
          changes: input.changes,
        });
        if (!saved) throw new TRPCError({ code: "NOT_FOUND" });
        return saved;
      });
    }),

  reject: protectedProcedure
    .input(z.object({ personaId: z.number(), id: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      return withPersonaDataLock(input.personaId, async () => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        /**
         * A rejected point is not shown, so there are no changes to
         * keep for it. The stored changes of a previously confirmed
         * point are kept by `setTurningPointDecision` when none are
         * passed — harmless, and the next confirmation replaces them.
         */
        const saved = await setTurningPointDecision({
          personaId: input.personaId,
          userId: ctx.user.id,
          id: input.id,
          status: "rejected",
        });
        if (!saved) throw new TRPCError({ code: "NOT_FOUND" });
        return saved;
      });
    }),

  annotate: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      id: z.string().min(1).max(32),
      note: z.string().min(1).max(500),
      changes: turningChangesSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      return withPersonaDataLock(input.personaId, async () => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const saved = await setTurningPointDecision({
          personaId: input.personaId,
          userId: ctx.user.id,
          id: input.id,
          status: "confirmed",
          note: input.note,
          changes: input.changes,
        });
        if (!saved) throw new TRPCError({ code: "NOT_FOUND" });
        return saved;
      });
    }),
});
