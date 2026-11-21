/**
 * Full backup and restore (C8.3).
 *
 * A backup is one file: a zip of `db/<table>.ndjson` parts, the uploads
 * directory, and a manifest with the row counts and a SHA-256 for every
 * part. With a passphrase the whole archive is encrypted (see
 * `backup-format.ts`).
 *
 * A restore is deliberately narrow: **an empty instance only**. Merging
 * one installation's rows into another means renumbering every id and
 * rewriting every reference between them; that is a different feature
 * with a different failure mode, and half-doing it is how people lose
 * the data they were trying to save.
 *
 * Order inside the restore's transaction:
 *
 *   tables → id sequences → uploaded files → migrations
 *
 * so that a failure at any step leaves nothing behind: the transaction
 * rolls back and the files that were written are removed.
 */
import { createReadStream, promises as fs } from "node:fs";
import { constants as fsConstants } from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { getDb } from "../db";
import { backupExtension, backupFileName } from "@shared/backup";
import { ENV } from "./env";
import {
  BACKUP_FORMAT_VERSION,
  extractBackupToStaging,
  type BackupEntry,
  type BackupManifest,
  serializeBackupRow,
  verifyStagingPart,
  writeBackupArchive,
} from "./backup-format";
import {
  BACKUP_RESTORE_BATCH,
  backupExclusions,
  backupTables,
  dumpTableRows,
  instanceIsEmpty,
  insertRowsBatch,
  resetSequences,
  schemaTables,
  type BackupExecutor,
  type BackupTableInfo,
} from "./backup-tables";
import {
  applyPendingMigrations,
  loadMigrationFiles,
  latestMigrationVersion,
  migrationNumber,
} from "./migrations";

/** What a created backup is. */
export interface CreatedBackup {
  file: string;
  bytes: number;
  sha256: string;
  manifest: BackupManifest;
}

/** What a verified backup claims. */
export interface VerifiedBackup extends BackupManifest {
  /** Checked against the manifest, part by part. */
  verified: true;
}

/** What a finished restore did. */
export interface RestoredBackup {
  manifest: BackupManifest;
  tables: number;
  rows: number;
  files: number;
  migrations: string[];
}

/** The instance is not empty; a restore is only for a fresh installation. */
export class BackupNotEmptyError extends Error {}

/** The backup comes from a newer release. */
export class BackupTooNewError extends Error {}

/** The archive's manifest does not match the data. */
export class BackupIntegrityError extends Error {}

/** The uploads directory the app uses. */
export function defaultUploadsDir(): string {
  return path.resolve(ENV.uploadDir);
}

/**
 * Every uploaded file, relative to the uploads directory.
 *
 * A one-user backup only covers the directories the owner's files live
 * in: `personas/<id>`, `chat/<id>` and `tts/<id>` — the same three the
 * uploads guard scopes by user. Symlinks are skipped: a link is not a
 * file the app uploaded, and following one could read something outside
 * the directory.
 */
export async function listUploadFiles(
  uploadsDir: string,
  scope: "instance" | number,
): Promise<Array<{ rel: string; abs: string }>> {
  const roots: string[] = [];
  if (scope === "instance") {
    roots.push(uploadsDir);
  } else {
    for (const area of ["personas", "chat", "tts"]) {
      roots.push(path.join(uploadsDir, area, String(scope)));
    }
  }

  const found: Array<{ rel: string; abs: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(uploadsDir, abs).split(path.sep).join("/");
      if (!rel || rel.startsWith("..")) continue;
      found.push({ rel, abs });
    }
  };
  for (const root of roots) await walk(root);
  found.sort((a, b) => a.rel.localeCompare(b.rel));
  return found;
}

/** One upload file as a zip entry, streamed from disk. */
function uploadEntry(uploadsDir: string, rel: string, abs: string): BackupEntry {
  return {
    name: `uploads/${rel}`,
    compress: false,
    chunks: async function* () {
      for await (const chunk of createReadStream(abs)) yield chunk as Uint8Array;
    },
  };
}

/**
 * Creates a backup at `out`.
 *
 * The caller decides what `out` is: the CLI passes a path, the download
 * route streams from a temporary one. Nothing is left behind inside the
 * app when the call fails.
 */
