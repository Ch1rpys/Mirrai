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
  }
  return result;
}

/** Whether an account's content is encrypted. */
export function encryptionEnabled(value: unknown): boolean {
  return normalizeUserEncryption(value) !== null;
}
