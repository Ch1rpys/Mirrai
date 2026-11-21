/**
 * The encrypted account's unlock routes (C8.5).
 *
 * `users.encryption` says whether this account's content is encrypted;
 * the 32-byte data key is unwrapped from the login password at sign-in
 * and kept in the server's memory. A server restart forgets it, so the
 * interface can be holding a valid session cookie and still have no key
 * — these routes are how it comes back:
 *
 * - `status` says whether the account is encrypted and whether this
 *   process has the key;
 * - `unlock` asks for the account password and unwraps the key again;
 * - `lock` forgets the key in this process, for a "lock now" action.
 *
 * None of them ever returns the key, the wrapped key or the salt.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy } from "@shared/copy";
import { normalizeUserEncryption } from "@shared/encryption";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS, rateLimiter } from "../_core/rate-limit";
import { verifyPassword } from "../_core/password";
import {
  unwrapDataKeyWithPassword,
} from "../_core/content-crypto";
import { forgetDataKey, hasDataKey, rememberDataKey } from "../_core/data-keys";
import { getUserById } from "../db";

async function statusOf(userId: number) {
  const user = await getUserById(userId);
  const encryption = normalizeUserEncryption(user?.encryption);
  return {
    enabled: encryption !== null,
    unlocked: encryption !== null && hasDataKey(userId),
    hasRecoveryCode: Boolean(encryption?.recoveryWrappedKey),
  };
}

export const encryptionRouter = router({
  /** What this account's storage looks like, and whether it is open here. */
  status: protectedProcedure.query(async ({ ctx }) => statusOf(ctx.user.id)),

  /**
   * Unwraps the data key again with the account password.
   *
   * This is what a server restart, a password change on another device
   * or an explicit lock leaves the interface asking for.
   */
  unlock: protectedProcedure
    // The limit is per user: guessing here is guessing the account
    // password itself.
    .use(rateLimit(RATE_LIMITS.encryptionUnlock))
    .input(z.object({ password: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const user = await getUserById(ctx.user.id);
      const encryption = normalizeUserEncryption(user?.encryption);
      if (!encryption) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.encryptionNotEnabled") });
      }
      const valid = await verifyPassword(input.password, user?.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.encryptionPasswordWrong") });
      }
      const dataKey = await unwrapDataKeyWithPassword(
        encryption.wrappedKey,
        encryption.salt,
        input.password,
      );
      if (!dataKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.encryptionKeyFailed") });
      }
      rememberDataKey(ctx.user.id, dataKey);
      return statusOf(ctx.user.id);
    }),

  /** Forgets the key in this process. The next request asks again. */
  lock: protectedProcedure.mutation(async ({ ctx }) => {
    forgetDataKey(ctx.user.id);
    return statusOf(ctx.user.id);
  }),
});
