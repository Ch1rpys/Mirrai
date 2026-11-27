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
import { embedModelName, probeEmbedStatus, schedulePersonaEmbeddings } from "../chat/embeddings";

export const styleRouter = router({
  get: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const stored = await getPersonaStyleProfile(input.personaId, ctx.user.id);
      return { profile: stored ? normalizeStyleProfile(stored) : normalizeStyleProfile(null) };
    }),

  measure: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      /**
       * An explicit measurement measures again.
       *
       * The automatic calls after an import or a distillation skip when
       * `recordsVersion` has not moved — they are a cache, not a user
       * request. This route is the user asking "measure it now": skipping
       * it left an old profile without the fields a newer measurement
       * knows how to fill (B9.3's `never` is one), silently. It mirrors
       * `behavior.measure`, which also measures unconditionally.
       */
      const profile = await measureStyleProfile({
        personaId: input.personaId,
        userId: ctx.user.id,
        force: true,
      });
      schedulePersonaEmbeddings(input.personaId, ctx.user.id);
      return { profile };
    }),

  embedStatus: protectedProcedure.query(async () => {
    const status = await probeEmbedStatus();
    return { status, model: embedModelName() };
  }),
});
