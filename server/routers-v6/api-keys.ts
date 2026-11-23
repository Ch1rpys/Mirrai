/**
 * The keys for the OpenAI-compatible endpoint (C9.2).
 *
 * A key is a credential for another program on the same machine — a
 * client like any OpenAI client, pointed at `/v1`. Three routes: list
 * the keys, create one, revoke one. The key itself is only ever in the
 * response of `create`.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { protectedProcedure, router } from "../_core/trpc";
import {
  API_KEY_SCOPES,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  type ApiKeyScope,
} from "../_core/api-keys";
import { createApiKey, listApiKeys, revokeApiKey } from "../db";

/** A key as the settings page sees it: no hash, no secret. */
export interface ApiKeyView {
  id: number;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
}

function scopesOf(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value)) return ["chat"];
  const kept = value.filter(
    (scope): scope is ApiKeyScope =>
      scope === "chat" || scope === "read",
  );
  return kept.length > 0 ? kept : ["chat"];
}

export function apiKeyView(row: {
  id: number;
  name: string;
  prefix: string;
  scopes: unknown;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: scopesOf(row.scopes),
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export const apiKeyRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listApiKeys(ctx.user.id);
    return { keys: rows.map(apiKeyView) };
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(64),
      scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(2).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const key = generateApiKey();
      const row = await createApiKey({
        userId: ctx.user.id,
        name: input.name,
        keyHash: hashApiKey(key),
        prefix: apiKeyPrefix(key),
        scopes: input.scopes ?? ["chat"],
      });
      // The only time the key itself is returned. It is not stored.
      return { key, ...apiKeyView(row) };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeApiKey(input.id, ctx.user.id);
      if (!revoked) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: copy(ctx.locale, "errors.apiKeyNotFound"),
        });
      }
      return { success: true as const };
    }),
});
