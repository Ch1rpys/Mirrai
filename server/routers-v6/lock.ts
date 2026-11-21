/**
 * The app lock's routes (C8.4).
 *
 * The guard that refuses a locked session lives in `protectedProcedure`
 * (`server/_core/trpc.ts`), and these routes are the only ones it lets
 * through while the app is locked — otherwise there would be no way to
 * unlock it. What is here:
 *
 * - being told whether the lock is on, and setting it up;
 * - proving the PIN, the account password, or a passkey, which opens
 *   this session for the next idle window and for the next five minutes
 *   on a locked persona;
 * - locking now;
 * - registering and using passkeys. A passkey only ever unlocks the
 *   app; it is not a second way to sign in, so a session cookie is still
 *   required for every one of these routes.
 *
 * The PIN is checked against a scrypt hash and nothing else: five wrong
 * ones in five minutes and the PIN route refuses until the window is
 * over, which leaves the account password. Both routes are rate-limited
 * on top of that.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Request } from "express";
import { copy } from "@shared/copy";
import {
  LOCK_MAX_PASSKEYS,
  LOCK_PIN_MAX_ATTEMPTS,
  LOCK_PIN_ATTEMPT_WINDOW_MS,
  isValidLockPin,
  normalizeLockSettings,
  type LockSettings,
  type PasskeyRecord,
} from "@shared/lock";
import { protectedProcedure, router } from "../_core/trpc";
import { hashPassword, verifyPassword } from "../_core/password";
import { RATE_LIMITS, rateLimiter, type RateLimitRule } from "../_core/rate-limit";
import {
  clearUnlock,
  hasRecentUnlock,
  isSessionLocked,
  lockSettingsOf,
  lockedError,
  noteUnlock,
  readSessionUnlock,
  rememberPasskeyChallenge,
  sessionKeyFromRequest,
  takePasskeyChallenge,
} from "../_core/app-lock";
import { getUserById, getUserLockRow, setUserLock } from "../db";

/**
 * The wrong-PIN counter.
 *
 * Five attempts in five minutes, per user rather than per session: a
 * new tab or a new cookie must not hand the attacker five more guesses.
 */
const PIN_RULE: RateLimitRule = {
  name: "lock-pin",
  limit: LOCK_PIN_MAX_ATTEMPTS,
  windowMs: LOCK_PIN_ATTEMPT_WINDOW_MS,
  scope: "user",
};

/** Proving the account password is limited too — it is the way out of a forgotten PIN. */
const PASSWORD_RULE: RateLimitRule = {
  name: "lock-password",
  limit: 10,
  windowMs: 5 * 60_000,
  scope: "user",
};

/** Where this app is, as the browser sees it — the WebAuthn origin. */
function originOf(req: Request): string {
  const host = req.get?.("host") ?? "";
  return `${req.protocol || "http"}://${host}`;
}

/** The WebAuthn RP id: the host without the port. */
function rpIdOf(req: Request): string {
  const host = req.get?.("host") ?? "localhost";
  return host.split(":")[0] || "localhost";
}

/** What the interface is allowed to know about the stored passkeys. */
function publicPasskeys(settings: LockSettings) {
  return settings.passkeys.map((passkey) => ({
    id: passkey.id,
    transports: passkey.transports ?? [],
    label: passkey.label ?? null,
    createdAt: passkey.createdAt ?? null,
  }));
}

/** The current state, in the shape the lock screen and the settings panel read. */
async function statusOf(
  req: Request,
  user: { id: number; lockPinHash?: string | null; lockSettings?: unknown; username?: string | null },
) {
  const sessionKey = sessionKeyFromRequest(req);
  const settings = lockSettingsOf(user);
  const state = await readSessionUnlock(sessionKey);
  return {
    enabled: settings.enabled,
    idleMinutes: settings.idleMinutes,
    hasPin: Boolean(user.lockPinHash),
    passkeys: publicPasskeys(settings),
    locked: await isSessionLocked(settings, sessionKey),
    recentUnlock: await hasRecentUnlock(sessionKey),
    unlockedUntil: state?.until ?? null,
    lastUnlockAt: state?.lastUnlockAt ?? null,
  };
}

