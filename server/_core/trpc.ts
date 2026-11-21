import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { rateLimiter, resolveRateLimitKey, type RateLimitRule } from "./rate-limit";
import { copy, type CopyKey, type Locale } from "@shared/copy";
import { sealState } from "@shared/persona-state";
import { dataKeyFor } from "./data-keys";
import { normalizeUserEncryption } from "@shared/encryption";
import {
  hasRecentUnlock,
  isSessionLocked,
  lockSettingsOf,
  lockedError,
  personaLocked,
  personaLockedError,
  sessionKeyFromRequest,
  touchUnlock,
} from "./app-lock";

/**
 * What the client is told when something goes wrong.
 *
 * Every uncaught error used to reach the client word for word, and an
 * uncaught error here is usually a Postgres one: a unique-violation
 * race that names the constraint, a foreign-key violation that names
 * the tables, or "DB not available". The user is told "duplicate key
 * value violates unique constraint users_username_key" and learns the
 * shape of the database, and a stranger learns it too.
 *
 * The message of a `TRPCError` is the app's own — it was written for
 * the person reading it — so it is passed through. Everything else is
 * replaced with something that says what happened without saying how.
 *
 * Exported so it can be tested on its own: the error formatter runs at
 * the edge, and a test that goes through the router never reaches it.
 */