export async function createBackup(options: {
  scope?: "instance" | number;
  passphrase?: string | null;
  out: string;
  uploadsDir?: string;
  migrationsDir?: string;
  appVersion?: string;
  now?: Date;
}): Promise<CreatedBackup> {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const scope = options.scope ?? "instance";
  const uploadsDir = options.uploadsDir ?? defaultUploadsDir();
  const now = options.now ?? new Date();
  const files = loadMigrationFiles(options.migrationsDir);
  const latest = latestMigrationVersion(
    files.filter((file) => file.up.includes("mirrai: idempotent-migration")),
  );

  const tables = backupTables();
  const included =
    scope === "instance" ? tables : tables.filter((entry) => tableInUserScope(entry));
  const exclusions = backupExclusions(scope, schemaTables());

  const entries: BackupEntry[] = [];
  for (const table of included) {
    let rows = 0;
    entries.push({
      name: `db/${table.name}.ndjson`,
      compress: true,
      rows: () => rows,
      chunks: async function* () {
        const pending: string[] = [];
        for await (const batch of dumpTableRows(db as unknown as BackupExecutor, table, scope)) {
          for (const row of batch) {
            pending.push(serializeBackupRow(row));
            rows += 1;
            if (pending.length >= 1000) {
              yield Buffer.from(pending.join("\n") + "\n");
              pending.length = 0;
            }
          }
        }
        if (pending.length) yield Buffer.from(pending.join("\n") + "\n");
      },
    });
  }

  const uploads = await listUploadFiles(uploadsDir, scope);
  for (const file of uploads) {
    entries.push(uploadEntry(uploadsDir, file.rel, file.abs));
  }

  const written = await writeBackupArchive({
    outPath: options.out,
    entries,
    passphrase: options.passphrase ?? null,
    manifest: {
      format: BACKUP_FORMAT_VERSION,
      appVersion: options.appVersion ?? ENV.appVersion,
      latestMigration: latest,
      createdAt: now.toISOString(),
      scope,
      exclusions,
    },
  });

  return {
    file: options.out,
    bytes: written.bytes,
    sha256: written.sha256,
    manifest: written.manifest,
  };
}

function tableInUserScope(table: BackupTableInfo): boolean {
  if (table.name === "users") return true;
  return table.columns.includes("userId") || table.columns.includes("personaId");
}

/**
 * Reads a backup and checks every part against the manifest.
 *
 * This is what `--verify` runs and what a restore runs before it writes
 * anything: a backup is only worth having if it can prove it is intact.
 */
