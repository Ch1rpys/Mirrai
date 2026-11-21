/**
 * Resuming interrupted enable/disable jobs (C8.5 step 5).
 *
 * A job that was running when the process stopped is finished by the
 * scheduler: the progress is in `users.encryption`, so this only has to
 * find the accounts with a pending job and, when their key is in memory,
 * let the background runner continue.
 *
 * An account whose key is not here (nobody signed in since the restart)
 * is skipped with one log line — the job, like its letters and its
 * deferred replies, waits for the person to come back.
 */
import { normalizeUserEncryption } from "@shared/encryption";
import { hasDataKey } from "../_core/data-keys";
import { rememberEncryptionState } from "../_core/encrypted-values";
import { getUsersWithPendingEncryptionMigration } from "../db";
import { startMigrationInBackground } from "./migrate";

/** How many jobs were resumed. */
export async function resumeEncryptionMigrations(): Promise<number> {
  let resumed = 0;
  let pending: Array<{ id: number; encryption: unknown }>;
  try {
    pending = await getUsersWithPendingEncryptionMigration();
  } catch (error) {
    console.warn("[Encryption] Could not read the pending migrations:", error);
    return 0;
  }
  for (const row of pending) {
    const encryption = normalizeUserEncryption(row.encryption);
    if (!encryption?.migration) continue;
    rememberEncryptionState(row.id, row.encryption);
    if (!hasDataKey(row.id)) {
      console.log(
        `[Encryption] user ${row.id}'s ${encryption.migration.direction} job is waiting for the next sign-in (C8.5).`,
      );
      continue;
    }
    startMigrationInBackground(row.id);
    resumed += 1;
  }
  return resumed;
}
