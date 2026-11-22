/**
 * The tables a backup contains (C8.3).
 *
 * The list is derived from `drizzle/schema.ts` rather than written down
 * here: a new table that is not in the list and not in the exclusion
 * list would silently be missing from every backup, and nobody would
 * find out until a restore. `server/_core/backup-tables.test.ts` is what
 * turns that "nobody would find out" into a failing test.
 *
 * Rows are moved as NDJSON through a staging directory. Dumping uses
 * keyset pagination so a million-row persona does not have to fit in
 * memory; restoring uses one `jsonb_populate_recordset` per batch, so a
 * whole table's rows go in one statement without hand-writing a column
 * list per table.
 */
import { and, sql, type SQL } from "drizzle-orm";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../drizzle/schema";
import { decodeByteaValue } from "./backup-format";

/** The most rows a restore sends in one INSERT. */
export const BACKUP_RESTORE_BATCH = 500;

/** The most rows a dump reads per SELECT. */
export const BACKUP_DUMP_BATCH = 5000;

/** A table the backup deliberately leaves out. */
export interface BackupExcludedTable {
  table: string;
  reason: string;
}

/**
 * Tables that are not user data.
 *
 * `schema_migrations` records which SQL files this installation has
 * applied. It is installation state, not the person's data: a restore
 * runs the migrations itself, and copying another installation's
 * journal would make the restore believe work it has not done was done.
 */
export const BACKUP_EXCLUDED_TABLES: BackupExcludedTable[] = [
  {
    table: "schema_migrations",
    reason: "installation state; a restore applies the migrations itself",
  },
];

export interface BackupTableInfo {
  /** The table name in PostgreSQL. */
  name: string;
  /** The drizzle table, for column inspection. */
  table: PgTable;
  /** Column names, in schema order. */
  columns: string[];
}

/** Every table declared in `drizzle/schema.ts`, in declaration order. */
export function schemaTables(): BackupTableInfo[] {
  const out: BackupTableInfo[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const table = value as PgTable;
    out.push({
      name: getTableName(table),
      table,
      columns: Object.keys(getTableColumns(table)),
    });
  }
  return out;
}

/** One foreign-key edge between two tables that are both in a list. */
export interface BackupTableDependency {
  child: string;
  parent: string;
}

/**
 * The references between a list of tables, as child → parent edges.
 *
 * Postgres checks a foreign key on the statement that inserts the child
 * row, so the parent has to have been restored first. This is read from
 * the schema itself — a new `.references()` appears here without anyone
 * having to remember to update an ordering list by hand.
 */
export function backupTableDependencies(
  tables: BackupTableInfo[],
): BackupTableDependency[] {
  const names = new Set(tables.map((table) => table.name));
  const edges: BackupTableDependency[] = [];
  for (const info of tables) {
    for (const foreignKey of getTableConfig(info.table).foreignKeys) {
      const parent = getTableName(foreignKey.reference().foreignTable);
      // References to a table that is not in this list (an excluded
      // table, or a one-user backup that leaves it out) cannot be
      // ordered against anything here.
      if (parent === info.name || !names.has(parent)) continue;
      edges.push({ child: info.name, parent });
    }
  }
  return edges;
}

/** A stable name order, used as the tie-break inside a dependency order. */
function byName(a: BackupTableInfo, b: BackupTableInfo): number {
  return a.name.localeCompare(b.name);
}

/**
 * Orders tables so that every referenced table comes before the tables
 * that reference it, with `users` first and ties in name order.
 *
 * The input order is deliberately not used for anything but membership:
 * `Object.values(schema)` yields a different order in different module
 * systems (a namespace object is sorted by export name; a bundled object
 * literal keeps the declaration order), and the restore has to be
 * correct under whichever one the process happened to get.
 *
 * A cycle would mean two tables that cannot both be inserted first; the
 * remaining tables are then appended by name rather than lost, so the
 * restore still attempts every table and reports the real problem.
 */
