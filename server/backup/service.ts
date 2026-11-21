/**
 * What the backup routes need from the database and the rest of the app.
 *
 * Kept as its own module so the route file can be tested with these
 * three functions mocked, without a reachable database.
 */
import { getDb } from "../db";
import { instanceIsEmpty } from "../_core/backup-tables";
import { restoreBackup, type RestoredBackup } from "../_core/backup";

/** Whether a restore is possible at all: no user exists yet. */
export async function instanceIsEmptyForRoute(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  return instanceIsEmpty(db as never);
}

/** Restores a backup; the route does the error mapping. */
export async function restoreBackupForRoute(input: {
  file: string;
  passphrase: string | null;
}): Promise<RestoredBackup> {
  return restoreBackup({ file: input.file, passphrase: input.passphrase });
}
