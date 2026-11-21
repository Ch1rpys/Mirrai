/**
 * The cryptography behind the encrypted database (C8.5).
 *
 * Two different things are encrypted here, with the same primitive
 * (AES-256-GCM) and different keys:
 *
 * - **the data key**: 32 random bytes per account, wrapped with a key
 *   derived from the login password (scrypt). The wrapped form is what
 *   `users.encryption.wrappedKey` holds; the plain key only ever lives
 *   in this process's memory.
 * - **the content**: every value of the columns listed in the manual is
 *   encrypted with the account's data key and written as
 *   `enc:v1:<nonce>:<tag>:<ciphertext>`. A value without the prefix is
 *   returned as it is — that is what makes an enable/disable migration
 *   safe to interrupt: half old plaintext, half new ciphertext is a
 *   normal state, not a corrupt one.
 *
 * Each value gets its own random nonce, so the same sentence encrypted
 * twice gives two different strings. The tag makes a single changed byte
 * fail to decrypt rather than produce garbage.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ENCRYPTION_KEY_BYTES, ENCRYPTION_KDF } from "@shared/encryption";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * The KDF parameters for the wrapping key.
 *
 * Deliberately the same cost as the password hash (N=2^15, r=8, p=1):
 * this key is derived from a password once, at sign-in, and the account
 * data is worth more than a login attempt. `maxmem` is above the 32 MiB
 * the parameters need.
 */
export const WRAP_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

/** The ciphertext of one value. */
export const CONTENT_PREFIX = "enc:v1:";

/** The wrapped-form prefix of the data key itself. */
const WRAPPED_PREFIX = "v1:";

/** The salt and nonce length in bytes. */
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The recovery code's groups and group size, for the printed form. */
const RECOVERY_GROUPS = 6;
const RECOVERY_GROUP_LENGTH = 4;

/** Thrown when a value says it is encrypted and cannot be decrypted. */
export class ContentDecryptionError extends Error {
  constructor(message = "The encrypted value could not be decrypted.") {
    super(message);
    this.name = "ContentDecryptionError";
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** A fresh 32-byte data key. */
export function generateDataKey(): Buffer {
  return randomBytes(ENCRYPTION_KEY_BYTES);
}

/** A fresh KDF salt, base64url. */
export function generateSalt(): string {
  return base64url(randomBytes(SALT_BYTES));
}

/**
 * Derives the key that wraps the data key from a password.
 *
 * The password is normalised the same way the password hash does it, so
 * the same characters derive the same key.
 */
export async function derivePasswordKey(
  password: string,
  salt: string,
  parameters: { N: number; r: number; p: number; maxmem: number } = WRAP_SCRYPT,
): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), ENCRYPTION_KEY_BYTES, parameters);
}