/** The user's password hash, or a clear refusal. */
async function passwordMatches(userId: number, password: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user?.passwordHash) return false;
  return verifyPassword(password, user.passwordHash);
}

/**
 * Session cookie only — no tokens, no query strings.
 *
 * The passkey registration routes are exempt from the lock guard (they
 * are `lock.*`), so they check for themselves that the caller has the
 * app open: somebody holding a stolen cookie but not the PIN must not be
 * able to register their own passkey and walk in.
 */
async function assertUnlocked(
  req: Request,
  user: { lockPinHash?: string | null; lockSettings?: unknown },
  locale: "zh" | "en" | "zh-Hant",
): Promise<void> {
  const settings = lockSettingsOf(user);
  const sessionKey = sessionKeyFromRequest(req);
  if (await isSessionLocked(settings, sessionKey)) throw lockedError(locale);
}

export const lockRouter = router({
  /** The lock's state, for the settings panel and the lock screen. */
  status: protectedProcedure.query(async ({ ctx }) => statusOf(ctx.req, ctx.user)),

  /**
   * Sets or replaces the PIN and turns the lock on.
   *
   * The account password is asked for because a PIN alone must not be
   * able to take over a session: somebody who borrowed a browser for a
   * minute should not be able to lock the owner out of their own app.
   */
  setPin: protectedProcedure
    .input(z.object({ pin: z.string(), currentPassword: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      if (!isValidLockPin(input.pin)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPinFormat") });
      }
      if (!(await passwordMatches(ctx.user.id, input.currentPassword))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasswordWrong") });
      }
      const current = lockSettingsOf(ctx.user);
      const next: LockSettings = { ...current, enabled: true };
      await setUserLock(ctx.user.id, {
        lockPinHash: await hashPassword(input.pin),
        lockSettings: next,
      });
      await noteUnlock(next, sessionKeyFromRequest(ctx.req));
      return { success: true as const };
    }),

  /** Turns the lock on or off and sets the idle window. */
  updateSettings: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        idleMinutes: z.number().int().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = lockSettingsOf(ctx.user);
      /**
       * The lock self-service routes are exempt from `appLockGuard`, so
       * this route checks for itself. A session that is still behind the
       * lock screen may not change the lock at all — turning it *off*
       * from there would hand somebody who picked up the browser the
       * whole app without the PIN. Turning it off is the `disable` route
       * (account password), and both it and this one work normally once
       * the session is unlocked.
       */
      if (await isSessionLocked(current, sessionKeyFromRequest(ctx.req))) {
        throw lockedError(ctx.locale);
      }
      if (input.enabled === true && !ctx.user.lockPinHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPinRequired") });
      }
      const next = normalizeLockSettings({
        ...current,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.idleMinutes === undefined ? {} : { idleMinutes: input.idleMinutes }),
      });
      await setUserLock(ctx.user.id, { lockSettings: next });
      return statusOf(ctx.req, { ...ctx.user, lockSettings: next });
    }),

  /**
   * Proves the PIN.
   *
   * Five wrong ones in five minutes and the limiter refuses before the
   * hash is even checked, with the sentence the manual asks for: use the
   * account password.
   */
  verifyPin: protectedProcedure
    .input(z.object({ pin: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      const limit = await rateLimiter.check(String(ctx.user.id), PIN_RULE);
      if (!limit.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "errors.lockTooManyAttempts"),
        });
      }
      if (!ctx.user.lockPinHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockNoPin") });
      }
      const matches = isValidLockPin(input.pin)
        ? await verifyPassword(input.pin, ctx.user.lockPinHash)
        : false;
      if (!matches) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPinWrong") });
      }
      await rateLimiter.reset(String(ctx.user.id));
      const settings = lockSettingsOf(ctx.user);
      const state = await noteUnlock(settings, sessionKeyFromRequest(ctx.req));
      return { success: true as const, unlockedUntil: state?.until ?? null };
    }),

  /** Proves the account password — the way out of a forgotten PIN. */
  verifyPassword: protectedProcedure
    .input(z.object({ password: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const limit = await rateLimiter.check(`pw:${ctx.user.id}`, PASSWORD_RULE);
      if (!limit.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: copy(ctx.locale, "errors.lockTooManyAttempts"),
        });
      }
      if (!(await passwordMatches(ctx.user.id, input.password))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasswordWrong") });
      }
      await rateLimiter.reset(`pw:${ctx.user.id}`);
      const settings = lockSettingsOf(ctx.user);
      const state = await noteUnlock(settings, sessionKeyFromRequest(ctx.req));
      return { success: true as const, unlockedUntil: state?.until ?? null };
    }),

  /** Locks this session now. The top bar and the double Escape key use it. */
  lockNow: protectedProcedure.mutation(async ({ ctx }) => {
    await clearUnlock(sessionKeyFromRequest(ctx.req));
    return { locked: true as const };
  }),

  /**
   * Turns the lock off entirely: the PIN, the passkeys and the switch.
   *
   * This is the "I do not want this any more" route, so it asks for the
   * account password and removes the key material with the switch — a
   * leftover PIN would silently come back the next time a persona was
   * locked.
   */
  disable: protectedProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await passwordMatches(ctx.user.id, input.currentPassword))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasswordWrong") });
      }
      await setUserLock(ctx.user.id, {
        lockPinHash: null,
        lockSettings: { enabled: false, idleMinutes: lockSettingsOf(ctx.user).idleMinutes, passkeys: [] },
      });
      await clearUnlock(sessionKeyFromRequest(ctx.req));
      return { success: true as const };
    }),

  passkey: router({
    /**
     * Starts registering a passkey.
     *
     * Registration only works from an unlocked app: an attacker with a
     * stolen cookie but no PIN is refused here.
     */
    registerOptions: protectedProcedure.mutation(async ({ ctx }) => {
      await assertUnlocked(ctx.req, ctx.user, ctx.locale);
      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      const settings = lockSettingsOf(ctx.user);
      const options = await generateRegistrationOptions({
        rpName: "Mirrai",
        rpID: rpIdOf(ctx.req),
        userName: ctx.user.username ?? `user-${ctx.user.id}`,
        attestationType: "none",
        excludeCredentials: settings.passkeys.map((passkey) => ({
          id: passkey.id,
          transports: passkey.transports as never,
        })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      const sessionKey = sessionKeyFromRequest(ctx.req);
      if (!sessionKey) throw new TRPCError({ code: "UNAUTHORIZED" });
      await rememberPasskeyChallenge(sessionKey, options.challenge);
      return options;
    }),

    /** Finishes registration and stores the credential. */
    registerVerify: protectedProcedure
      .input(z.object({ response: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        await assertUnlocked(ctx.req, ctx.user, ctx.locale);
        const sessionKey = sessionKeyFromRequest(ctx.req);
        if (!sessionKey) throw new TRPCError({ code: "UNAUTHORIZED" });
        const challenge = await takePasskeyChallenge(sessionKey);
        if (!challenge) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockChallengeExpired") });
        }
        const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
        let verification;
        try {
          verification = await verifyRegistrationResponse({
            response: input.response as never,
            expectedChallenge: challenge,
            expectedOrigin: originOf(ctx.req),
            expectedRPID: rpIdOf(ctx.req),
            requireUserVerification: false,
          });
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasskeyFailed") });
        }
        const info = verification.registrationInfo;
        if (!verification.verified || !info) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasskeyFailed") });
        }
        const settings = lockSettingsOf(ctx.user);
        if (settings.passkeys.length >= LOCK_MAX_PASSKEYS) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockTooManyPasskeys") });
        }
        const record: PasskeyRecord = {
          id: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
          counter: info.credential.counter ?? 0,
          transports: info.credential.transports as string[] | undefined,
          createdAt: new Date().toISOString(),
        };
        const next: LockSettings = {
          ...settings,
          enabled: true,
          passkeys: [...settings.passkeys, record],
        };
        await setUserLock(ctx.user.id, { lockSettings: next });
        return { success: true as const, id: record.id };
      }),

    /** Starts unlocking with a passkey. Works while the app is locked. */
    authOptions: protectedProcedure.mutation(async ({ ctx }) => {
      const settings = lockSettingsOf(ctx.user);
      if (settings.passkeys.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockNoPasskey") });
      }
      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
      const options = await generateAuthenticationOptions({
        rpID: rpIdOf(ctx.req),
        allowCredentials: settings.passkeys.map((passkey) => ({
          id: passkey.id,
          transports: passkey.transports as never,
        })),
        userVerification: "preferred",
      });
      const sessionKey = sessionKeyFromRequest(ctx.req);
      if (!sessionKey) throw new TRPCError({ code: "UNAUTHORIZED" });
      await rememberPasskeyChallenge(sessionKey, options.challenge);
      return options;
    }),

    /** Finishes a passkey unlock. A rolled-back counter is refused. */
    authVerify: protectedProcedure
      .input(z.object({ response: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        const sessionKey = sessionKeyFromRequest(ctx.req);
        if (!sessionKey) throw new TRPCError({ code: "UNAUTHORIZED" });
        const challenge = await takePasskeyChallenge(sessionKey);
        if (!challenge) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockChallengeExpired") });
        }
        const settings = lockSettingsOf(ctx.user);
        const credentialId = (input.response as { id?: unknown })?.id;
        const stored = settings.passkeys.find((passkey) => passkey.id === credentialId);
        if (!stored) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasskeyFailed") });
        }
        const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
        let verification;
        try {
          verification = await verifyAuthenticationResponse({
            response: input.response as never,
            expectedChallenge: challenge,
            expectedOrigin: originOf(ctx.req),
            expectedRPID: rpIdOf(ctx.req),
            credential: {
              id: stored.id,
              publicKey: Buffer.from(stored.publicKey, "base64url"),
              counter: stored.counter,
              transports: stored.transports as never,
            },
            requireUserVerification: false,
          } as never);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasskeyFailed") });
        }
        if (!verification.verified) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.lockPasskeyFailed") });
        }
        const newCounter = verification.authenticationInfo?.newCounter ?? stored.counter;
        const next: LockSettings = {
          ...settings,
          passkeys: settings.passkeys.map((passkey) =>
            passkey.id === stored.id ? { ...passkey, counter: newCounter } : passkey,
          ),
        };
        await setUserLock(ctx.user.id, { lockSettings: next });
        const state = await noteUnlock(lockSettingsOf({ lockSettings: next }), sessionKey);
        return { success: true as const, unlockedUntil: state?.until ?? null };
      }),

    /** Forgets a passkey. Needs the app open, like registering one. */
    remove: protectedProcedure
      .input(z.object({ id: z.string().min(1).max(512) }))
      .mutation(async ({ ctx, input }) => {
        await assertUnlocked(ctx.req, ctx.user, ctx.locale);
        const settings = lockSettingsOf(ctx.user);
        const next: LockSettings = {
          ...settings,
          passkeys: settings.passkeys.filter((passkey) => passkey.id !== input.id),
        };
        await setUserLock(ctx.user.id, { lockSettings: next });
        return { success: true as const, removed: settings.passkeys.length !== next.passkeys.length };
      }),
  }),
});
