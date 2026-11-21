/**
 * The unwrapped data keys, in this process's memory (C8.5).
 *
 * A user's 32-byte data key is unwrapped at sign-in (or from the
 * recovery code) and kept here, because every database read and write of
 * that account needs it and asking for the password on every query is
 * not a thing. It never goes to disk and never goes back to the browser.
 *
 * The manual says "随会话过期清掉". The session is a year-long cookie,
 * so "with the session" would mean a year; instead a key that has not
 * been used for a day is dropped, and a password change or an explicit
 * lock drops it at once. Either way, the next request from that account
 * asks for the password again (`encryption.unlock`) rather than serving
 * ciphertext.
 *
 * The interface is synchronous on purpose: the Drizzle column codec
 * reads it from inside a synchronous encode/decode, so it cannot await.
 */
import { ENCRYPTION_KEY_BYTES } from "@shared/encryption";

/** How long an unused key is kept. */
export const DATA_KEY_IDLE_MS = 24 * 60 * 60_000;

interface Entry {
  key: Buffer;
  lastUsed: number;
}

const keys = new Map<number, Entry>();

/** Puts an unwrapped key in place (sign-in, unlock, password change). */
export function rememberDataKey(userId: number, dataKey: Buffer): void {
  if (dataKey.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error("A data key must be 32 bytes.");
  }
  keys.set(userId, { key: Buffer.from(dataKey), lastUsed: Date.now() });
}

/**
 * The key for this account, or null when it is not unlocked here.
 *
 * Touching it slides the idle window; an entry older than a day is
 * dropped and reported as missing.
 */
export function dataKeyFor(userId: number): Buffer | null {
  const entry = keys.get(userId);
  if (!entry) return null;
  const now = Date.now();
  if (now - entry.lastUsed > DATA_KEY_IDLE_MS) {
    keys.delete(userId);
    return null;
  }
  entry.lastUsed = now;
  return entry.key;
}

/** Whether this account is unlocked in this process. */
export function hasDataKey(userId: number): boolean {
  return dataKeyFor(userId) !== null;
}

/** Forgets the key: an explicit lock, a password change, a sign-out. */
export function forgetDataKey(userId: number): void {
  keys.delete(userId);
}

/** Drops every key. Process shutdown and tests. */
export function forgetAllDataKeys(): void {
  keys.clear();
}

/** How many accounts are unlocked (the scheduler logs this once a tick). */
export function unlockedDataKeyCount(): number {
  return keys.size;
}