export async function verifyBackup(options: {
  file: string;
  passphrase?: string | null;
  migrationsDir?: string;
}): Promise<VerifiedBackup> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-verify-"));
  try {
    const manifest = await extractBackupToStaging({
      filePath: options.file,
      passphrase: options.passphrase ?? null,
      stagingDir: staging,
    });
    assertSupportedByThisBuild(manifest, options.migrationsDir);
    await assertPartsIntact(staging, manifest);
    return { ...manifest, verified: true };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

function assertSupportedByThisBuild(manifest: BackupManifest, migrationsDir?: string): void {
  const files = loadMigrationFiles(migrationsDir).filter((file) =>
    file.up.includes("mirrai: idempotent-migration"),
  );
  const current = latestMigrationVersion(files);
  if (migrationNumber(manifest.latestMigration) > migrationNumber(current)) {
    throw new BackupTooNewError(
      `The backup is from a newer release (migration ${manifest.latestMigration}, this build has ${current ?? "none"}).`,
    );
  }
}

async function assertPartsIntact(staging: string, manifest: BackupManifest): Promise<void> {
  for (const part of manifest.tables) {
    if (!(await verifyStagingPart(staging, part))) {
      throw new BackupIntegrityError(`The table part ${part.file} does not match its hash.`);
    }
  }
  for (const part of manifest.uploads) {
    if (!(await verifyStagingPart(staging, part))) {
      throw new BackupIntegrityError(`The file ${part.file} does not match its hash.`);
    }
  }
}

/** Reads an NDJSON part of the staging directory in batches. */
async function* readNdjsonBatches(
  file: string,
  batchSize = BACKUP_RESTORE_BATCH,
): AsyncGenerator<Array<Record<string, unknown>>> {
  const input = createReadStream(file);
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let batch: Array<Record<string, unknown>> = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as Record<string, unknown>);
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

/**
 * Restores a backup into an empty instance.
 *
 * `db` is injectable so the failure paths can be tested without a real
 * database; the production call passes nothing and `getDb()` is used.
 */
export async function restoreBackup(options: {
  file: string;
  passphrase?: string | null;
  uploadsDir?: string;
  migrationsDir?: string;
  stagingDir?: string;
  /** Test hook: run before the transaction commits, to force a failure. */
  afterFiles?: () => Promise<void> | void;
}): Promise<RestoredBackup> {
  const uploadsDir = options.uploadsDir ?? defaultUploadsDir();
  const staging = options.stagingDir
    ? await fs.mkdtemp(path.join(options.stagingDir, "mirrai-restore-"))
    : await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-restore-"));
  const copied: string[] = [];
  let completed = false;

  try {
    const manifest = await extractBackupToStaging({
      filePath: options.file,
      passphrase: options.passphrase ?? null,
      stagingDir: staging,
    });
    assertSupportedByThisBuild(manifest, options.migrationsDir);
    await assertPartsIntact(staging, manifest);

    const db = await getDb();
    if (!db) throw new Error("database_unavailable");
    if (!(await instanceIsEmpty(db as unknown as BackupExecutor))) {
      throw new BackupNotEmptyError("The instance already has a user.");
    }

    const byName = new Map(backupTables().map((table) => [table.name, table]));
    const restoreTables: BackupTableInfo[] = [];
    for (const part of manifest.tables) {
      const table = byName.get(part.table);
      if (!table) continue;
      restoreTables.push(table);
    }

    let inserted = 0;
    const migrations = await db.transaction(async (tx) => {
      const executor = tx as unknown as BackupExecutor;
      for (const table of restoreTables) {
        const part = manifest.tables.find((entry) => entry.table === table.name);
        if (!part) continue;
        const file = path.join(staging, "db", `${table.name}.ndjson`);
        for await (const batch of readNdjsonBatches(file)) {
          await insertRowsBatch(executor, table, batch);
          inserted += batch.length;
        }
      }
      await resetSequences(executor, restoreTables);

      for (const part of manifest.uploads) {
        const relative = part.file.replace(/^uploads\//, "");
        const source = path.join(staging, "uploads", ...relative.split("/"));
        const target = path.join(uploadsDir, ...relative.split("/"));
        await fs.mkdir(path.dirname(target), { recursive: true });
        // Refuse to overwrite an existing file: the instance was said to
        // be empty, so anything already here is a sign the operator
        // pointed the restore at the wrong place.
        await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
        copied.push(target);
      }

      const migrationRun = await applyPendingMigrations(executor, {
        dir: options.migrationsDir,
      });
      await options.afterFiles?.();
      return migrationRun.applied;
    });

    completed = true;
    return {
      manifest,
      tables: restoreTables.length,
      rows: inserted,
      files: copied.length,
      migrations,
    };
  } finally {
    if (!completed) {
      // The transaction rolled back; the files it wrote are removed.
      await Promise.allSettled(copied.map((file) => fs.rm(file, { force: true })));
    }
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * The HTTP download path: creates the backup in a temporary file and
 * hands it to the caller.
 *
 * The caller (the route) streams it out and removes it. The temporary
 * file is why the download works on a disk the server can write to at
 * all; it does not stay after the response.
 */
export async function createBackupForDownload(options: {
  scope: "instance" | number;
  passphrase: string;
}): Promise<{ path: string; fileName: string; bytes: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-download-"));
  const file = path.join(dir, backupFileName(new Date(), true));
  const created = await createBackup({
    scope: options.scope,
    passphrase: options.passphrase,
    out: file,
  });
  return { path: file, fileName: path.basename(file), bytes: created.bytes };
}

/** The staging directory a verify uses, for tests that want to look at it. */
export async function inspectBackup(options: {
  file: string;
  passphrase?: string | null;
  migrationsDir?: string;
  onManifest: (manifest: BackupManifest, staging: string) => Promise<void>;
}): Promise<void> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-inspect-"));
  try {
    const manifest = await extractBackupToStaging({
      filePath: options.file,
      passphrase: options.passphrase ?? null,
      stagingDir: staging,
    });
    if (options.migrationsDir) assertSupportedByThisBuild(manifest, options.migrationsDir);
    await options.onManifest(manifest, staging);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
