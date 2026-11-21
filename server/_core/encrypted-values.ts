/**
 * Transparent encryption of the content columns (C8.5).
 *
 * The manual's rule is that only the database layer knows about the
 * ciphertext: every write of a listed column is encrypted on the way to
 * PostgreSQL, every read decrypts on the way back, and the code above
 * `server/db.ts` cannot tell the difference. This module is that layer's
 * toolkit — the list of columns, the per-process record of which
 * accounts are encrypted, and the two value transforms.
 *
 * Three properties the rest of the design leans on:
 *
 *  - **Plaintext rows are legal.** A value that does not start with
 *    `enc:v1:` is returned as it is, so an interrupted enable/disable
 *    migration — half old, half new — is a normal state rather than a
 *    corrupt one.
 *  - **Reads need no state.** If a value says it is ciphertext, the key
 *    is required; if it does not, the value passes through. So reading
 *    never has to ask "is this account encrypted?".
 *  - **Writes need the state.** A write has to know whether to encrypt.
 *    The state is cached per process and seeded when the user's row is
 *    read (`getUserById` and friends) — which every authenticated request
 *    does before a write. The cache defaults to "not encrypted" so an
 *    ordinary account pays nothing.
 *
 * `collected_messages.meta` is a special case: its `register` field is
 * filtered in SQL (`meta->>'register'`), so the register has to stay
 * readable in the JSON. It is duplicated at the top level and the whole
 * object is also encrypted; the SQL filter keeps working and the content
 * stays ciphertext.
 */
import { normalizeUserEncryption } from "@shared/encryption";
import { searchTokens as bigramTokens } from "@shared/search-tokens";
import {
  blindIndexToken,
  decryptContent,
  encryptContent,
  isEncryptedContent,
  tryDecryptContent,
} from "./content-crypto";
import { dataKeyFor } from "./data-keys";

/** How one column is stored. */
export type EncryptedValueKind = "text" | "json";

export interface EncryptedColumnSpec {
  column: string;
  kind: EncryptedValueKind;
  /**
   * The column has a `searchTokens` companion that is rebuilt from the
   * text whenever the text is transformed. Only `content` columns.
   */
  tokens?: boolean;
}

/**
 * Every table and column the manual lists for encryption.
 *
 * Keep this list next to the migration job: the job walks it, the
 * acceptance test checks every entry against a table read, and adding a
 * column to `drizzle/schema.ts` without adding it here is a silent
 * plaintext column.
 */
export const ENCRYPTED_TABLES = {
  messages: { columns: [{ column: "content", kind: "text", tokens: true }] },
  memories: { columns: [{ column: "title", kind: "text" }, { column: "description", kind: "text" }] },
  letters: { columns: [{ column: "body", kind: "text" }, { column: "replyText", kind: "text" }] },
  outbound_letters: {
    columns: [{ column: "text", kind: "text" }, { column: "outcomeNote", kind: "text" }],
  },
  user_journal: { columns: [{ column: "body", kind: "text" }] },
  diary_entries: {
    columns: [
      { column: "summary", kind: "text" },
      { column: "reflection", kind: "text" },
      { column: "highlights", kind: "json" },
      { column: "quotes", kind: "json" },
      { column: "emotionalArc", kind: "json" },
    ],
  },
  collected_messages: {
    columns: [{ column: "content", kind: "text", tokens: true }, { column: "meta", kind: "json" }],
  },
  personas: {
    columns: [{ column: "personaData", kind: "json" }, { column: "styleProfile", kind: "json" }],
  },
  rehearsals: { columns: [{ column: "line", kind: "text" }, { column: "result", kind: "json" }] },
  roleplay_sessions: { columns: [{ column: "transcript", kind: "json" }] },
  scheduled_items: { columns: [{ column: "body", kind: "text" }] },
  oral_accounts: { columns: [{ column: "body", kind: "text" }] },
  /**
   * Persona snapshots copy `personas.personaData` and `styleProfile`.
   *
   * Not in the manual's column list, but it is the same content in
   * another place: leaving it plaintext would make "the content is
   * encrypted" false the moment a version is taken.
   */
  persona_versions: {
    columns: [{ column: "personaData", kind: "json" }, { column: "styleProfile", kind: "json" }],
  },
} as const satisfies Record<string, { columns: readonly EncryptedColumnSpec[] }>;

