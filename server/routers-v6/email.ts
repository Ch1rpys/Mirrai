/**
 * The user's own mail server (C5.5).
 *
 * User-level, not per persona: the server and the address are the
 * person's, and several personas can use the same one. The password is
 * never returned; a blank password on save keeps the stored one.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  clearEmailConfig,
  readEmailConfig,
  saveEmailConfig,
  sendTestEmail,
} from "../_core/mail";

export const emailRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const config = await readEmailConfig(ctx.user.id);
    if (!config) {
      return {
        configured: false,
        host: null,
        port: null,
        secure: true,
        user: null,
        from: null,
        to: null,
        subjectWithName: false,
      };
    }
    // The password never leaves the server.
    const { pass: _pass, ...rest } = config;
    return { configured: true, ...rest };
  }),

  saveConfig: protectedProcedure
    .input(z.object({
      host: z.string().trim().min(1).max(255),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      user: z.string().trim().min(1).max(255),
      /** Blank keeps the saved password. */
      pass: z.string().max(500).optional(),
      from: z.string().email().max(320),
      to: z.string().email().max(320),
      subjectWithName: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const saved = await saveEmailConfig(ctx.user.id, input);
      if (!saved) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.emailIncomplete") });
      }
      return { saved: true };
    }),

  test: protectedProcedure.mutation(async ({ ctx }) => {
    const sent = await sendTestEmail(ctx.user.id, ctx.locale === "en" ? "en" : "zh");
    return { sent };
  }),

  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await clearEmailConfig(ctx.user.id);
    return { cleared: true };
  }),
});
