/**
 * The app lock, enforced where the data is (C8.4).
 *
 * A lock that only covers the interface is not a lock: the browser holds
 * a year-long session cookie, and the same cookie opens `/api/trpc`,
 * `/api/chat/stream`, `/uploads/...` and the phone socket. So the
 * server keeps, per session, "this session may skip the PIN until" and
 * refuses everything else while the lock is on.
 *
 * "Per session" means the cookie: its hash is the key, and a new sign-in
 * or a token-version bump is a different session. The state lives in
 * Redis when the app has one, so two copies of Mirrai agree about a
 * session that talked to the other one; without Redis it is a Map in
 * this process, which is exactly right for the one-process install
 * Mirrai mostly is.
 *
 * The PIN itself is not here: `users.lockPinHash` keeps the scrypt hash
 * and `server/routers-v6/lock.ts` is the only thing that checks it.
 */
import { createHash } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { copy, type Locale } from "@shared/copy";
import {
  LOCK_RECENT_UNLOCK_MS,
  normalizeLockSettings,
  type LockSettings,
} from "@shared/lock";
import { connectRedis, type RedisClient } from "./redis";

/** What one session's entry in the store says. */
export interface SessionUnlock {
  /** The instant the idle window ends, epoch ms. */
  until: number;
  /** The instant the user last proved the PIN or password, epoch ms. */
  lastUnlockAt: number;
}

/**
 * How long an entry is kept.
 *
 * The entry carries `lastUnlockAt`, which the per-persona lock reads,
 * so it has to outlive the app's idle window — otherwise a user who
 * unlocked forty minutes ago would look like "never unlocked" and the
 * persona PIN prompt would be indistinguishable from a fresh session.
 */
const ENTRY_TTL_MS = 24 * 60 * 60_000;

/** A passkey challenge is good for one attempt. */
const CHALLENGE_TTL_MS = 5 * 60_000;

/** The shared store, once the server has one. */
let redis: RedisClient | null = null;

/** The fallback: this process only, forgotten on restart. */
const memory = new Map<string, { value: string; expiresAt: number }>();

/**
 * Connects the lock state to the shared store, if there is one.
 *
 * Called at startup, after the rate limiter's own `initRateLimiter` has
 * already found (or failed to find) a Redis — a second search would
 * start a second instance on a machine that has none.
 */
export async function initAppLockStore(): Promise<boolean> {
  const handle = await connectRedis();
  redis = handle?.client ?? null;
  return redis !== null;
}

/** Puts the store back to its in-process shape. Tests only. */
export function resetAppLockStore(): void {
  redis = null;
  memory.clear();
}

function memoryGet(key: string, now: number): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

async function storeGet(key: string, now = Date.now()): Promise<string | null> {
  if (redis) {
    try {
      return await redis.get(key);
    } catch {
      return memoryGet(key, now);
    }
  }
  return memoryGet(key, now);
}

async function storeSet(key: string, value: string, ttlMs: number): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, value, { PX: ttlMs });
      return;
    } catch {
      // The shared store went away; the lock still has to work here.
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function storeDel(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      // fall through to the local copy
    }
  }
  memory.delete(key);
}

/**
 * The session's key: a hash of the cookie.
 *
 * Hashed so the store and the logs never hold a token that could be
 * replayed. A request with no cookie has no session — a public request
 * is not locked, because there is nothing behind it to lock.
 */
export function sessionKeyFromCookieHeader(
  cookieHeader: string | undefined | null,
): string | null {
  if (!cookieHeader) return null;
  let cookies: Map<string, string>;
  try {
    cookies = new Map(Object.entries(parseCookieHeader(cookieHeader)));
  } catch {
    return null;
  }
  const token = cookies.get(COOKIE_NAME);
  if (!token) return null;
  return createHash("sha256").update(token).digest("hex");
}

/** The session's key, from an express request. */
export function sessionKeyFromRequest(req: {
  headers?: Record<string, unknown>;
} | null | undefined): string | null {
  const raw = req?.headers?.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : typeof raw === "string" ? raw : null;
  return sessionKeyFromCookieHeader(header);
}

/** The lock settings of a user row, with every rule applied. */
export function lockSettingsOf(user: { lockSettings?: unknown }): LockSettings {
  return normalizeLockSettings(user.lockSettings);
}

function unlockKey(sessionKey: string): string {
  return `mirrai:lock:unlock:${sessionKey}`;
}

function challengeKey(sessionKey: string): string {
  return `mirrai:lock:challenge:${sessionKey}`;
}

async function readUnlock(sessionKey: string, now: number): Promise<SessionUnlock | null> {
  const raw = await storeGet(unlockKey(sessionKey), now);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { until?: unknown; lastUnlockAt?: unknown };
    if (typeof parsed.until !== "number" || typeof parsed.lastUnlockAt !== "number") return null;
    return { until: parsed.until, lastUnlockAt: parsed.lastUnlockAt };
  } catch {
    return null;
  }
}

/**
 * Whether the session has to show the lock screen.
 *
 * Off means never. On and no entry (or an expired one) means yes.
 */
export async function isSessionLocked(
  settings: LockSettings,
  sessionKey: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!settings.enabled) return false;
  if (!sessionKey) return true;
  const state = await readUnlock(sessionKey, now);
  return !state || state.until <= now;
}

/**
 * Slides the idle window forward after a request that got through.
 *
 * This is what makes "idle" mean idle: reading the lobby every minute
 * keeps the app open, leaving the tab alone for longer than the window
 * asks for the PIN again.
 */
