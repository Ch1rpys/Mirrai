/**
 * The enable/disable migration of existing rows (C8.5 step 6).
 *
 * Turning encryption on cannot rewrite a whole database inside one HTTP
 * request: a persona may hold a million records. So enabling starts a
 * background job that walks every encrypted table, five hundred rows at
 * a time, and transforms one column per row. Turning it off runs the
 * same job in reverse.
 *
 * The job's position lives in `users.encryption.migration`, not in
 * memory: a process that stops in the middle is resumed by the next
 * scheduler tick, and the settings page can say how far it has got.
 *
 * Half-old, half-new is a legal state for every read (`server/db.ts`
 * passes plaintext through), so an interrupted job never loses data —
 * it just leaves the remaining rows in the other form until it runs
 * again.
 */
import { sql } from "drizzle-orm";
import { normalizeUserEncryption, type EncryptionMigration } from "@shared/encryption";
import { searchTokens as bigramTokens } from "@shared/search-tokens";
import { blindIndexToken } from "../_core/content-crypto";
import { dataKeyFor, forgetDataKey } from "../_core/data-keys";
import {
  EncryptionKeyMissingError,
  ENCRYPTED_TABLE_NAMES,
  ENCRYPTED_TABLES,
  decryptJsonForRead,
  decryptRecordMetaForRead,
  decryptTextForRead,
  encryptValueFor,
  encryptionEnabledFor,
  forgetEncryptionState,
  rememberEncryptionState,
  setEncryptionEnabled,
  type EncryptedColumnSpec,
} from "../_core/encrypted-values";
import { getDb, getUserEncryption, setUserEncryption } from "../db";

/** How many rows one batch rewrites. The manual asks for five hundred. */
export const MIGRATION_BATCH_SIZE = 500;