export type EncryptedTable = keyof typeof ENCRYPTED_TABLES;

/** The tables in a stable order, for the migration job and its tests. */
export const ENCRYPTED_TABLE_NAMES = Object.keys(ENCRYPTED_TABLES) as EncryptedTable[];

/** Thrown when an encrypted account's key is not in this process. */
export class EncryptionKeyMissingError extends Error {
  constructor(readonly userId: number) {
    super(`The data key for user ${userId} is not unlocked in this process.`);
    this.name = "EncryptionKeyMissingError";
  }
}

/** Whether `table` has any encrypted column (used for structural tests). */
export function isEncryptedTable(name: string): name is EncryptedTable {
  return name in ENCRYPTED_TABLES;
}

// ─── The per-process state cache ──────────────────────────────────────────

const enabledCache = new Map<number, boolean>();

/**
 * Records whether an account's content is encrypted.
 *
 * Called from the user-row readers in `server/db.ts` with the raw
 * `users.encryption` value, so any request that has loaded the user has
 * the answer cached before it writes anything.
 */
export function rememberEncryptionState(userId: number, encryption: unknown): void {
  enabledCache.set(userId, normalizeUserEncryption(encryption) !== null);
}

/** Sets the state explicitly (enable/disable, and the tests). */
export function setEncryptionEnabled(userId: number, enabled: boolean): void {
  enabledCache.set(userId, enabled);
}

/** Forgets one account's state (a disable, or a test). */
export function forgetEncryptionState(userId: number): void {
  enabledCache.delete(userId);
}

/** Forgets every account's state (process shutdown and tests). */
export function forgetAllEncryptionStates(): void {
  enabledCache.clear();
}

/**
 * Whether this account encrypts its writes.
 *
 * The cache is authoritative when it has an entry. A data key is only
 * ever remembered for an encrypted account, so its presence is a safe
 * answer when the cache is cold. Otherwise the account is treated as
 * unencrypted — the case for every account that never turned this on.
 */
export function encryptionEnabledFor(userId: number): boolean {
  const cached = enabledCache.get(userId);
  if (cached !== undefined) return cached;
  return dataKeyFor(userId) !== null;
}

/**
 * The cached state, when the process has learned it.
 *
 * Reads use this only for one edge: a plaintext account whose own text
 * happens to begin with `enc:v1:` must read back as itself, not as an
 * unreadable ciphertext. The state is seeded when the user row is read,
 * which every authenticated request does.
 */
export function encryptionStateCached(userId: number): boolean | undefined {
  return enabledCache.get(userId);
}

/** The data key a write needs; throws when the account is encrypted but locked. */
export function requireDataKeyForWrite(userId: number): Buffer {
  const key = dataKeyFor(userId);
  if (!key) throw new EncryptionKeyMissingError(userId);
  return key;
}

// ─── Value transforms ─────────────────────────────────────────────────────

/**
 * Encrypts one text value for a write.
 *
 * A null stays null (there is nothing to hide). An unencrypted account's
 * value stays plaintext. An encrypted account without its key cannot
 * write: storing plaintext there would silently break the promise the
 * settings page makes, so the write fails instead.
 */
export function encryptTextForWrite(userId: number, value: string | null): string | null {
  if (value === null) return null;
  if (!encryptionEnabledFor(userId)) return value;
  return encryptContent(requireDataKeyForWrite(userId), value);
}

/** Encrypts one JSON value for a write: `{ "enc": "<ciphertext of the JSON>" }`. */
export function encryptJsonForWrite(userId: number, value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (!encryptionEnabledFor(userId)) return value;
  const key = requireDataKeyForWrite(userId);
  return { enc: encryptContent(key, JSON.stringify(value)) };
}

