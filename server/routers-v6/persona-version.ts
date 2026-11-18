/**
 * The snapshots of a persona.
 *
 * Distillation, a full edit, a correction, and a restore each store
 * one before they write. The list is those snapshots; diff is one of
 * them against the persona as it is now; restore writes the four
 * columns back as a set, after storing the current one.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { withPersonaDataLock } from "../_core/lock";
import {
  createPersonaVersion,
  getEvalRunsByIds,
  getPersonaById,
  getPersonaVersion,
  listPersonaVersions,
  updatePersona,
} from "../db";
import { diffPersonaData } from "@shared/persona-versions";

function overlapFromMetrics(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const value = (metrics as Record<string, unknown>).overlap;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const personaVersionRouter = router({
  list: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.id, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const versions = await listPersonaVersions(input.id, ctx.user.id);
      const runIds = versions
        .map((row) => row.evalRunId)
        .filter((id): id is number => typeof id === "number");
      const runs = await getEvalRunsByIds(runIds, ctx.user.id);
      const overlapByRun = new Map(
        runs.map((run) => [run.id, overlapFromMetrics(run.metricsJson)]),
      );
      return {
        versions: versions.map((row) => ({
          id: row.id,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
          evalRunId: row.evalRunId,
          overlap:
            row.evalRunId != null ? (overlapByRun.get(row.evalRunId) ?? null) : null,
        })),
      };
    }),

  diff: protectedProcedure
    .input(z.object({ id: z.number(), versionId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.id, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const version = await getPersonaVersion(input.versionId, ctx.user.id);
      if (!version || version.personaId !== input.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return diffPersonaData(version.personaData, persona.personaData);
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.number(), versionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return await withPersonaDataLock(input.id, async () => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const version = await getPersonaVersion(input.versionId, ctx.user.id);
        if (!version || version.personaId !== input.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await createPersonaVersion(input.id, ctx.user.id, "restore");
        const written = await updatePersona(input.id, ctx.user.id, {
          personaData: version.personaData,
          styleProfile: version.styleProfile,
          behaviorProfile: version.behaviorProfile,
          settings: version.settings,
        });
        if (!written) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      });
    }),
});
