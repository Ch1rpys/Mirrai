/**
 * How much of the record each generation layer can stand on.
 *
 * Distillation and import both need to know this before they spend a
 * run. The numbers are aggregates; the record itself is not loaded.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildMaterialReport } from "@shared/material-report";
import { normalizeStyleProfile } from "@shared/style-profile";
import { protectedProcedure, router } from "../_core/trpc";
import { getMaterialCounts, getPersonaById } from "../db";

/**
 * The fixed-reply count from the measured ritual table.
 *
 * B2.2's threshold is per trigger (and includes its coverage); the raw
 * SQL count of short exchanges cannot answer that. The measured table
 * is the only thing that can, so the report reads it here.
 */
export function ritualHaveFromStyleProfile(value: unknown): number {
  const rituals = normalizeStyleProfile(value).rituals ?? [];
  return rituals.reduce((max, entry) => Math.max(max, entry.n), 0);
}

export const materialRouter = router({
  report: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const counts = await getMaterialCounts(input.personaId, ctx.user.id);
      /**
       * The fixed-reply layer is the measured ritual table, not every
       * short exchange. `getMaterialCounts` can only aggregate raw
       * pairs; the trigger and coverage thresholds live in B2.2's
       * measured `styleProfile.rituals`.
       */
      return buildMaterialReport({
        ...counts,
        ritualHave: ritualHaveFromStyleProfile(persona.styleProfile),
      });
    }),
});