export async function touchUnlock(
  settings: LockSettings,
  sessionKey: string | null,
  now = Date.now(),
): Promise<void> {
  if (!settings.enabled || !sessionKey) return;
  const current = await readUnlock(sessionKey, now);
  if (!current) return;
  const next: SessionUnlock = {
    until: now + settings.idleMinutes * 60_000,
    lastUnlockAt: current.lastUnlockAt,
  };
  await storeSet(unlockKey(sessionKey), JSON.stringify(next), ENTRY_TTL_MS);
}

/** Opens the session: the user just proved the PIN, the password or a passkey. */
export async function noteUnlock(
  settings: LockSettings,
  sessionKey: string | null,
  now = Date.now(),
): Promise<SessionUnlock | null> {
  if (!sessionKey) return null;
  const next: SessionUnlock = {
    until: now + settings.idleMinutes * 60_000,
    lastUnlockAt: now,
  };
  await storeSet(unlockKey(sessionKey), JSON.stringify(next), ENTRY_TTL_MS);
  return next;
}

/** Closes the session, so the next request shows the lock screen. */
export async function clearUnlock(sessionKey: string | null): Promise<void> {
  if (!sessionKey) return;
  await storeDel(unlockKey(sessionKey));
}

/** The session's current state, for `lock.status` and for the tests. */
export async function readSessionUnlock(
  sessionKey: string | null,
  now = Date.now(),
): Promise<SessionUnlock | null> {
  if (!sessionKey) return null;
  return readUnlock(sessionKey, now);
}

/**
 * Whether the PIN was entered recently enough for a locked persona.
 *
 * Unlike the app's idle window, this one is fixed at five minutes: the
 * persona switch promises "asking again soon", and the app's window may
 * be an hour.
 */
export async function hasRecentUnlock(
  sessionKey: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!sessionKey) return false;
  const state = await readUnlock(sessionKey, now);
  if (!state) return false;
  return now - state.lastUnlockAt <= LOCK_RECENT_UNLOCK_MS;
}

/** Stores a passkey challenge, good for one verification. */
export async function rememberPasskeyChallenge(
  sessionKey: string,
  challenge: string,
): Promise<void> {
  await storeSet(challengeKey(sessionKey), challenge, CHALLENGE_TTL_MS);
}

/** Reads and consumes a passkey challenge. */
export async function takePasskeyChallenge(sessionKey: string): Promise<string | null> {
  const challenge = await storeGet(challengeKey(sessionKey));
  await storeDel(challengeKey(sessionKey));
  return challenge;
}

/**
 * The error the client turns into the lock screen.
 *
 * tRPC has no `LOCKED` code of its own, and inventing a new one would
 * make tRPC's own client reject the response. So the transport keeps
 * `FORBIDDEN` and the name travels in `data.code` — the formatter in
 * `trpc.ts` copies `mirraiCode` there. The interface already reads
 * `data.code` for `UNAUTHORIZED`, so it is the same road.
 */
export function lockedError(locale: Locale): TRPCError {
  const error = new TRPCError({
    code: "FORBIDDEN",
    message: copy(locale, "errors.locked"),
  });
  (error as { mirraiCode?: string }).mirraiCode = "LOCKED";
  return error;
}

/**
 * The error for a persona that is locked on its own (C8.4).
 *
 * It is the same PIN but not the same event: the app is open, and only
 * this one persona is closed. The interface answers it with the persona's
 * own gate, not the full lock screen — a full-screen lock would be a lie
 * about the other personas, which are perfectly readable.
 */
export function personaLockedError(locale: Locale): TRPCError {
  const error = new TRPCError({
    code: "FORBIDDEN",
    message: copy(locale, "lock.personaPinNeeded"),
  });
  (error as { mirraiCode?: string }).mirraiCode = "PERSONA_LOCKED";
  return error;
}

/** Whether an error came from `lockedError`. */
export function isLockedError(error: unknown): boolean {
  return error instanceof TRPCError && (error as { mirraiCode?: unknown }).mirraiCode === "LOCKED";
}

/**
 * Whether this persona needs the PIN in the last five minutes.
 *
 * The app's own lock is checked before this; a persona can be locked
 * while the app is not.
 */
export async function personaLocked(
  settings: { locked?: boolean } | null | undefined,
  sessionKey: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!settings?.locked) return false;
  return !(await hasRecentUnlock(sessionKey, now));
}

/**
 * Whether a non-tRPC request may go through.
 *
 * `/uploads`, the SSE chat route, the streaming upload, backups and the
 * phone socket are not tRPC, so they ask this themselves after they know
 * who is calling.
 */
export async function isRequestLocked(
  req: Request,
  user: { lockSettings?: unknown },
  now = Date.now(),
): Promise<boolean> {
  const settings = lockSettingsOf(user);
  if (!settings.enabled) return false;
  return isSessionLocked(settings, sessionKeyFromRequest(req), now);
}

/**
 * Whether a non-tRPC request may go through, sliding the idle window when
 * it may.
 *
 * The manual says every request that passes the check postpones the lock
 * by `idleMinutes`. A tRPC call gets that from `appLockGuard`; the
 * non-tRPC routes use this instead of the read-only `isRequestLocked`,
 * so watching photographs or streaming a reply is not "idle time".
 * Routes that only *ask* whether the session is locked (the scheduler's
 * backup sweep) keep using `isRequestLocked`.
 */
export async function refreshRequestLock(
  req: Request,
  user: { lockSettings?: unknown },
  now = Date.now(),
): Promise<boolean> {
  const settings = lockSettingsOf(user);
  if (!settings.enabled) return false;
  const sessionKey = sessionKeyFromRequest(req);
  if (await isSessionLocked(settings, sessionKey, now)) return true;
  await touchUnlock(settings, sessionKey, now);
  return false;
}