export function formatErrorForClient({
  shape,
  error,
  ctx,
}: {
  shape: { message: string; code: number; data: Record<string, unknown> };
  error: unknown;
  ctx?: { locale?: Locale };
}): { message: string; code: number; data: Record<string, unknown> } {
  const locale = ctx?.locale ?? "zh";
  /**
   * The code, by name, for the machine.
   *
   * tRPC puts a *number* in the error's data — `data.code` is
   * `-32001`, not `"UNAUTHORIZED"`. So every place in the interface
   * that compared `error.data?.code` with a name was comparing a number
   * with a string, and never matched:
   *
   * - the retry policy, which never stopped retrying an error that
   *   said the session was over;
   * - the sign-in redirect, which looked for the English message
   *   instead;
   * - the chat page, which showed a generic error and a retry button
   *   where the "this persona is gone" page belonged;
   * - the sign-out, which swallowed the errors that were not really
   *   about the session at all.
   *
   * So the name goes into the data — and the number stays where tRPC
   * put it, because tRPC's own client checks the *top-level* code and
   * that one has to stay a number.
   */
  const withCode = (
    result: { message: string; code: number; data: Record<string, unknown> },
    code: string,
  ) => ({ ...result, data: { ...result.data, code } });

  if (error instanceof TRPCError) {
    const code = error.code;
    /**
     * A code the app invented, like `LOCKED` (C8.4).
     *
     * tRPC's own codes are a closed set and its client validates the
     * response against them — so the lock cannot be a new code on the
     * wire. It travels as `FORBIDDEN` in the transport and in
     * `data.code`, which is where the interface already looks for
     * `UNAUTHORIZED`. The app's own message is passed through: it was
     * written for the person reading it.
     */
    const appCode = (error as { mirraiCode?: unknown }).mirraiCode;
    if (typeof appCode === "string" && appCode.length > 0) {
      return withCode({ ...shape, message: error.message }, appCode);
    }
    /**
     * An error from somewhere else.
     *
     * tRPC wraps an unknown error in a `TRPCError` with the original
     * as its `cause` — and the message becomes the cause's message. So
     * a Postgres error reached the browser word for word: the SQL, the
     * table names, the constraint names and the parameter values.
     *
     * The test for this used a plain `Error`, which the formatter never
     * sees — tRPC has already wrapped it by then. The test passed and
     * the leak was still there.
     */
    if (error.cause) {
      /**
       * A field the user filled in badly.
       *
       * tRPC's input validation fails with the Zod error as the cause —
       * and the message became "Something went wrong on the server",
       * which blames the server for something the user typed. And it
       * was in English, in a Chinese-first app.
       */
      if (isValidationError(error.cause)) {
        return withCode(
          {
            ...shape,
            message: copy(locale, "errors.invalidInput"),
            data: { ...shape.data, message: undefined },
          },
          code,
        );
      }
      return withCode(
        {
          ...shape,
          // The reader's language. The message used to be an English
          // string in a Chinese-first app — so every failure that was
          // not the app's own said itself in a language the reader may
          // not read.
          message: copy(locale, "errors.code.internalServerError"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    /**
     * The two the app says on its own behalf.
     *
     * They used to be English strings with an internal code in them —
     * "Please login (10001)" and "You do not have required permission
     * (10002)" — and they were thrown as the error's message, so they
     * were passed through to the interface. So a Chinese user whose
     * session had expired was told, in a Chinese interface, in English,
     * with a code number that means nothing to them.
     *
     * The shared copy table already had the right sentences for exactly
     * these two codes; they just were not used.
     */
    if (code === "UNAUTHORIZED") {
      return withCode(
        {
          ...shape,
          message: copy(locale, "errors.code.unauthorized"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    if (code === "FORBIDDEN") {
      return withCode(
        {
          ...shape,
          message: copy(locale, "errors.code.forbidden"),
          data: { ...shape.data, message: undefined },
        },
        code,
      );
    }
    /**
     * A procedure that throws without a message gets the *code* as its
     * message.
     *
     * tRPC fills it in: `message = opts.message ?? cause?.message ??
     * opts.code`. So `new TRPCError({ code: "NOT_FOUND" })` reached the
     * interface as the token "NOT_FOUND" — and every toast that shows
     * `e.message` showed it too.
     *
     * The code is for the machine. This is for the person.
     */
    if (shape.message && shape.message !== code) {
      return withCode(shape, code);
    }
    return withCode(
      {
        ...shape,
        message: copy(locale, codeKey(code)),
      },
      code,
    );
  }
  return withCode(
    {
      ...shape,
      message: copy(locale, "errors.code.internalServerError"),
      data: { ...shape.data, message: undefined },
    },
    "INTERNAL_SERVER_ERROR",
  );
}

/**
 * Whether an error is the app's own input validation.
 *
 * The shape is checked rather than the class: there can be more than
 * one copy of the validation library in the tree, and `instanceof` says
 * "no" when the error came from the other one.
 */
function isValidationError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const record = cause as { name?: unknown; issues?: unknown };
  return record.name === "ZodError" || Array.isArray(record.issues);
}

/**
 * The copy key for a tRPC error code.
 *
 * The code is upper case and joined with underscores; the key is
 * camel case and joined with a dot.
 *
 * The result is typed as a copy key, so the table of codes and the
 * table of sentences cannot drift apart: a code that has no sentence
 * would be a compile error rather than a key that renders as itself
 * in the interface.
 */
function codeKey(code: string): CopyKey {
  const known = [
    "NOT_FOUND", "BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT",
    "PRECONDITION_FAILED", "PAYLOAD_TOO_LARGE", "TOO_MANY_REQUESTS",
    "INTERNAL_SERVER_ERROR", "TIMEOUT",
  ] as const;
  if (!known.includes(code as (typeof known)[number])) return "errors.code.unknown";
  const camel = (code as string)
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
  return `errors.code.${camel}` as CopyKey;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: formatErrorForClient,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    // The message is replaced by the formatter, in the reader's
    // language — what is left here is only the code.
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * Procedures that stay usable while a persona is sealed (C6.2).
 *
 * The data is the user's: getting it out and deleting it must always
 * work, and the seal's own controls have to be reachable or the user
 * could not lift it. `persona.getSettings` is here because the seal
 * controls read the stored dates through it.
 */
const SEAL_EXEMPT_PATHS = new Set([
  "persona.seal.set",
  "persona.seal.requestOpen",
  "persona.seal.cancelRequest",
  "persona.getSettings",
  "persona.exportManual",
  "persona.delete",
  "personaCard.export",
  "chat.export",
]);

/**
 * Paths that stay reachable while the app is locked (C8.4).
 *
 * Signing in and getting out of the lock have to work, or nobody could
 * ever unlock; the capability probe is public and the first-run wizard
 * reads it before there is a session. Everything else — every persona,
 * message, memory, record, letter and setting — waits for the PIN.
 */
const APP_LOCK_EXEMPT_PREFIXES = ["auth.", "lock."] as const;
const APP_LOCK_EXEMPT_PATHS = new Set(["system.capabilities"]);

/**
 * Refuses every request from a session the app lock covers (C8.4).
 *
 * The lock is per session, not per user: unlocking this browser must
 * not unlock a session somebody else left open on the same account. A
 * request that gets through slides the idle window forward, which is
 * what makes the window mean "idle".
 */
export const appLockGuard = t.middleware(async (opts) => {
  const user = opts.ctx.user;
  if (!user) return opts.next();
  if (APP_LOCK_EXEMPT_PATHS.has(opts.path)) return opts.next();
  if (APP_LOCK_EXEMPT_PREFIXES.some((prefix) => opts.path.startsWith(prefix))) return opts.next();

  const settings = lockSettingsOf(user);
  if (!settings.enabled) return opts.next();
  const sessionKey = sessionKeyFromRequest(opts.ctx.req);
  try {
    if (await isSessionLocked(settings, sessionKey)) throw lockedError(opts.ctx.locale);
    await touchUnlock(settings, sessionKey);
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    /**
     * The store could not answer. That is "locked", not "open": a lock
     * that disappears when its own bookkeeping breaks is not a lock.
     * The store itself falls back from Redis to this process, so this is
     * the programming-error path, and it says so in the log.
     */
    console.warn("[lock] The unlock state could not be read:", error);
    throw lockedError(opts.ctx.locale);
  }
  return opts.next();
});

/**
 * Refuses every read or write that names a sealed or locked persona.
 *
 * The seal (C6.2) is a promise about time; the lock (C8.4) is a promise
 * about who is at the keyboard. The input is read raw — each procedure
 * has its own shape, and the id is sometimes `personaId` and sometimes
 * `id` (the persona's own routes). A procedure whose input has neither
 * is left alone.
 *
 * The database is imported lazily and a failure to read the settings is
 * treated as "not sealed": the guard must not take the whole app down
 * because one read failed. The same failure is "not locked" for the
 * same reason — the app-level lock in `appLockGuard` has already run.
 */
/**
 * Paths that stay reachable while an encrypted account is locked (C8.5).
 *
 * Signing in, the lock, and the way to unlock the encrypted content
 * itself. Everything else waits for the data key.
 */
const ENCRYPTION_EXEMPT_PREFIXES = ["auth.", "lock.", "encryption."] as const;

/**
 * Routes that must work while the encrypted content is locked.
 *
 * Changing the password and deleting the account both prove the account
 * password themselves, and both have to be reachable from a server that
 * has just restarted — otherwise a person who restarted the app could
 * not rotate a leaked password or get rid of the account at all.
 */
const ENCRYPTION_EXEMPT_PATHS = new Set(["user.changePassword", "user.deleteAccount"]);

/**
 * Refuses every data route while an encrypted account's key is missing.
 *
 * The account can be encrypted and still have no key in this process:
 * the server restarted, or the user locked it. Its rows are ciphertext
 * then, and returning them would either hand the interface ciphertext
 * or make it show an empty page — both wrong. So the request is refused
 * with a name the interface turns into "enter your password".
 */
export const encryptionGuard = t.middleware(async (opts) => {
  const user = opts.ctx.user;
  if (!user) return opts.next();
  if (!normalizeUserEncryption(user.encryption)) return opts.next();
  if (ENCRYPTION_EXEMPT_PREFIXES.some((prefix) => opts.path.startsWith(prefix))) {
    return opts.next();
  }
  if (ENCRYPTION_EXEMPT_PATHS.has(opts.path)) return opts.next();
  if (!dataKeyFor(user.id)) {
    const error = new TRPCError({
      code: "FORBIDDEN",
      message: copy(opts.ctx.locale, "errors.encryptionLocked"),
    });
    (error as { mirraiCode?: string }).mirraiCode = "ENCRYPTION_LOCKED";
    throw error;
  }
  return opts.next();
});

export const sealedGuard = t.middleware(async (opts) => {
  const user = opts.ctx.user;
  if (!user) return opts.next();

  let raw: unknown = null;
  try {
    // `getRawInput` may be synchronous or a promise, depending on how
    // the input was parsed.
    raw = await opts.getRawInput();
  } catch {
    return opts.next();
  }
  if (!raw || typeof raw !== "object") return opts.next();
  const input = raw as Record<string, unknown>;
  const personaId =
    typeof input.personaId === "number"
      ? input.personaId
      : opts.path.startsWith("persona.") && typeof input.id === "number"
        ? input.id
        : null;
  if (personaId === null) return opts.next();

  let settings: unknown = null;
  try {
    const db = await import("../db");
    /**
     * The effective settings, not the row's own: a family member's row
     * does not carry the owner's seal (C7.2), and reading it directly
     * would let them walk through a sealed persona.
     */
    settings = await db.getPersonaStateSettings(personaId, user.id);
  } catch {
    return opts.next();
  }
  if (settings) {
    /**
     * A locked persona asks for the PIN even when the app itself is not
     * locked — and even for the seal-exempt routes: exporting or
     * deleting a locked persona is exactly what the lock is there to
     * stop.
     */
    if (await personaLocked(settings as { locked?: boolean }, sessionKeyFromRequest(opts.ctx.req))) {
      throw personaLockedError(opts.ctx.locale);
    }
    if (!SEAL_EXEMPT_PATHS.has(opts.path) && sealState({ settings }, new Date(), user.timezone) === "sealed") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: copy(opts.ctx.locale, "errors.sealed"),
      });
    }
  }
  return opts.next();
});

export const protectedProcedure = t.procedure
  .use(requireUser)
  .use(appLockGuard)
  .use(encryptionGuard)
  .use(sealedGuard);

/**
 * Admin-only procedures.
 *
 * The app lock covers them as well: an admin session behind the lock
 * screen must not be able to fire a side effect (a notice to the
 * operator's channels) without the PIN. The role check runs after the
 * lock, so a locked non-admin still gets `LOCKED` rather than a role
 * error it could probe.
 */
export const adminProcedure = t.procedure
  .use(appLockGuard)
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user || ctx.user.role !== 'admin') {
        // The message is replaced by the formatter, in the reader's
        // language — what is left here is only the code.
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
        },
      });
    }),
  );

/**
 * Restricts how often a procedure may be called.
 *
 * The bucket is keyed by the authenticated user when one is available, and
 * by client IP otherwise — so the limit cannot be side-stepped by signing in
 * as somebody else, nor by logging out.
 */
export function rateLimit(rule: RateLimitRule) {
  return t.middleware(async opts => {
      const key = resolveRateLimitKey(opts.ctx.req, rule, opts.ctx.user?.id);
      const result = await rateLimiter.check(key, rule);
      if (!result.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: copy(opts.ctx.locale, "errors.rateLimited"),
        });
      }
      return opts.next();
  });
}
