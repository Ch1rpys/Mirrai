/**
 * The inference view (C10.6).
 *
 * One read that returns everything the app worked out about the user and
 * each of their personas, and one write that drops a candidate the user
 * does not want. The building of the lists is in `server/inference/list.ts`
 * so it can be tested without a database; this file only gathers.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { withPersonaDataLock } from "../_core/lock";
import { normalizePersonaSettings } from "@shared/persona-settings";
import {
  getMemoriesByPersonaId,
  getPersonaById,
  getPersonasByUserId,
  getRecentCheckinAnswers,
  getRecentEmotionTrend,
  getRecentUserMood,
  getSafetyEvents,
  getUserById,
  updatePersona,
} from "../db";
import { getStoredTrajectory } from "../safety/trajectory";
import {
  buildInferenceSections,
  REJECTABLE_CANDIDATE_KINDS,
  type RejectableCandidateKind,
} from "../inference/list";

/**
 * Drops a candidate from the persona data under the same lock every other
 * persona-data write takes.
 *
 * It removes the row rather than marking it rejected: the user said they
 * do not want this candidate, and a re-run of the miner would otherwise
 * put it back. A confirmed row is left alone — the page only offers the
 * rejection on unverified candidates.
 */
async function rejectCandidate(
  personaId: number,
  userId: number,
  kind: RejectableCandidateKind,
  key: string,
): Promise<boolean> {
  const persona = await getPersonaById(personaId, userId);
  if (!persona) return false;
  const data = ((persona.personaData as Record<string, unknown> | null) ?? {});
  const rows = Array.isArray(data[kind]) ? [...(data[kind] as Array<Record<string, unknown>>)] : [];
  if (rows.length === 0) return false;
  const kept = rows.filter((row) => String(row.id ?? "") !== key);
  if (kept.length === rows.length) return false;
  await updatePersona(personaId, userId, {
    personaData: { ...data, [kind]: kept },
  });
  return true;
}

export const inferenceRouter = router({
  /**
   * Both blocks, in one response.
   *
   * The user's own account is scoped by the session; the personas are
   * only that account's. Nothing here takes an id from the client, so
   * there is no id to point at somebody else's data.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = await getUserById(ctx.user.id).catch(() => null);
    const personas = await getPersonasByUserId(ctx.user.id).catch(() => []);
    const entries = await Promise.all(personas.map(async (persona) => {
      const [memories, emotionTrend, checkins] = await Promise.all([
        getMemoriesByPersonaId(persona.id, ctx.user.id, 200).catch(() => []),
        getRecentEmotionTrend(persona.id, ctx.user.id, 14, (user as { timezone?: string | null } | null)?.timezone ?? null)
          .catch(() => []),
        getRecentCheckinAnswers(ctx.user.id, persona.id, 5).catch(() => []),
      ]);
      return {
        persona,
        memories,
        emotionTrend,
        checkins,
        disabledProfiles: normalizePersonaSettings(
          (persona as { settings?: unknown }).settings,
        ).disabledProfiles ?? [],
      };
    }));
    const [mood, safetyEvents, trajectories] = await Promise.all([
      getRecentUserMood(ctx.user.id).catch(() => null),
      getSafetyEvents(ctx.user.id, 30).catch(() => []),
      Promise.all(personas.map((persona) => (
        getStoredTrajectory(persona.id, ctx.user.id).catch(() => null)
      ))),
    ]);
    const latestTrajectory = trajectories
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;

    return {
      sections: buildInferenceSections({
        user: {
          addressStyle: (user as { addressStyle?: string | null } | null)?.addressStyle ?? null,
          boundaries: (user as { boundaries?: string | null } | null)?.boundaries ?? null,
          trajectoryAssessment: (user as { trajectoryAssessment?: string | null } | null)?.trajectoryAssessment ?? null,
          trajectoryLatest: latestTrajectory
            ? `${latestTrajectory.trajectory} (${new Date(latestTrajectory.createdAt).toISOString().slice(0, 10)})`
            : null,
          mood: mood
            ? { date: String(mood.date), mood: String(mood.mood), note: mood.note ?? null }
            : null,
          safetyEvents: safetyEvents.map((event) => ({
            type: event.type,
            severity: event.severity,
            createdAt: event.createdAt,
          })),
          checkins: entries.flatMap((entry) => entry.checkins.map((row) => ({
            answer: row.answer,
            personaName: String(entry.persona.name ?? ""),
            createdAt: row.createdAt,
          }))),
        },
        personas: entries.map((entry) => ({
          persona: {
            id: entry.persona.id,
            name: String(entry.persona.name ?? ""),
            personaData: entry.persona.personaData,
            styleProfile: entry.persona.styleProfile,
            settings: entry.persona.settings,
          },
          memories: entry.memories.map((memory) => ({
            id: memory.id,
            title: memory.title,
            description: memory.description,
            category: memory.category,
            subject: memory.subject,
            source: memory.source,
          })),
          emotionTrend: entry.emotionTrend,
          disabledProfiles: entry.disabledProfiles,
        })),
      }),
    };
  }),

  /** Removes one unconfirmed candidate from a persona. */
  rejectCandidate: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      candidateKind: z.enum(REJECTABLE_CANDIDATE_KINDS),
      key: z.string().min(1).max(120),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return await withPersonaDataLock(input.personaId, async () => {
        const removed = await rejectCandidate(
          input.personaId,
          ctx.user.id,
          input.candidateKind,
          input.key,
        );
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { removed: true };
      });
    }),
});
