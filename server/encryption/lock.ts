/**
 * "This account's content is encrypted and this process does not have
 * the key" (C8.5 step 5).
 *
 * The scheduler runs for everybody: deferred replies, letter answers,
 * proactive messages, capsules and scheduled backups. For an encrypted
 * account whose key is not in memory — after a restart, before the
 * person signs in — running those jobs would work on ciphertext or
 * write plaintext into an encrypted account. So they are postponed to
 * the next sign-in, with one log line, and nothing throws.
 *
 * The check reads `users.encryption` rather than trusting the process
 * cache: a cold process has no cache, and the whole point is the cold
 * process.
 */
import { normalizeUserEncryption } from "@shared/encryption";
import { hasDataKey } from "../_core/data-keys";
import { rememberEncryptionState } from "../_core/encrypted-values";
import { getUserEncryption } from "../db";

/**
 * Whether this user's content is encrypted and unreadable right now.
 *
 * A failure to read the account is treated as "not locked": a database
 * hiccup must not stop the scheduler for everyone, and the job that
 * then runs will fail on the decryption with a log line of its own.
 */
export async function isEncryptionLocked(userId: number): Promise<boolean> {
  let value: unknown;
  try {
    value = await getUserEncryption(userId);
  } catch {
    return false;
  }
  const encryption = normalizeUserEncryption(value);
  rememberEncryptionState(userId, value);
  if (!encryption) return false;
  return !hasDataKey(userId);
}

/**
 * Drops the items whose owner is locked.
 *
 * Each user is asked once per call, so a sweep with twenty due items
 * from three people makes three queries, not twenty. This is the shape
 * every sweep uses before it starts working on rows.
 */
export async function withoutEncryptionLocked<T>(
  items: T[],
  userIdOf: (item: T) => number,
  sweep = "sweep",
): Promise<T[]> {
  if (items.length === 0) return items;
  const locked = new Map<number, boolean>();
  const out: T[] = [];
  for (const item of items) {
    const id = userIdOf(item);
    let isLocked = locked.get(id);
    if (isLocked === undefined) {
      isLocked = await isEncryptionLocked(id);
      locked.set(id, isLocked);
      if (isLocked) logPostponed(id, sweep);
    }
    if (!isLocked) out.push(item);
  }
  return out;
}

/** The log line the scheduler writes for a postponed user. */
export function logPostponed(userId: number, sweep: string): void {
  console.log(
    `[Scheduler] ${sweep}: user ${userId}'s data key is not unlocked — postponed until the next sign-in (C8.5).`,
  );
}
