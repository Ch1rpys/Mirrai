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
import { setTurningPointDecision } from "../records/timeline";

export const turningPointRouter = router({
  confirm: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      id: z.string().min(1).max(32),
      note: z.string().max(500).optional(),
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
        });
        if (!saved) throw new TRPCError({ code: "NOT_FOUND" });
        return saved;
      });
    }),
});