/**
 * Encrypts a record's `meta`.
 *
 * `register` is duplicated at the top level because several SQL queries
 * filter on `meta->>'register'` (records are private by default, and the
 * public/written/group rows must stay findable). Everything else,
 * including the register again, is inside the ciphertext.
 */
export function encryptRecordMetaForWrite(userId: number, meta: unknown): unknown {
  if (meta === null || meta === undefined) return meta ?? null;
  if (!encryptionEnabledFor(userId)) return meta;
  const key = requireDataKeyForWrite(userId);
  const wrapped: Record<string, unknown> = { enc: encryptContent(key, JSON.stringify(meta)) };
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const register = (meta as Record<string, unknown>).register;
    if (typeof register === "string" && register) wrapped.register = register;
  }
  return wrapped;
}

/**
 * Decrypts one text value read from the database.
 *
 * Plaintext passes through. Ciphertext requires the key: returning it
 * as it is would show a person the app's own base64, and returning an
 * empty string would pretend the row was empty. A missing key is an
 * error the caller can turn into "enter your password".
 */
export function decryptTextForRead(userId: number, value: string | null): string | null {
  if (value === null) return null;
  if (!isEncryptedContent(value)) return value;
  /**
   * A plaintext account's own sentence may begin with the ciphertext
   * prefix. The state cache says which kind of account this is — but
   * it is only consulted when the cache has an answer, so this stays a
   * state-free read for every ordinary row.
   */
  const key = dataKeyFor(userId);
  if (!key && encryptionStateCached(userId) === false) return value;
  if (!key) throw new EncryptionKeyMissingError(userId);
  return decryptContent(key, value);
}

/** Decrypts one JSON value. A `{ enc }` object is decrypted; anything else passes through. */
export function decryptJsonForRead(userId: number, value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const wrapped = value as Record<string, unknown>;
  if (!isEncryptedContent(wrapped.enc)) return value;
  const key = dataKeyFor(userId);
  if (!key && encryptionStateCached(userId) === false) return value;
  if (!key) throw new EncryptionKeyMissingError(userId);
  const plaintext = decryptContent(key, wrapped.enc as string);
  try {
    return JSON.parse(plaintext);
  } catch {
    return plaintext;
  }
}

/**
 * Decrypts a record's `meta`.
 *
 * The encrypted form keeps `register` beside the ciphertext for the SQL
 * filters; the plaintext object already contains it, so the decrypted
 * value is the original object. A legacy plaintext `meta` passes
 * through unchanged.
 */
export function decryptRecordMetaForRead(userId: number, value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object" || Array.isArray(value)) return value;
  const wrapped = value as Record<string, unknown>;
  if (!isEncryptedContent(wrapped.enc)) return value;
  const key = dataKeyFor(userId);
  if (!key && encryptionStateCached(userId) === false) return value;
  if (!key) throw new EncryptionKeyMissingError(userId);
  const plaintext = decryptContent(key, wrapped.enc as string);
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      // The top-level copy is authoritative for the SQL filters; put it
      // back if an older writer ever left it out of the ciphertext.
      if (record.register === undefined && typeof wrapped.register === "string") {
        record.register = wrapped.register;
      }
      return record;
    }
    return parsed;
  } catch {
    return plaintext;
  }
}

/** One row's value for one encrypted column, decrypted. */
function decryptColumnValue(userId: number, spec: EncryptedColumnSpec, value: unknown): unknown {
  if (spec.kind === "json") {
    return spec.column === "meta"
      ? decryptRecordMetaForRead(userId, value)
      : decryptJsonForRead(userId, value);
  }
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "string") return value;
  return decryptTextForRead(userId, value);
}

/** One row's value for one encrypted column, encrypted. */
function encryptColumnValue(userId: number, spec: EncryptedColumnSpec, value: unknown): unknown {
  if (spec.kind === "json") {
    return spec.column === "meta"
      ? encryptRecordMetaForWrite(userId, value)
      : encryptJsonForWrite(userId, value);
  }
  if (typeof value !== "string") return value;
  return encryptTextForWrite(userId, value);
}

