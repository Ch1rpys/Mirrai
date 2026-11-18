/**
 * How much of the record each generation layer can stand on.
 *
 * Distillation and import both need to know this before they spend a
 * run. The numbers are aggregates; the record itself is not loaded.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildMaterialReport } from "@shared/material-report";
import { protectedProcedure, router } from "../_core/trpc";
import { getMaterialCounts, getPersonaById } from "../db";

export const materialRouter = router({
  report: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const counts = await getMaterialCounts(input.personaId, ctx.user.id);
      return buildMaterialReport(counts);
    }),
});
