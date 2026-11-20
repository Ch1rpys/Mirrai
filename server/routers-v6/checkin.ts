/**
 * The question after the conversation (C4.2).
 *
 * It is asked once per session, at most once a day, and only when the
 * conversation has clearly ended. The answer is the user's own report,
 * not an inference: the app does not score it.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  CHECKIN_ANSWERS,
  pendingCheckin,
  recordWorseSuggestion,
  worseSuggestion,
} from "../safety/checkins";
import {
  createSessionCheckin,
  getPersonaById,
  getRecentCheckinAnswers,
} from "../db";

export const checkinRouter = router({
  /** What should be asked now, if anything. */
  pending: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const now = new Date();
      const pending = await pendingCheckin({
        userId: ctx.user.id,
        personaId: input.personaId,
        now,
      });
      return {
        pending: pending
          ? { sessionStartAt: pending.sessionStartAt.toISOString() }
          : null,
        /**
         * Whether to show the "three worse in a row" card.
         *
         * The card records that it was shown through
         * `checkin.acknowledgeWorse`; asking again returns false.
         */
        worse: await worseSuggestion({
          userId: ctx.user.id,
          personaId: input.personaId,
          now,
        }),
      };
    }),

  /** One of the four buttons. */
  answer: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      sessionStartAt: z.string().datetime(),
      answer: z.enum(CHECKIN_ANSWERS),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const now = new Date();
      const pending = await pendingCheckin({
        userId: ctx.user.id,
        personaId: input.personaId,
        now,
      });
      // The answer has to be about the session the app is asking about.
      // A stale page can try to answer a session that has been answered
      // or that was never due; neither is a write.
      if (!pending || pending.sessionStartAt.toISOString() !== input.sessionStartAt) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      await createSessionCheckin({
        userId: ctx.user.id,
        personaId: input.personaId,
        sessionStartAt: pending.sessionStartAt,
        answer: input.answer,
      });
      return { success: true };
    }),

  /** The recent answers, for the personal timeline (C4.5). */
  recent: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      return { answers: await getRecentCheckinAnswers(ctx.user.id, input.personaId, 20) };
    }),

  /** Remembers that the "three worse" card was shown. */
  acknowledgeWorse: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const recorded = await recordWorseSuggestion({
        userId: ctx.user.id,
        personaId: input.personaId,
      });
      return { recorded };
    }),
});

export default checkinRouter;
