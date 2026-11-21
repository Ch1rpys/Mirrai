/**
 * The conversation's stars, pins and topic markers (C8.10).
 *
 * A long conversation had no way to keep hold of anything: a message
 * worth finding again, the few worth keeping in front of it, and a named
 * point worth returning to. All three point at one message of one
 * conversation — a topic is a signpost inside the same conversation, not
 * a second conversation.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addMessageMark,
  countMessageMarks,
  getMessageById,
  getMessageMark,
  getPersonaById,
  listMessageMarks,
  removeMessageMark,
} from "../db";

/** Every conversation keeps at most this many messages in front. */
export const MAX_PINS = 3;

const MARK_KINDS = ["star", "pin", "topic"] as const;

export const markRouter = router({
  /** The marks of one conversation, with the message each one points at. */
  list: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      kind: z.enum(MARK_KINDS).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const marks = await listMessageMarks(input.personaId, ctx.user.id, input.kind);
      return { marks, maxPins: MAX_PINS };
    }),

  /**
   * Stars, pins or names a message.
   *
   * A pin is refused past the limit with the reason the user can act
   * on; a topic without a name is refused because the name is the whole
   * thing that makes it findable later.
   */
  add: protectedProcedure
    .input(z.object({
      personaId: z.number(),
      messageId: z.number(),
      kind: z.enum(MARK_KINDS),
      label: z.string().trim().max(60).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const persona = await getPersonaById(input.personaId, ctx.user.id);
      if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
      const message = await getMessageById(input.messageId, ctx.user.id, input.personaId);
      if (!message) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.kind === "topic" && !input.label) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: copy(ctx.locale, "errors.topicNeedsLabel"),
        });
      }
      if (input.kind === "pin") {
        const pins = await countMessageMarks(input.personaId, ctx.user.id, "pin");
        if (pins >= MAX_PINS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.pinLimit"),
          });
        }
      }
      const mark = await addMessageMark({
        userId: ctx.user.id,
        personaId: input.personaId,
        messageId: input.messageId,
        kind: input.kind,
        label: input.kind === "topic" ? (input.label ?? null) : null,
      });
      return { success: true as const, mark };
    }),

  /** Takes one mark away. */
  remove: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await removeMessageMark(input.id, ctx.user.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true as const };
    }),

  /** One mark of the caller's own, for the tests and the jump. */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const mark = await getMessageMark(input.id, ctx.user.id);
      if (!mark) throw new TRPCError({ code: "NOT_FOUND" });
      return mark;
    }),
});

export default markRouter;