/** How long the background loop lets the event loop breathe. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A literal Postgres text array, for `array_to_tsvector`. */
function textArrayLiteral(values: string[]): string {
  return `{${values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}

interface ColumnWork {
  table: string;
  column: string;
  kind: "text" | "json";
  tokens: boolean;
  meta: boolean;
}

/** The flat list of columns the job walks, derived from the registry. */
const COLUMNS: ColumnWork[] = ENCRYPTED_TABLE_NAMES.flatMap((table) =>
  (ENCRYPTED_TABLES[table].columns as readonly EncryptedColumnSpec[]).map((spec) => ({
    table,
    column: spec.column,
    kind: spec.kind,
    tokens: spec.tokens === true,
    meta: spec.column === "meta",
  })),
);

/** The SQL predicate for rows that still need the job's direction applied. */
function needsWorkPredicate(work: ColumnWork, direction: "encrypt" | "decrypt"): string {
  const column = `"${work.column}"`;
  if (work.kind === "text") {
    return direction === "encrypt"
      ? `${column} IS NOT NULL AND ${column} NOT LIKE 'enc:v1:%'`
      : `${column} LIKE 'enc:v1:%'`;
  }
  const wrapped = `(${column} IS NOT NULL AND jsonb_typeof(${column}) = 'object' AND ${column} ? 'enc' AND jsonb_typeof(${column}->'enc') = 'string')`;
  return direction === "encrypt" ? `${column} IS NOT NULL AND NOT ${wrapped}` : wrapped;
}

/**
 * How many rows still need work, across every encrypted column.
 *
 * A full scan of every encrypted column; it runs once when the job
 * starts (for the progress total) and once when it finishes (as the
 * proof that nothing was missed).
 */
export async function countMigrationWork(
  userId: number,
  direction: "encrypt" | "decrypt",
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  let total = 0;
  for (const work of COLUMNS) {
    const result = await db.execute(sql.raw(
      `SELECT count(*)::int AS n FROM "${work.table}" WHERE "userId" = ${userId} AND ${needsWorkPredicate(work, direction)}`,
    ));
    const row = (result as unknown as { rows?: Array<{ n?: unknown }> }).rows?.[0];
    total += Number(row?.n ?? 0);
  }
  return total;
}

/** One row as the job sees it: its id and the value of the column. */
interface MigrationRow {
  id: number;
  value: unknown;
}

/** Reads the next rows of one column that need work. */
async function nextRows(work: ColumnWork, userId: number, direction: "encrypt" | "decrypt", limit: number): Promise<MigrationRow[]> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.execute(sql.raw(
    `SELECT "id", "${work.column}" AS value FROM "${work.table}" WHERE "userId" = ${userId} AND ${needsWorkPredicate(work, direction)} ORDER BY "id" LIMIT ${limit}`,
  ));
  const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  return rows.map((row) => ({ id: Number(row.id), value: row.value }));
}

/** Writes one transformed value back, and its search tokens when the column has them. */
async function writeRow(
  work: ColumnWork,
  userId: number,
  id: number,
  value: unknown,
  plaintextForTokens: string | null,
  direction: "encrypt" | "decrypt",
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const tokenSql = work.tokens
    ? sql`, "searchTokens" = array_to_tsvector(${textArrayLiteral(
        plaintextForTokens === null
          ? []
          : direction === "encrypt"
            ? bigramTokens(plaintextForTokens).map((token) => blindIndexToken(requireKey(userId), token))
            : bigramTokens(plaintextForTokens),
      )}::text[])`
    : sql``;
  if (work.kind === "json") {
    await db.execute(sql`
      UPDATE ${sql.raw(`"${work.table}"`)}
      SET "${sql.raw(work.column)}" = ${JSON.stringify(value)}::jsonb
      WHERE "id" = ${id}
    `);
    return;
  }
  await db.execute(sql`
    UPDATE ${sql.raw(`"${work.table}"`)}
    SET "${sql.raw(work.column)}" = ${String(value)}${tokenSql}
    WHERE "id" = ${id}
  `);
}

/** The key a token update needs; named so the error says why. */
function requireKey(userId: number): Buffer {
  const key = dataKeyFor(userId);
  if (!key) throw new EncryptionKeyMissingError(userId);
  return key;
}

/** Transforms one value in the given direction. */
function transformValue(work: ColumnWork, userId: number, value: unknown, direction: "encrypt" | "decrypt"): {
  value: unknown;
  plaintextForTokens: string | null;
} {
  if (direction === "encrypt") {
    const encrypted = encryptValueFor(userId, work.kind, value, work.meta);
    return {
      value: encrypted,
      plaintextForTokens: work.tokens ? String(value ?? "") : null,
    };
  }
  if (work.kind === "json") {
    return {
      value: work.meta ? decryptRecordMetaForRead(userId, value) : decryptJsonForRead(userId, value),
      plaintextForTokens: null,
    };
  }
  const plaintext = decryptTextForRead(userId, String(value));
  return { value: plaintext, plaintextForTokens: work.tokens ? plaintext ?? "" : null };
}

export interface MigrationStepResult {
  processed: number;
  /** True when a whole pass over every column found nothing left to do. */
  finished: boolean;
}

/**
 * Runs at most one batch of the job.
 *
 * The walk starts from the first column every time; each call stops
 * once it has written `batchSize` rows. When a whole pass writes
 * nothing, the job is finished. That is what makes the job resumable
 * without storing a cursor: `WHERE the value still needs work` is the
 * cursor.
 */
export async function runMigrationStep(
  userId: number,
  direction: "encrypt" | "decrypt",
  batchSize: number = MIGRATION_BATCH_SIZE,
): Promise<MigrationStepResult> {
  let processed = 0;
  for (const work of COLUMNS) {
    if (processed >= batchSize) return { processed, finished: false };
    let remaining = batchSize - processed;
    for (;;) {
      if (remaining <= 0) break;
      const rows = await nextRows(work, userId, direction, remaining);
      if (rows.length === 0) break;
      for (const row of rows) {
        const transformed = transformValue(work, userId, row.value, direction);
        await writeRow(work, userId, row.id, transformed.value, transformed.plaintextForTokens, direction);
        processed += 1;
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }
  }
  if (processed >= batchSize) return { processed, finished: false };
  // A pass that wrote less than a batch and found no more rows anywhere
  // is the end. The caller does one final count to be sure.
  return { processed, finished: true };
}

/** Reads `users.encryption.migration` back as a plain object. */
async function currentMigration(userId: number): Promise<{ encryption: ReturnType<typeof normalizeUserEncryption>; migration: EncryptionMigration | null }> {
  const encryption = normalizeUserEncryption(await getUserEncryption(userId));
  return { encryption, migration: encryption?.migration ?? null };
}

/** Persists the job's progress without touching anything else. */
async function writeMigration(
  userId: number,
  encryption: NonNullable<ReturnType<typeof normalizeUserEncryption>>,
  migration: EncryptionMigration | null,
): Promise<void> {
  const next: Record<string, unknown> = { ...encryption };
  if (migration) next.migration = migration;
  else delete next.migration;
  await setUserEncryption(userId, next);
}

/**
 * Runs the job to completion.
 *
 * The scheduler calls this for a user whose migration is pending and
 * whose key is in memory; the tests call it directly, which is the same
 * path minus the scheduling. `maxSteps` exists so a test can stop in
 * the middle and read the half-migrated table.
 */
export async function runMigration(
  userId: number,
  direction: "encrypt" | "decrypt",
  options: { batchSize?: number; maxSteps?: number; onProgress?: (done: number, total: number) => Promise<void> | void } = {},
): Promise<{ done: number; total: number; finished: boolean }> {
  const other = await currentMigration(userId);
  if (!other.encryption) throw new Error("This account is not encrypted.");
  if (!encryptionEnabledFor(userId)) setEncryptionEnabled(userId, true);
  const total = other.migration?.total ?? (await countMigrationWork(userId, direction));
  let done = other.migration?.done ?? 0;
  let finished = false;
  let steps = 0;
  while (!finished) {
    if (options.maxSteps !== undefined && steps >= options.maxSteps) break;
    const step = await runMigrationStep(userId, direction, options.batchSize ?? MIGRATION_BATCH_SIZE);
    done = Math.min(total, done + step.processed);
    const current = await currentMigration(userId);
    if (!current.encryption) throw new Error("This account is not encrypted.");
    await writeMigration(userId, current.encryption, {
      direction,
      startedAt: current.migration?.startedAt ?? new Date().toISOString(),
      total,
      done,
    });
    await options.onProgress?.(done, total);
    finished = step.finished;
    steps += 1;
    if (!finished) await yieldToEventLoop();
  }
  if (finished) {
    // The proof: a final count over every column. A row changed while
    // the job was running would show here rather than be missed.
    const leftover = await countMigrationWork(userId, direction);
    if (leftover > 0) {
      // Start again rather than call it done; a row edited during the
      // job (or a new one written before the enable flag took effect)
      // is picked up by the next pass.
      return { done, total, finished: false };
    }
    await finishMigration(userId, direction);
  }
  return { done, total, finished };
}

/** Clears the job record and applies the end state of the direction. */
async function finishMigration(userId: number, direction: "encrypt" | "decrypt"): Promise<void> {
  if (direction === "encrypt") {
    const { encryption } = await currentMigration(userId);
    if (!encryption) return;
    /**
     * The finished row must not keep `migration` — the settings page
     * reads it as "a job is still running". The old object is spread
     * with the job removed.
     */
    const { migration: _finished, ...withoutJob } = encryption;
    const finished = { ...withoutJob, migratedAt: new Date().toISOString() };
    await setUserEncryption(userId, finished);
    rememberEncryptionState(userId, finished);
    setEncryptionEnabled(userId, true);
    return;
  }
  /**
   * Disabled: every row is plaintext again, so the key is no longer
   * needed and the account goes back to being an ordinary one.
   */
  await setUserEncryption(userId, null);
  setEncryptionEnabled(userId, false);
  forgetEncryptionState(userId);
  forgetDataKey(userId);
}

/** Stores the job record just before a background run starts. */
export async function beginMigration(
  userId: number,
  direction: "encrypt" | "decrypt",
  total: number,
): Promise<void> {
  const { encryption } = await currentMigration(userId);
  if (!encryption) throw new Error("This account is not encrypted.");
  await writeMigration(userId, encryption, {
    direction,
    startedAt: new Date().toISOString(),
    total,
    done: 0,
  });
}

/** Records a failure on the job, so the page can show why it stopped. */
export async function recordMigrationError(userId: number, message: string): Promise<void> {
  const { encryption, migration } = await currentMigration(userId);
  if (!encryption) return;
  await writeMigration(userId, encryption, {
    direction: migration?.direction ?? "encrypt",
    startedAt: migration?.startedAt ?? new Date().toISOString(),
    total: migration?.total ?? 0,
    done: migration?.done ?? 0,
    error: message.slice(0, 500),
  });
}

// ─── The background runner ────────────────────────────────────────────────

const running = new Set<number>();

/** Whether a background run is in this process right now. */
export function isMigrationRunning(userId: number): boolean {
  return running.has(userId);
}

/**
 * Continues the job in the background.
 *
 * Idempotent per process: a second call while one is running does
 * nothing. Failures are recorded on the row rather than thrown into a
 * request's response.
 */
export function startMigrationInBackground(userId: number): void {
  if (running.has(userId)) return;
  running.add(userId);
  void (async () => {
    try {
      for (;;) {
        const { encryption, migration } = await currentMigration(userId);
        if (!encryption || !migration) return;
        const result = await runMigration(userId, migration.direction, {
          onProgress: async (done, total) => {
            const current = await currentMigration(userId);
            if (current.encryption) {
              await writeMigration(userId, current.encryption, {
                direction: migration.direction,
                startedAt: migration.startedAt,
                total,
                done,
              });
            }
          },
        });
        if (!result.finished) {
          // Another pass is needed (a row was written while the job ran).
          await yieldToEventLoop();
          continue;
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Encryption] The migration for user ${userId} stopped:`, message);
      await recordMigrationError(userId, message).catch(() => undefined);
    } finally {
      running.delete(userId);
    }
  })();
}
