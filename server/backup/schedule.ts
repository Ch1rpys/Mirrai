/**
 * The nightly backup the user scheduled (C8.3).
 *
 * It runs in the scheduler's tick, one user at a time. Each run:
 *
 *  1. is due (`isBackupDue`: a day or a week since the last one);
 *  2. creates the archive where it belongs — a temporary file that is
 *     encrypted when a passphrase is set;
 *  3. hands it to the destination (folder, WebDAV or S3);
 *  4. records the file name, deletes the ones beyond the retention
 *     window, and saves the result on the user's row.
 *
 * A failure is written to `lastError` as a token the settings page
 * translates; it never stops the other users' backups, and never throws
 * out of the scheduler's tick.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BACKUP_RETENTION,
  backupFileName,
  isBackupDue,
  isRemoteBackupTarget,
  normalizeBackupSettings,
  type BackupSettings,
} from "@shared/backup";
import { decryptIfEncrypted } from "../_core/crypto";
import { createBackup } from "../_core/backup";
import { isEncryptionLocked, logPostponed } from "../encryption/lock";
import {
  BackupDeliveryError,
  deleteBackupFile,
  deliverBackupFile,
  type BackupCredentials,
} from "./targets";

/** A user row the scheduler reads. */
export interface ScheduledBackupUser {
  id: number;
  backupSettings: unknown;
}

/** The error tokens `lastError` can hold. */
export type BackupErrorToken =
  | "creation_failed"
  | "delivery_failed"
  | "missing_credentials"
  | "s3_too_large"
  | "folder_missing"
  | "folder_write_failed"
  | "http_failed"
  | "passphrase_missing"
  | "backup_failed";

/** What the dependency injection lets a test replace. */
export interface ScheduledBackupDeps {
  getUsers: () => Promise<ScheduledBackupUser[]>;
  saveSettings: (userId: number, settings: BackupSettings) => Promise<unknown>;
  create: typeof createBackup;
  deliver: typeof deliverBackupFile;
  remove: typeof deleteBackupFile;
  decrypt: (payload: string | null | undefined) => Promise<string | null>;
  now?: () => Date;
  uploadsDir?: string;
  fetchImpl?: typeof fetch;
}

/** What one scheduler pass did. */
export interface ScheduledBackupSummary {
  ran: number;
  failed: number;
}

function errorToken(error: unknown): BackupErrorToken {
  if (error instanceof BackupDeliveryError) return error.reason;
  return "backup_failed";
}

/** The credentials a target needs, decrypted for this run. */
async function credentialsFor(
  settings: BackupSettings,
  decrypt: ScheduledBackupDeps["decrypt"],
): Promise<BackupCredentials> {
  const target = settings.target;
  if (!target) return {};
  if (target.kind === "webdav") {
    const password = await decrypt(target.passwordSecret ?? null);
    return password ? { password } : {};
  }
  if (target.kind === "s3") {
    const secretAccessKey = await decrypt(target.secretAccessKeySecret ?? null);
    return secretAccessKey ? { secretAccessKey } : {};
  }
  return {};
}

/**
 * Runs the due scheduled backups.
 *
 * Everything that touches the database or the network is injected so
 * the decision logic (due, retention, failure recording) can be tested
 * without either.
 */
export async function runScheduledBackups(
  now: Date = new Date(),
  deps?: Partial<ScheduledBackupDeps>,
): Promise<ScheduledBackupSummary> {
  const getUsers =
    deps?.getUsers ??
    (async () => {
      const { getUsersWithBackupSettings } = await import("../db");
      return getUsersWithBackupSettings();
    });
  const saveSettings =
    deps?.saveSettings ??
    (async (userId: number, settings: BackupSettings) => {
      const { setUserBackupSettings } = await import("../db");
      return setUserBackupSettings(userId, settings);
    });
  const create = deps?.create ?? createBackup;
  const deliver = deps?.deliver ?? deliverBackupFile;
  const remove = deps?.remove ?? deleteBackupFile;
  const decrypt = deps?.decrypt ?? decryptIfEncrypted;
  const clock = deps?.now ?? (() => now);
  const fetchImpl = deps?.fetchImpl;

  let users: ScheduledBackupUser[];
  try {
    users = await getUsers();
  } catch (error) {
    console.warn("[Backup] Could not read the scheduled backups:", error);
    return { ran: 0, failed: 0 };
  }

  let ran = 0;
  let failed = 0;

  for (const user of users) {
    const settings = normalizeBackupSettings(user.backupSettings);
    if (!settings.enabled || !settings.target) continue;
    if (!isBackupDue(settings, clock())) continue;
    /**
     * An encrypted account whose key is not in this process still has
     * ciphertext in its rows — a backup of it would be a backup of
     * bytes nobody can read (C8.5). The run waits for the next
     * sign-in, like the other background jobs.
     */
    if (await isEncryptionLocked(user.id)) {
      logPostponed(user.id, "backup");
      continue;
    }

    const startedAt = clock();
    const passphrase = await decrypt(settings.passphraseSecret ?? null);

    // A wrapped passphrase that no longer opens is a failure, not a
    // reason to write the backup unencrypted: the user asked for the
    // file to be private.
    if ((settings.passphraseSecret && !passphrase) || (isRemoteBackupTarget(settings.target) && !passphrase)) {
      failed += 1;
      await saveSettings(user.id, {
        ...settings,
        lastError: "passphrase_missing",
        lastRunAt: startedAt.toISOString(),
      }).catch(() => undefined);
      continue;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-scheduled-backup-"));
    try {
      const fileName = backupFileName(startedAt, Boolean(passphrase));
      const file = path.join(tempDir, fileName);
      const created = await create({
        scope: user.id,
        passphrase,
        out: file,
        uploadsDir: deps?.uploadsDir,
      });
      const credentials = await credentialsFor(settings, decrypt);
      await deliver({
        target: settings.target,
        credentials,
        file,
        fileName,
        fetchImpl,
        now: startedAt,
      });

      const allNames = [...(settings.history ?? []), fileName];
      const stale = allNames.slice(0, Math.max(0, allNames.length - BACKUP_RETENTION));
      const history = allNames.slice(-BACKUP_RETENTION);
      for (const name of stale) {
        try {
          await remove({ target: settings.target, credentials, fileName: name, fetchImpl });
        } catch (error) {
          console.warn(`[Backup] Could not delete the old backup ${name}:`, error);
        }
      }
      await saveSettings(user.id, {
        ...settings,
        lastRunAt: startedAt.toISOString(),
        lastFileName: fileName,
        history,
      }).catch((error) => {
        console.warn("[Backup] The backup was written but its settings could not be saved:", error);
      });
      void created;
      ran += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[Backup] The scheduled backup for user ${user.id} failed:`, error);
      await saveSettings(user.id, {
        ...settings,
        lastRunAt: startedAt.toISOString(),
        lastError: errorToken(error),
      }).catch(() => undefined);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { ran, failed };
}
