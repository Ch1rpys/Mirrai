/**
 * Turning the encrypted database on and off (C8.5 steps 6–7).
 *
 * Three operations live here:
 *
 * - **enable**: create the account's data key, wrap it with the login
 *   password and a one-time recovery code, and start the background job
 *   that encrypts the rows already in the database. A full backup has to
 *   exist first: losing both the password and the recovery code is the
 *   one failure that cannot be undone from inside the app.
 * - **disable**: run the same job in reverse and then forget the key.
 * - **recover**: unwrap the data key with the recovery code and set a
 *   new login password.
 *
 * The route layer owns the error vocabulary; this module throws typed
 * errors so the mapping to copy keys stays in one place.
 */
import {
  generateDataKey,
  generateRecoveryCode,
  unwrapDataKeyWithPassword,
  unwrapDataKeyWithRecovery,
  wrapDataKeyForPassword,
  wrapDataKeyForRecovery,
} from "../_core/content-crypto";
import { dataKeyFor, hasDataKey, rememberDataKey } from "../_core/data-keys";
import {
  rememberEncryptionState,
  setEncryptionEnabled,
} from "../_core/encrypted-values";
import { hashPassword, verifyPassword } from "../_core/password";
import { normalizeBackupSettings } from "@shared/backup";
import { normalizeUserEncryption, type UserEncryption } from "@shared/encryption";
import {
  bumpUserTokenVersion,
  getUserBackupSettings,
  getUserById,
  getUsersWithPendingEncryptionMigration,
  setUserEncryption,
  updateUserPassword,
} from "../db";
import {
  countMigrationWork,
  recordMigrationError,
  runMigration,
  startMigrationInBackground,
} from "./migrate";

/** The reasons enabling, disabling or recovering can refuse. */
export type EncryptionSetupCode =
  | "already_enabled"
  | "not_enabled"
  | "backup_required"
  | "password_wrong"
  | "key_failed"
  | "migration_running"
  | "recovery_missing"
  | "recovery_wrong"
  | "weak_password"
  | "user_not_found";

export class EncryptionSetupError extends Error {
  constructor(readonly code: EncryptionSetupCode) {
    super(code);
    this.name = "EncryptionSetupError";
  }
}

/** The shape the settings page reads. */
export interface EncryptionStatus {
  enabled: boolean;
  unlocked: boolean;
  hasRecoveryCode: boolean;
  /**
   * Whether a full backup has been downloaded (C8.5's precondition for
   * enabling). The settings page uses it to say what is missing before
   * the button is pressed; the server checks it again anyway.
   */
  hasFullBackup: boolean;
  /** True while the enable/disable job is still running. */
  migrating: boolean;
  migration: {
    direction: "encrypt" | "decrypt";
    done: number;
    total: number;
    error?: string;
  } | null;
  migratedAt: string | null;
}

/** The account's state, from the caller's persisted row. */
export async function encryptionStatusForUser(userId: number): Promise<EncryptionStatus> {
  const user = await getUserById(userId);
  const encryption = normalizeUserEncryption(user?.encryption);
  const backup = normalizeBackupSettings(await getUserBackupSettings(userId));
  if (!encryption) {
    return {
      enabled: false,
      unlocked: false,
      hasRecoveryCode: false,
      hasFullBackup: Boolean(backup.lastFullBackupAt),
      migrating: false,
      migration: null,
      migratedAt: null,
    };
  }
  return {
    enabled: true,
    unlocked: hasDataKey(userId),
    hasRecoveryCode: Boolean(encryption.recoveryWrappedKey),
    hasFullBackup: Boolean(backup.lastFullBackupAt),
    migrating: Boolean(encryption.migration),
    migration: encryption.migration
      ? {
          direction: encryption.migration.direction,
          done: encryption.migration.done,
          total: encryption.migration.total,
          ...(encryption.migration.error ? { error: encryption.migration.error } : {}),
        }
      : null,
    migratedAt: encryption.migratedAt ?? null,
  };
}

/** Reads and verifies the account password, returning the row. */
async function userAndPassword(userId: number, password: string) {
  const user = await getUserById(userId);
  if (!user) throw new EncryptionSetupError("user_not_found");
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new EncryptionSetupError("password_wrong");
  return user;
}

/**
 * Turns encryption on, then starts encrypting the existing rows.
 *
 * Returns the recovery code, which is the only time it is ever
 * available: it is not stored, only a wrapped copy of the data key made
 * with it.
 */
export async function enableEncryptionForUser(
  userId: number,
  password: string,
  /**
   * The tests drive the batch job themselves (to stop it midway); the
   * app never passes this, so the job always starts in the background.
   */
  options: { startInBackground?: boolean } = {},
): Promise<{ recoveryCode: string; total: number }> {
  const user = await userAndPassword(userId, password);
  if (normalizeUserEncryption(user.encryption)) {
    throw new EncryptionSetupError("already_enabled");
  }
  /**
   * A full backup has to exist first.
   *
   * Losing the password and the recovery code together means the
   * content is gone; a backup made before enabling is the one thing
   * that limits that loss to "the backups are plaintext".
   */
  const backup = normalizeBackupSettings(await getUserBackupSettings(userId));
  if (!backup.lastFullBackupAt) throw new EncryptionSetupError("backup_required");

  const dataKey = generateDataKey();
  const wrapped = await wrapDataKeyForPassword(dataKey, password);
  const recoveryCode = generateRecoveryCode();
  const recovery = await wrapDataKeyForRecovery(dataKey, recoveryCode);

  const total = await countMigrationWork(userId, "encrypt");
  const encryption: UserEncryption = {
    enabled: true,
    ...wrapped,
    recoveryWrappedKey: recovery.recoveryWrappedKey,
    recoverySalt: recovery.salt,
    migration: {
      direction: "encrypt",
      startedAt: new Date().toISOString(),
      total,
      done: 0,
    },
  };
  await setUserEncryption(userId, encryption);
  rememberEncryptionState(userId, encryption);
  setEncryptionEnabled(userId, true);
  rememberDataKey(userId, dataKey);
  if (options.startInBackground !== false) startMigrationInBackground(userId);
  return { recoveryCode, total };
}