/**
 * Decrypts every encrypted column present in a set of rows.
 *
 * The key belongs to the row's owner (`row.userId`), not to the caller:
 * a family member reading a shared persona's row is reading the owner's
 * content, and the owner's key is the one it was encrypted with. Rows
 * without a `userId` are returned untouched — that is a projection that
 * cannot need the key.
 */
export function decryptRowsForRead<T extends Record<string, unknown>>(
  table: EncryptedTable,
  rows: T[],
): T[] {
  if (rows.length === 0) return rows;
  const specs = ENCRYPTED_TABLES[table].columns;
  const out: T[] = [];
  for (const row of rows) {
    const userId = typeof row.userId === "number" ? row.userId : null;
    if (userId === null) {
      out.push(row);
      continue;
    }
    const copy: Record<string, unknown> = { ...row };
    for (const spec of specs) {
      if (!(spec.column in copy)) continue;
      copy[spec.column] = decryptColumnValue(userId, spec, copy[spec.column]);
    }
    out.push(copy as T);
  }
  return out;
}

/** One row, decrypted. */
export function decryptRowForRead<T extends Record<string, unknown>>(
  table: EncryptedTable,
  row: T | null | undefined,
): T | null | undefined {
  if (!row) return row;
  const [decrypted] = decryptRowsForRead(table, [row]);
  return decrypted;
}

/**
 * Encrypts the encrypted columns present in a write payload.
 *
 * Only the keys that are actually being written are touched, so a
 * partial update (`{ status: "answered", replyText }`) encrypts the
 * answer and leaves the columns it does not mention alone. The payload
 * must carry the owning user's id, either as `userId` or as the second
 * argument.
 */
export function encryptWriteValues<T extends Record<string, unknown>>(
  table: EncryptedTable,
  userId: number,
  values: T,
): T {
  const specs = ENCRYPTED_TABLES[table].columns;
  const out: Record<string, unknown> = { ...values };
  for (const spec of specs) {
    if (!(spec.column in out)) continue;
    out[spec.column] = encryptColumnValue(userId, spec, out[spec.column]);
  }
  return out as T;
}

/** One value, encrypted (used by the migration job and its tests). */
export function encryptValueFor(
  userId: number,
  kind: EncryptedValueKind,
  value: unknown,
  meta = false,
): unknown {
  if (kind === "json") {
    return meta ? encryptRecordMetaForWrite(userId, value) : encryptJsonForWrite(userId, value);
  }
  return value === null || value === undefined ? value ?? null : encryptTextForWrite(userId, String(value));
}

// ─── The blind index ──────────────────────────────────────────────────────

/** Whether this account's search tokens are blind (C8.5 step 4). */
export function usesBlindIndex(userId: number): boolean {
  return encryptionEnabledFor(userId);
}

/**
 * The tokens a record's text is indexed under for this account.
 *
 * Plaintext accounts index character bigrams. Encrypted accounts index
 * an HMAC of every bigram: equality still matches a query, and the
 * stored column says nothing about the words.
 */
export function indexTokensFor(userId: number, content: string): string[] {
  const tokens = bigramTokens(content);
  if (!encryptionEnabledFor(userId)) return tokens;
  const key = requireDataKeyForWrite(userId);
  return tokens.map((token) => blindIndexToken(key, token));
}

/** The tokens a query is looked up with: the same transform as the stored ones. */
export function queryTokensFor(userId: number, lexemes: string[]): string[] {
  if (!encryptionEnabledFor(userId)) return lexemes;
  const key = requireDataKeyForWrite(userId);
  return lexemes.map((token) => blindIndexToken(key, token));
}

/** If the value happens to be one of the app's ciphertexts, report it as such. */
export function looksEncrypted(value: unknown): boolean {
  return isEncryptedContent(value);
}

/** Reads a value for display, or null when it cannot be decrypted. */
export function tryReadText(userId: number, value: string | null): string | null {
  if (value === null) return null;
  if (!isEncryptedContent(value)) return value;
  const key = dataKeyFor(userId);
  if (!key) return null;
  return tryDecryptContent(key, value);
}
