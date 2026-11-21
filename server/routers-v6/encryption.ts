/**
 * The encrypted account's routes (C8.5).
 *
 * `users.encryption` says whether this account's content is encrypted;
 * the 32-byte data key is unwrapped from the login password at sign-in
 * and kept in the server's memory. A server restart forgets it, so the
 * interface can be holding a valid session cookie and still have no key
 * — these routes are how it comes back:
 *
 * - `status` says whether the account is encrypted, whether this
 *   process has the key, and how far an enable/disable job has got;
 * - `unlock` asks for the account password and unwraps the key again;
 * - `lock` forgets the key in this process, for a "lock now" action;
 * - `enable` / `disable` turn the feature on and off (both need the
 *   account password, and enabling first needs a full backup);
 * - `recover` sets a new password using the one-time recovery code.
 *
 * None of them ever returns the key, the wrapped key or the salt.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { copy, type CopyKey } from "@shared/copy";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { normalizeUserEncryption } from "@shared/encryption";
import { protectedProcedure, rateLimit, router } from "../_core/trpc";
import { RATE_LIMITS, rateLimiter } from "../_core/rate-limit";
import { verifyPassword } from "../_core/password";
import { unwrapDataKeyWithPassword } from "../_core/content-crypto";
import { forgetDataKey, rememberDataKey } from "../_core/data-keys";
import { createSessionToken } from "../_core/auth";
import { getSessionCookieOptions } from "../_core/cookies";
import { getUserById } from "../db";
import {
  EncryptionSetupError,
  disableEncryptionForUser,
  enableEncryptionForUser,
  encryptionStatusForUser,
  resetPasswordWithRecovery,
  type EncryptionSetupCode,
} from "../encryption/enable";

/** The sentence for each refusal. */
const ERROR_KEYS: Record<EncryptionSetupCode, CopyKey> = {
  already_enabled: "errors.encryptionAlreadyEnabled",
  not_enabled: "errors.encryptionNotEnabled",
  backup_required: "errors.encryptionBackupRequired",
  password_wrong: "errors.encryptionPasswordWrong",
  key_failed: "errors.encryptionKeyFailed",
  migration_running: "errors.encryptionMigrationRunning",
  recovery_missing: "errors.encryptionRecoveryMissing",
  recovery_wrong: "errors.encryptionRecoveryWrong",
  weak_password: "errors.encryptionPasswordTooShort",
  user_not_found: "errors.code.notFound",
};

function setupError(locale: Parameters<typeof copy>[0], error: unknown): TRPCError {
  if (error instanceof EncryptionSetupError) {
    return new TRPCError({ code: "BAD_REQUEST", message: copy(locale, ERROR_KEYS[error.code]) });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
}

async function statusOf(userId: number) {
  return encryptionStatusForUser(userId);
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

  /**
   * Turns the encrypted database on.
   *
   * The two acknowledgements are the two irreversible facts: losing the
   * password and the recovery code loses the content, and after a
   * restart the background work waits for the next sign-in. They are
   * enforced here as well as drawn on the page, because a UI is not a
   * permission check.
   */
  enable: protectedProcedure
    .use(rateLimit(RATE_LIMITS.encryptionUnlock))
    .input(
      z.object({
        password: z.string().min(1).max(256),
        lostContentUnderstood: z.literal(true),
        restartUnderstood: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await enableEncryptionForUser(ctx.user.id, input.password);
        return {
          ...(await statusOf(ctx.user.id)),
          /** Shown once: it is never stored in a readable form. */
          recoveryCode: result.recoveryCode,
          pendingRows: result.total,
        };
      } catch (error) {
        throw setupError(ctx.locale, error);
      }
    }),

  /** Turns it off: the rows are decrypted again by a background job. */
  disable: protectedProcedure
    .use(rateLimit(RATE_LIMITS.encryptionUnlock))
    .input(z.object({ password: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await disableEncryptionForUser(ctx.user.id, input.password);
        return { ...(await statusOf(ctx.user.id)), pendingRows: result.total };
      } catch (error) {
        throw setupError(ctx.locale, error);
      }
    }),

  /**
   * Sets a new password with the recovery code.
   *
   * The old password stops working and the data key is wrapped with the
   * new one. The session is re-minted with the new token version so the
   * person who just fixed their account is not signed out by it.
   */
  recover: protectedProcedure
    .use(rateLimit(RATE_LIMITS.encryptionUnlock))
    .input(
      z.object({
        recoveryCode: z.string().min(1).max(128),
        newPassword: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await resetPasswordWithRecovery(ctx.user.id, input.recoveryCode, input.newPassword);
      } catch (error) {
        throw setupError(ctx.locale, error);
      }
      const fresh = await getUserById(ctx.user.id);
      if (fresh) {
        const token = await createSessionToken(
          fresh.id,
          fresh.name || fresh.username,
          fresh.tokenVersion ?? 0,
        );
        ctx.res.cookie(COOKIE_NAME, token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: ONE_YEAR_MS,
        });
      }
      return statusOf(ctx.user.id);
    }),
});

/** Kept for the tests that assert the unlock limit is an existing rule. */
export { rateLimiter };
