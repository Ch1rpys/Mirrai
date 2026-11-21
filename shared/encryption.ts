/**
 * The shape of `users.encryption` (C8.5).
 *
 * The content of the database is encrypted with one 32-byte data key per
 * account. The key itself is never stored: it is wrapped (AES-256-GCM)
 * with a key derived from the login password (scrypt), and optionally
 * with a second key derived from a one-time recovery code.
 *
 * Everything here is only the *shape* and the rules. The cryptography
 * lives in `server/_core/content-crypto.ts`; this file is imported by
 * both the server and the interface (the settings panel says what the
 * account has), so it must stay free of Node-only imports.
 */

/** The KDF the wrapped key was made with. One value today. */
export const ENCRYPTION_KDF = "scrypt";

/** The size of the data key, in bytes. AES-256. */
export const ENCRYPTION_KEY_BYTES = 32;

/** The direction of a row migration (enable or disable). */
export type EncryptionMigrationDirection = "encrypt" | "decrypt";

/**
 * The batch job that turns existing rows into the new form.
 *
 * Enabling encryption cannot rewrite a whole database in one request:
 * it is a background job that processes five hundred rows at a time.
 * The progress lives in `users.encryption` so it survives a restart and
 * the settings page can show how far it has got.
 */
export interface EncryptionMigration {
  direction: EncryptionMigrationDirection;
  /** ISO time the job started. */
  startedAt: string;
  /** Rows that needed work when the job started. */
  total: number;
  /** Rows finished since. */
  done: number;
  /** The last failure, when the job stopped on one. */
  error?: string;
}

export interface UserEncryption {
  /** Whether this account's content is encrypted. */
  enabled: boolean;
  /** The data key, wrapped with the login-password key. */
  wrappedKey: string;
  /** The salt the login-password key was derived with, base64url. */
  salt: string;
  /** The KDF that made the wrapping key. */
  kdf: typeof ENCRYPTION_KDF;
  /** The data key, wrapped with a key derived from the recovery code. */
  recoveryWrappedKey?: string;
  /**
   * The salt the recovery wrap used.
   *
   * Separate from the login-password salt because a password change
   * replaces that one, and the recovery wrap must not depend on a salt
   * the app no longer has. Older rows (from before this field existed)
   * fall back to `salt`.
   */
  recoverySalt?: string;
  /** A row migration in progress, or absent when there is none. */
  migration?: EncryptionMigration;
  /** When the last enable/disable job finished. */
  migratedAt?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The stored value, or null when the account is not encrypted.
 *
 * A half-written value (enabled but no wrapped key, or an unknown KDF)
 * is "not encrypted" rather than a crash: the settings panel can say the
 * account is not encrypted, and no write ever produces this shape — only
 * a hand edit or an interrupted upgrade can.
 */
export function normalizeUserEncryption(value: unknown): UserEncryption | null {
  if (!isPlainObject(value)) return null;
  if (value.enabled !== true) return null;
  const wrappedKey = typeof value.wrappedKey === "string" ? value.wrappedKey.trim() : "";
  const salt = typeof value.salt === "string" ? value.salt.trim() : "";
  const kdf = value.kdf === ENCRYPTION_KDF ? ENCRYPTION_KDF : null;
  if (!wrappedKey || !salt || !kdf) return null;
  const result: UserEncryption = { enabled: true, wrappedKey, salt, kdf };
  if (typeof value.recoveryWrappedKey === "string" && value.recoveryWrappedKey.trim()) {
    result.recoveryWrappedKey = value.recoveryWrappedKey.trim();
    if (typeof value.recoverySalt === "string" && value.recoverySalt.trim()) {
      result.recoverySalt = value.recoverySalt.trim();
    }
  }
  const migration = normalizeMigration(value.migration);
  if (migration) result.migration = migration;
  if (typeof value.migratedAt === "string" && Number.isFinite(Date.parse(value.migratedAt))) {
    result.migratedAt = value.migratedAt;
  }
  return result;
}

/** A migration record, or null when it is absent or malformed. */
function normalizeMigration(value: unknown): EncryptionMigration | null {
  if (!isPlainObject(value)) return null;
  if (value.direction !== "encrypt" && value.direction !== "decrypt") return null;
  const startedAt =
    typeof value.startedAt === "string" && Number.isFinite(Date.parse(value.startedAt))
      ? value.startedAt
      : new Date(0).toISOString();
  const total = Number(value.total);
  const done = Number(value.done);
  return {
    direction: value.direction,
    startedAt,
    total: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0,
    done: Number.isFinite(done) && done >= 0 ? Math.floor(done) : 0,
    ...(typeof value.error === "string" && value.error ? { error: value.error.slice(0, 500) } : {}),
  };
}

/** Whether an account's content is encrypted. */
export function encryptionEnabled(value: unknown): boolean {
  return normalizeUserEncryption(value) !== null;
}

/** Whether a row migration is in progress. */
export function encryptionMigrationOf(value: unknown): EncryptionMigration | null {
  return normalizeUserEncryption(value)?.migration ?? null;
}
