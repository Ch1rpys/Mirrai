/**
 * The lines they started and never finished (C6.5).
 *
 * The list is read from the record, not written by a model. Only the
 * continuation of one line is reconstructed, only when the user presses
 * the button, and it is never stored or sent anywhere.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizePersonaData } from "../_core/persona-schema";
import { RATE_LIMITS } from "../_core/rate-limit";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import {
  getPersonaById,
  getRecordsAround,
  getRecordsByIds,
} from "../db";
import { findUnfinishedForPersona } from "../records/unsaid";
import { completeUnfinishedLine } from "../chat/unsaid";

export const unsaidRouter = router({
  list: protectedProcedure
    .input(z.object({ personaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const items = await findUnfinishedForPersona({
        personaId: input.personaId,
        userId: ctx.user.id,
        personaData: normalizePersonaData(persona.personaData as any, {
          name: persona.name,
          locale: ctx.locale,
        }),
      });
      return { items };
    }),

  /**
   * Writes one line after theirs.
   *
   * It reads the record again, so the text shown is the record's own and
   * the two lines before it are the real exchange — the client cannot
   * supply any of it. The answer is not written down.
   */
  complete: protectedProcedure
    .use(rateLimit(RATE_LIMITS.llm))
    .input(z.object({ personaId: z.number(), recordId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

      const [record] = await getRecordsByIds([input.recordId], ctx.user.id);
      if (
        !record ||
        record.personaId !== input.personaId ||
        record.role !== "assistant" ||
        (record.kind ?? "text") !== "text"
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.unsaidLine"),
        });
      }

      const around = await getRecordsAround(input.recordId, ctx.user.id, 2, 0);
      const text = await completeUnfinishedLine({
        persona,
        userId: ctx.user.id,
        line: record.content,
        context: around.before.map((row) => row.content),
        locale: ctx.locale,
      });
      return { text };
    }),
});

export default unsaidRouter;
