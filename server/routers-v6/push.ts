/**
 * Browser push subscriptions.
 *
 * The user turns this on. Nothing here asks the browser for permission;
 * that happens in the settings page, and only after a click.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  deletePushSubscription,
  getPersonasByUserId,
  listPushSubscriptions,
  setPushSubscriptionPreview,
  upsertPushSubscription,
} from "../db";
import { getVapidKeys, pushToUser } from "../_core/push";

const endpointSchema = z.string().url().max(2000);
const keySchema = z.string().min(1).max(200);

function userAgentOf(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 255);
}

export const pushRouter = router({
  publicKey: protectedProcedure.query(() => {
    return { publicKey: getVapidKeys().publicKey };
  }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listPushSubscriptions(ctx.user.id);
    return rows.map((row) => ({
      endpoint: row.endpoint,
      showPreview: row.showPreview,
      createdAt: row.createdAt,
    }));
  }),

  subscribe: protectedProcedure
    .input(z.object({
      endpoint: endpointSchema,
      keys: z.object({ p256dh: keySchema, auth: keySchema }),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await upsertPushSubscription(ctx.user.id, {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgentOf(ctx.req.headers["user-agent"]),
      });
      return { id: row?.id ?? null, endpoint: input.endpoint };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: endpointSchema }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await deletePushSubscription(ctx.user.id, input.endpoint);
      return { deleted };
    }),

  setPreview: protectedProcedure
    .input(z.object({ endpoint: endpointSchema, showPreview: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await setPushSubscriptionPreview(
        ctx.user.id,
        input.endpoint,
        input.showPreview,
      );
      return { updated };
    }),

  test: protectedProcedure.mutation(async ({ ctx }) => {
    const personas = await getPersonasByUserId(ctx.user.id);
    const persona = personas[0];
    if (!persona) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: copy(ctx.locale, "errors.pushNoPersona"),
      });
    }
    await pushToUser(ctx.user.id, {
      kind: "reminder",
      personaId: persona.id,
      personaName: persona.name,
      text: copy(ctx.locale, "push.testBody"),
    });
    return { ok: true };
  }),
});