/** Wraps bytes with a key: `v1:<nonce>:<tag>:<cipher>`. */
export function wrapWithKey(key: Buffer, plaintext: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${WRAPPED_PREFIX}${base64url(nonce)}:${base64url(tag)}:${base64url(ciphertext)}`;
}

/** Unwraps bytes; null when the key is wrong or the value was changed. */
export function unwrapWithKey(key: Buffer, wrapped: string): Buffer | null {
  if (typeof wrapped !== "string" || !wrapped.startsWith(WRAPPED_PREFIX)) return null;
  const parts = wrapped.slice(WRAPPED_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  try {
    const nonce = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

/** Wraps a data key with the account's password. */
export async function wrapDataKeyForPassword(
  dataKey: Buffer,
  password: string,
): Promise<{ wrappedKey: string; salt: string; kdf: typeof ENCRYPTION_KDF }> {
  const salt = generateSalt();
  const wrappingKey = await derivePasswordKey(password, salt);
  return { wrappedKey: wrapWithKey(wrappingKey, dataKey), salt, kdf: ENCRYPTION_KDF };
}

/** Unwraps a data key with the account's password; null when it does not fit. */
export async function unwrapDataKeyWithPassword(
  wrappedKey: string,
  salt: string,
  password: string,
): Promise<Buffer | null> {
  const wrappingKey = await derivePasswordKey(password, salt);
  const dataKey = unwrapWithKey(wrappingKey, wrappedKey);
  if (!dataKey || dataKey.length !== ENCRYPTION_KEY_BYTES) return null;
  return dataKey;
}

/**
 * A recovery code: six groups of four base32-ish characters.
 *
 * The characters avoid the ones people misread (no 0/O, 1/I), because
 * the whole point is that somebody writes it on paper. The code is
 * shown once and never stored.
 */
export function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH);
  const characters: string[] = [];
  for (const byte of bytes) characters.push(alphabet[byte % alphabet.length]);
  const groups: string[] = [];
  for (let index = 0; index < characters.length; index += RECOVERY_GROUP_LENGTH) {
    groups.push(characters.slice(index, index + RECOVERY_GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}

/** The recovery code, in the form the derivation uses. */
export function normalizeRecoveryCode(code: string): string {
  return code.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Wraps a data key with a recovery code; returns the wrapped form. */
export async function wrapDataKeyForRecovery(
  dataKey: Buffer,
  recoveryCode: string,
  salt = generateSalt(),
): Promise<{ recoveryWrappedKey: string; salt: string }> {
  const key = await derivePasswordKey(normalizeRecoveryCode(recoveryCode), salt);
  return { recoveryWrappedKey: wrapWithKey(key, dataKey), salt };
}

/** Unwraps a data key with a recovery code; null when it does not fit. */
export async function unwrapDataKeyWithRecovery(
  recoveryWrappedKey: string,
  salt: string,
  recoveryCode: string,
): Promise<Buffer | null> {
  const key = await derivePasswordKey(normalizeRecoveryCode(recoveryCode), salt);
  const dataKey = unwrapWithKey(key, recoveryWrappedKey);
  if (!dataKey || dataKey.length !== ENCRYPTION_KEY_BYTES) return null;
  return dataKey;
}

/** Whether a stored value is the app's ciphertext. */
export function isEncryptedContent(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(CONTENT_PREFIX);
}

/** Encrypts one value, with a fresh nonce. */
export function encryptContent(dataKey: Buffer, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CONTENT_PREFIX}${base64url(nonce)}:${base64url(tag)}:${base64url(ciphertext)}`;
}

/**
 * Reads one value: plaintext stays plaintext, ciphertext is decrypted.
 *
 * Returns null when a value that *is* ciphertext cannot be decrypted —
 * a wrong key, a changed byte, a truncated value. The caller decides
 * whether that is an error (a route) or a skipped row (a measurement).
 */
export function tryDecryptContent(dataKey: Buffer, value: string): string | null {
  if (!isEncryptedContent(value)) return value;
  const parts = value.slice(CONTENT_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  try {
    const nonce = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", dataKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Reads one value, throwing when it says it is encrypted and is not readable. */
export function decryptContent(dataKey: Buffer, value: string): string {
  const decrypted = tryDecryptContent(dataKey, value);
  if (decrypted === null) throw new ContentDecryptionError();
  return decrypted;
}

/**
 * The key the search index is built with.
 *
 * The tokens are hashed with an HMAC rather than encrypted because only
 * equality matters: a query token must match the stored token without
 * the stored column being readable. Derived from the data key so there is
 * nothing else to store and nothing else to lose.
 */
export function searchIndexKey(dataKey: Buffer): Buffer {
  return createHmac("sha256", dataKey).update("mirrai-search-index").digest();
}

/** The blind index of one token: sixteen hex characters. */
export function blindIndexToken(dataKey: Buffer, token: string): string {
  return createHmac("sha256", searchIndexKey(dataKey)).update(token).digest("hex").slice(0, 16);
}

/** Constant-time comparison, so a token comparison does not leak. */
export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
