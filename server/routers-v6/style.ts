/**
 * The measurements taken from a persona's records.
 *
 * A new route group, mounted on `appRouter` as `style`. Measuring at
 * P0.4 only writes version, measuredAt and recordsVersion; later entries
 * fill the rest.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getPersonaById, getPersonaStyleProfile } from "../db";
import { measureStyleProfile } from "../_core/style-profile";
import { normalizeStyleProfile } from "@shared/style-profile";

export const styleRouter = router({
  get: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const stored = await getPersonaStyleProfile(input.personaId, ctx.user.id);
      return { profile: stored ?? normalizeStyleProfile(null) };
    }),

  measure: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const profile = await measureStyleProfile({
        personaId: input.personaId,
        userId: ctx.user.id,
      });
      return { profile };
    }),
});