/**
 * Turns encryption off: decrypt every row in the background.
 *
 * The account stays "encrypted" until the job finishes, so a write that
 * happens midway is still ciphertext and the job catches it. The key is
 * forgotten only when the last row is plaintext.
 */
export async function disableEncryptionForUser(
  userId: number,
  password: string,
): Promise<{ total: number }> {
  const user = await userAndPassword(userId, password);
  const encryption = normalizeUserEncryption(user.encryption);
  if (!encryption) throw new EncryptionSetupError("not_enabled");
  if (encryption.migration) throw new EncryptionSetupError("migration_running");

  const key =
    dataKeyFor(userId) ??
    (await unwrapDataKeyWithPassword(encryption.wrappedKey, encryption.salt, password));
  if (!key) throw new EncryptionSetupError("key_failed");

  const total = await countMigrationWork(userId, "decrypt");
  const withJob: UserEncryption = {
    ...encryption,
    migration: {
      direction: "decrypt",
      startedAt: new Date().toISOString(),
      total,
      done: 0,
    },
  };
  await setUserEncryption(userId, withJob);
  rememberEncryptionState(userId, withJob);
  rememberDataKey(userId, key);
  startMigrationInBackground(userId);
  return { total };
}

/**
 * Re-wraps the data key after a password change (C8.5).
 *
 * The key itself never changes; only the password-derived wrapper does.
 * The recovery wrap keeps its own salt, so the recovery code still
 * works after a password change.
 */
export async function rewrapDataKeyForNewPassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await getUserById(userId);
  if (!user) throw new EncryptionSetupError("user_not_found");
  const encryption = normalizeUserEncryption(user.encryption);
  if (!encryption) return;
  const dataKey =
    dataKeyFor(userId) ??
    (await unwrapDataKeyWithPassword(encryption.wrappedKey, encryption.salt, currentPassword));
  if (!dataKey) throw new EncryptionSetupError("key_failed");
  const wrapped = await wrapDataKeyForPassword(dataKey, newPassword);
  await setUserEncryption(userId, {
    ...encryption,
    ...wrapped,
    ...(encryption.recoveryWrappedKey ? { recoveryWrappedKey: encryption.recoveryWrappedKey } : {}),
  });
  rememberDataKey(userId, dataKey);
  setEncryptionEnabled(userId, true);
}

/**
 * Sets a new password using the recovery code.
 *
 * The data key is unwrapped with the recovery code, so the content
 * stays readable; the password wrap (and the recovery wrap, with the
 * same new salt) are replaced together.
 */
export async function resetPasswordWithRecovery(
  userId: number,
  recoveryCode: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new EncryptionSetupError("weak_password");
  }
  const user = await getUserById(userId);
  if (!user) throw new EncryptionSetupError("user_not_found");
  const encryption = normalizeUserEncryption(user.encryption);
  if (!encryption) throw new EncryptionSetupError("not_enabled");
  if (!encryption.recoveryWrappedKey) throw new EncryptionSetupError("recovery_missing");

  const dataKey = await unwrapDataKeyWithRecovery(
    encryption.recoveryWrappedKey,
    encryption.recoverySalt ?? encryption.salt,
    recoveryCode,
  );
  if (!dataKey) throw new EncryptionSetupError("recovery_wrong");

  const wrapped = await wrapDataKeyForPassword(dataKey, newPassword);
  const recovery = await wrapDataKeyForRecovery(dataKey, recoveryCode);
  await setUserEncryption(userId, {
    ...encryption,
    ...wrapped,
    recoveryWrappedKey: recovery.recoveryWrappedKey,
    recoverySalt: recovery.salt,
  });
  await updateUserPassword(userId, await hashPassword(newPassword));
  await bumpUserTokenVersion(userId);
  rememberDataKey(userId, dataKey);
  setEncryptionEnabled(userId, true);
}

/**
 * Runs a pending migration to completion.
 *
 * Used by the scheduler (through `startMigrationInBackground`) and by
 * the acceptance tests, which need to stop it midway.
 */
export async function runPendingMigrationForTests(
  userId: number,
  options: { maxSteps?: number; batchSize?: number } = {},
) {
  const rows = await getUsersWithPendingEncryptionMigration();
  const row = rows.find((entry) => entry.id === userId);
  const encryption = normalizeUserEncryption(row?.encryption);
  if (!encryption?.migration) return { done: 0, total: 0, finished: true };
  try {
    return await runMigration(userId, encryption.migration.direction, {
      maxSteps: options.maxSteps,
      batchSize: options.batchSize,
    });
  } catch (error) {
    await recordMigrationError(userId, error instanceof Error ? error.message : String(error)).catch(
      () => undefined,
    );
    throw error;
  }
}