export function orderBackupTables(tables: BackupTableInfo[]): BackupTableInfo[] {
  const parents = new Map<string, string[]>();
  for (const table of tables) parents.set(table.name, []);
  for (const edge of backupTableDependencies(tables)) parents.get(edge.child)!.push(edge.parent);

  const pending = new Map(tables.map((table) => [table.name, table]));
  const ordered: BackupTableInfo[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((table) =>
      parents.get(table.name)!.every((parent) => !pending.has(parent)),
    );
    if (ready.length === 0) {
      ordered.push(...[...pending.values()].sort(byName));
      break;
    }
    ready.sort((a, b) => {
      if (a.name === "users") return -1;
      if (b.name === "users") return 1;
      return byName(a, b);
    });
    const next = ready[0]!;
    ordered.push(next);
    pending.delete(next.name);
  }
  return ordered;
}

/**
 * The tables a backup writes, in the order they are written.
 *
 * The order is a dependency order (see `orderBackupTables`) rather than
 * the order the tables appear in `drizzle/schema.ts`: `letters` is
 * declared before `personas`, and the restore used to insert it first,
 * which fails on any instance that has a letter. `users` still comes
 * first so an operator reading the archive sees the people before the
 * things that belong to them.
 */
export function backupTables(): BackupTableInfo[] {
  const excluded = new Set(BACKUP_EXCLUDED_TABLES.map((entry) => entry.table));
  return orderBackupTables(schemaTables().filter((entry) => !excluded.has(entry.name)));
}

/** The tables and the reason each one is not in this backup. */
export function backupExclusions(
  scope: "instance" | number,
  tables = schemaTables(),
): BackupExcludedTable[] {
  const out: BackupExcludedTable[] = [...BACKUP_EXCLUDED_TABLES];
  if (scope === "instance") return out;
  const included = new Set(backupTables().map((entry) => entry.name));
  for (const entry of tables) {
    if (!included.has(entry.name)) continue;
    if (scopeCoversTable(entry, scope)) continue;
    out.push({
      table: entry.name,
      reason: "no user link in this table, so a one-user backup cannot say which rows are theirs",
    });
  }
  return out;
}

function scopeCoversTable(table: BackupTableInfo, scope: number): boolean {
  if (table.name === "users") return true;
  return table.columns.includes("userId") || table.columns.includes("personaId");
}

/**
 * The SQL predicate for a one-user backup.
 *
 * A table is reached either by its own `userId`, by a `personaId` that
 * belongs to the user, or — for `users` itself — by the id. The schema
 * has no foreign keys, so this is the same reasoning a human does when
 * asked "which rows of this table are this person's".
 */
function userScopeSql(table: BackupTableInfo, userId: number) {
  if (table.name === "users") return sql`${sql.raw(`"id"`)} = ${userId}`;
  if (table.columns.includes("userId")) {
    return sql`${sql.raw(`"userId"`)} = ${userId}`;
  }
  // A table reached through the persona: the personas row carries the
  // owner, so this is still this user's data. A table with neither link
  // is refused by the caller rather than guessed at.
  return sql`${sql.raw(`"personaId"`)} IN (SELECT "id" FROM "personas" WHERE "userId" = ${userId})`;
}

/** Quotes an identifier for a SQL statement built here. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** What `dumpTableRows` needs from the database handle. */
export interface BackupExecutor {
  execute: (query: SQL) => Promise<unknown>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  return rows as Array<Record<string, unknown>>;
}

/**
 * Reads one table (or one user's rows) in batches, oldest id first.
 *
 * `yield` returns a batch, not a row, so the caller hashes and writes
 * the serialised lines together.
 */
