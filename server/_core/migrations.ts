/**
 * The SQL migrations, applied from inside the server (C8.3).
 *
 * `scripts/migrate.mjs` is how an installation applies them, but a
 * restore has to leave the database in the state a fresh install is in —
 * with the migration journal filled in — and the restore runs inside the
 * server, not in a terminal. So the reading and applying lives here and
 * the script stays the operator's path.
 *
 * The same rules as the script:
 *
 *  - only files carrying the `mirrai: idempotent-migration` marker are
 *    applied (the two old generated snapshots are not);
 *  - only the up half is applied;
 *  - each file is applied in its own transaction and recorded in
 *    `schema_migrations`, so a second restore-looking run does nothing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { sql, type SQL } from "drizzle-orm";

/** The marker every hand-written migration carries. */
export const MIGRATION_MARKER = "mirrai: idempotent-migration";

/** Where the down half starts. */
export const MIGRATION_DOWN_MARKER = "-- mirrai: down";

export interface MigrationFile {
  /** The file name, e.g. `0079_scene_record_range.sql`. */
  name: string;
  /** The version recorded in `schema_migrations`: the name without `.sql`. */
  version: string;
  /** The number at the start of the name. */
  number: number;
  /** The up half. */
  up: string;
  /** The down half, when the file carries one. */
  down: string | null;
}

/** The database handle a migration run needs. */
export interface MigrationExecutor {
  execute: (query: SQL) => Promise<unknown>;
}

/** The migrations directory the running code ships with. */
export function defaultMigrationsDir(): string {
  return path.resolve(process.cwd(), "drizzle");
}

/** Reads and sorts the migration files. */
export function loadMigrationFiles(dir = defaultMigrationsDir()): MigrationFile[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => {
      const numberA = Number.parseInt(a, 10);
      const numberB = Number.parseInt(b, 10);
      if (numberA !== numberB) return numberA - numberB;
      return a.localeCompare(b);
    });

  return names.map((name) => {
    const source = readFileSync(path.join(dir, name), "utf-8");
    const downAt = source.indexOf(MIGRATION_DOWN_MARKER);
    const down = downAt === -1 ? null : source.slice(downAt + MIGRATION_DOWN_MARKER.length);
    const up = downAt === -1 ? source : source.slice(0, downAt);
    const number = Number.parseInt(name, 10);
    return {
      name,
      version: name.replace(/\.sql$/, ""),
      number: Number.isFinite(number) ? number : Number.POSITIVE_INFINITY,
      up,
      down,
    };
  });
}

/** The migrations this build ships: the ones with the marker. */
export function applicableMigrations(files = loadMigrationFiles()): MigrationFile[] {
  return files.filter((file) => file.up.includes(MIGRATION_MARKER));
}

/**
 * The newest migration this build ships.
 *
 * The restore compares a backup's journal against this: a backup from a
 * newer release has columns this build's code does not know about, and
 * reading those rows is how data gets silently lost.
 */
export function latestMigrationVersion(files = applicableMigrations()): string | null {
  return files.at(-1)?.version ?? null;
}

/** The number inside a migration version, for comparisons. */
export function migrationNumber(version: string | null | undefined): number {
  if (!version) return 0;
  const number = Number.parseInt(version, 10);
  return Number.isFinite(number) ? number : 0;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/**
 * Applies every migration that is not in `schema_migrations` yet.
 *
 * `files` and `dir` are parameters so the test can use a temporary
 * directory instead of the repository's migrations.
 */
export async function applyPendingMigrations(
  db: MigrationExecutor,
  options: { dir?: string; files?: MigrationFile[] } = {},
): Promise<{ applied: string[]; skipped: number }> {
  const files = options.files ?? applicableMigrations(loadMigrationFiles(options.dir));
  const applied = new Set<string>();
  try {
    const result = await db.execute(sql`SELECT "version" FROM "schema_migrations"`);
    for (const row of rowsOf(result)) {
      if (typeof row.version === "string") applied.add(row.version);
    }
  } catch {
    // The journal table itself is missing (an installation whose schema
    // was created by `push` before the journal existed). The schema is
    // already current in that case; the table is created by the first
    // migration that runs, but the table is part of the schema, so it
    // exists after a push. If it really is missing, the first INSERT
    // below says so.
  }

  const appliedNow: string[] = [];
  let skipped = 0;
  for (const file of files) {
    if (applied.has(file.version)) {
      skipped += 1;
      continue;
    }
    await db.execute(sql.raw(file.up));
    await db.execute(
      sql`INSERT INTO "schema_migrations" ("version") VALUES (${file.version}) ON CONFLICT DO NOTHING`,
    );
    appliedNow.push(file.version);
  }
  return { applied: appliedNow, skipped };
}