export async function* dumpTableRows(
  db: BackupExecutor,
  table: BackupTableInfo,
  scope: "instance" | number,
  batchSize = BACKUP_DUMP_BATCH,
): AsyncGenerator<Array<Record<string, unknown>>> {
  const identifier = quoteIdentifier(table.name);
  const scoped =
    scope === "instance" ? null : scopeCoversTable(table, scope) ? userScopeSql(table, scope) : null;
  if (scope !== "instance" && scoped === null) return;
  const hasId = table.columns.includes("id");

  let lastId: number | null = null;
  for (;;) {
    let query: SQL;
    if (hasId) {
      const idFilter = sql`${sql.raw(`"id"`)} > ${lastId ?? 0}`;
      const where = scoped ? sql`${and(idFilter, scoped)}` : idFilter;
      query = sql`SELECT * FROM ${sql.raw(identifier)} WHERE ${where} ORDER BY ${sql.raw(`"id"`)} ASC LIMIT ${batchSize}`;
    } else {
      const where = scoped ? sql` WHERE ${scoped}` : sql.raw("");
      // A table without an id is small (lookup tables), so one pass is
      // enough and the OFFSET is not worth the bookkeeping.
      query = sql`SELECT * FROM ${sql.raw(identifier)}${where}`;
    }
    const batch = rowsOf(await db.execute(query));
    if (batch.length === 0) return;
    yield batch;
    if (!hasId) return;
    const last = batch[batch.length - 1];
    const id = Number(last.id);
    if (!Number.isFinite(id)) return;
    lastId = id;
    if (batch.length < batchSize) return;
  }
}

/**
 * Restores one batch of rows.
 *
 * `jsonb_populate_recordset` maps each JSON object onto the table's row
 * type by column name — the same cast PostgreSQL does for an INSERT, so
 * timestamps, enums, jsonb and tsvector all come back without a
 * per-table column list. Rows with bytes were marked by
 * `serializeBackupRow`; their marker is turned back into bytea input
 * here.
 */
export async function insertRowsBatch(
  db: BackupExecutor,
  table: BackupTableInfo,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const known = new Set(table.columns);
  const columns = new Set<string>();
  const prepared: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!known.has(key)) continue;
      columns.add(key);
      out[key] = decodeByteaValue(value);
    }
    prepared.push(out);
  }
  if (prepared.length === 0) return;
  const list = Array.from(columns).map(quoteIdentifier).join(", ");
  const payload = JSON.stringify(prepared);
  await db.execute(
    sql`INSERT INTO ${sql.raw(quoteIdentifier(table.name))} (${sql.raw(list)}) SELECT ${sql.raw(list)} FROM jsonb_populate_recordset(NULL::${sql.raw(quoteIdentifier(table.name))}, ${payload}::jsonb)`,
  );
}

/**
 * Moves every table's id sequence past the largest restored id.
 *
 * Without this the next insert after a restore reuses ids that the
 * backup already handed out, and a brand-new message takes the place of
 * an old one. Tables that have no owned sequence (or no rows) are left
 * alone: `setval` on a missing sequence is a NULL, and `setval(seq, 1,
 * false)` on an empty table is skipped too.
 */
export async function resetSequences(
  db: BackupExecutor,
  tables: BackupTableInfo[],
): Promise<number> {
  let moved = 0;
  for (const table of tables) {
    if (!table.columns.includes("id")) continue;
    const identifier = quoteIdentifier(table.name);
    const result = await db.execute(
      sql`SELECT setval(pg_get_serial_sequence(${table.name}, 'id'), COALESCE((SELECT MAX("id") FROM ${sql.raw(identifier)}), 0) + 1, false) AS moved WHERE pg_get_serial_sequence(${table.name}, 'id') IS NOT NULL`,
    );
    if (rowsOf(result).length > 0) moved += 1;
  }
  return moved;
}

/** Whether the instance has no users at all. */
export async function instanceIsEmpty(db: BackupExecutor): Promise<boolean> {
  const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM "users"`);
  const row = rowsOf(result)[0];
  return Number(row?.count ?? 0) === 0;
}

/** The number of rows in one table, as the database counts them. */
export async function countTableRows(
  db: BackupExecutor,
  tableName: string,
): Promise<number> {
  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(quoteIdentifier(tableName))}`,
  );
  return Number(rowsOf(result)[0]?.count ?? 0);
}
