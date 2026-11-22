import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { normalizeUserEncryption } from "@shared/encryption";
import {
  getDb,
  getLetters,
  getMessagesByPersonaId,
  getPersonasByUserId,
  getUserById,
  setUserBackupSettings,
} from "./db";
import {
  BackupNotEmptyError,
  createBackup,
  restoreBackup,
  verifyBackup,
} from "./_core/backup";
import { backupTables, quoteIdentifier } from "./_core/backup-tables";
import { serializeBackupRow } from "./_core/backup-format";
import { unwrapDataKeyWithPassword } from "./_core/content-crypto";
import { forgetAllDataKeys, rememberDataKey } from "./_core/data-keys";
import { forgetAllEncryptionStates, setEncryptionEnabled } from "./_core/encrypted-values";
import { hashPassword } from "./_core/password";
import { enableEncryptionForUser, runPendingMigrationForTests } from "./encryption/enable";

/**
 * The round trip, against a real database (C8.3).
 *
 * The manual describes two scratch databases; a test process has one
 * `DATABASE_URL`. So the test does the same thing inside that one
 * database: make data, back it up, empty every table, restore, compare.
 * The dangerous part — an existing installed database — is never the one
 * this runs against: without `DATABASE_URL` the whole file is skipped,
 * and the workflow only ever points it at a disposable database.
 */
async function truncateEverything(): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const tables = backupTables().map((table) => quoteIdentifier(table.name));
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

describe.skipIf(!process.env.DATABASE_URL)("the backup round trip", () => {
  it("puts every row and every file back, and keeps the ids unique", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await truncateEverything();

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-db-"));
    const uploads = path.join(directory, "uploads");
    const restoreUploads = path.join(directory, "restored-uploads");
    try {
      await db.execute(
        sql`INSERT INTO "users" ("username", "name", "passwordHash") VALUES ('probe', 'Probe', 'hash')`,
      );
      const user = rowsOf(await db.execute(sql`SELECT "id" FROM "users" LIMIT 1`))[0];
      const userId = Number(user.id);
      await db.execute(
        sql`INSERT INTO "personas" ("userId", "name", "relationshipDesc") VALUES (${userId}, '小满', '朋友')`,
      );
      const persona = rowsOf(await db.execute(sql`SELECT "id" FROM "personas" LIMIT 1`))[0];
      const personaId = Number(persona.id);
      await db.execute(
        sql`INSERT INTO "messages" ("userId", "personaId", "role", "content") VALUES (${userId}, ${personaId}, 'assistant', '在的呀')`,
      );
      await db.execute(
        sql`INSERT INTO "collected_messages" ("userId", "personaId", "role", "content", "source", "timestamp", "kind") VALUES (${userId}, ${personaId}, 'assistant', '在的呀', 'probe', '2022-04-02T04:00:00Z', 'text')`,
      );
      await db.execute(
        sql`INSERT INTO "record_embeddings" ("userId", "personaId", "recordId", "model", "dim", "vec") VALUES (${userId}, ${personaId}, 1, 'probe', 3, '\\x010203')`,
      );
      await db.execute(
        sql`INSERT INTO "memories" ("userId", "personaId", "title", "description") VALUES (${userId}, ${personaId}, '生日', '5 月 21 号')`,
      );
      await db.execute(
        sql`INSERT INTO "letters" ("userId", "personaId", "body") VALUES (${userId}, ${personaId}, '最近还好吗')`,
      );

      await fs.mkdir(path.join(uploads, "personas", String(userId), String(personaId)), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(uploads, "personas", String(userId), String(personaId), "a.png"),
        "PNG-BYTES",
      );
      await fs.mkdir(path.join(uploads, "chat", String(userId), String(personaId)), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(uploads, "chat", String(userId), String(personaId), "b.jpg"),
        "JPG-BYTES",
      );

      const out = path.join(directory, "roundtrip.mirrai-backup");
      const created = await createBackup({
        scope: "instance",
        passphrase: "correct horse battery",
        out,
        uploadsDir: uploads,
      });
      expect(created.manifest.tables.find((part) => part.table === "users")?.rows).toBe(1);
      expect(created.manifest.tables.find((part) => part.table === "messages")?.rows).toBe(1);
      expect(created.manifest.uploads).toHaveLength(2);

      const verified = await verifyBackup({ file: out, passphrase: "correct horse battery" });
      expect(verified.verified).toBe(true);
      await expect(verifyBackup({ file: out, passphrase: "wrong passphrase" })).rejects.toThrow();

      await truncateEverything();
      const empty = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS count FROM "users"`))[0];
      expect(Number(empty.count)).toBe(0);

      const restored = await restoreBackup({
        file: out,
        passphrase: "correct horse battery",
        uploadsDir: restoreUploads,
      });
      expect(restored.tables).toBe(created.manifest.tables.length);
      expect(restored.rows).toBe(
        created.manifest.tables.reduce((sum, part) => sum + part.rows, 0),
      );

      // Every table's row count matches the manifest.
      for (const part of created.manifest.tables) {
        const count = rowsOf(
          await db.execute(
            sql`SELECT COUNT(*)::int AS count FROM ${sql.raw(quoteIdentifier(part.table))}`,
          ),
        )[0];
        expect({ table: part.table, rows: Number(count.count) }).toEqual({
          table: part.table,
          rows: part.rows,
        });
      }

      // The contents survived, including the bytea column.
      const message = rowsOf(await db.execute(sql`SELECT "content" FROM "messages"`))[0];
      expect(message.content).toBe("在的呀");
      const memory = rowsOf(await db.execute(sql`SELECT "title", "description" FROM "memories"`))[0];
      expect(memory).toMatchObject({ title: "生日", description: "5 月 21 号" });
      const letter = rowsOf(await db.execute(sql`SELECT "body" FROM "letters"`))[0];
      expect(letter.body).toBe("最近还好吗");
      const embedding = rowsOf(
        await db.execute(sql`SELECT "vec", "dim" FROM "record_embeddings"`),
      )[0];
      expect(Buffer.from(embedding.vec as Buffer).toString("hex")).toBe("010203");
      expect(Number(embedding.dim)).toBe(3);

      // The uploaded file came back to a different directory.
      const upload = await fs.readFile(
        path.join(restoreUploads, "personas", String(userId), String(personaId), "a.png"),
        "utf-8",
      );
      expect(upload).toBe("PNG-BYTES");
      const chatUpload = await fs.readFile(
        path.join(restoreUploads, "chat", String(userId), String(personaId), "b.jpg"),
        "utf-8",
      );
      expect(chatUpload).toBe("JPG-BYTES");

      // The next id does not collide with a restored one.
      const inserted = rowsOf(
        await db.execute(
          sql`INSERT INTO "messages" ("userId", "personaId", "role", "content") VALUES (${userId}, ${personaId}, 'user', '新的一句') RETURNING "id"`,
        ),
      )[0];
      expect(Number(inserted.id)).toBeGreaterThan(1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await truncateEverything().catch(() => undefined);
    }
  }, 120_000);

  it("restores an encrypted instance and reads it back with the same password", async () => {
    /**
     * C8.5 acceptance item 8: an encrypted instance's backup, restored
     * into an empty instance, opens with the original account password and
     * the content is all there. The instance includes a letter, because
     * the restore order bug this round fixed only showed up with one.
     */
    const db = await getDb();
    if (!db) throw new Error("no db");
    await truncateEverything();
    forgetAllDataKeys();
    forgetAllEncryptionStates();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-encrypted-"));
    const uploads = path.join(directory, "uploads");
    const restoreUploads = path.join(directory, "restored");
    const password = "correct horse battery";
    try {
      const insertedUser = rowsOf(await db.execute(
        sql`INSERT INTO "users" ("username", "name", "passwordHash") VALUES ('encrypted-restore', '阿树', ${await hashPassword(password)}) RETURNING "id"`,
      ))[0];
      const userId = Number(insertedUser.id);
      const insertedPersona = rowsOf(await db.execute(
        sql`INSERT INTO "personas" ("userId", "name") VALUES (${userId}, '小满') RETURNING "id"`,
      ))[0];
      const personaId = Number(insertedPersona.id);
      await db.execute(
        sql`INSERT INTO "messages" ("userId", "personaId", "role", "content") VALUES (${userId}, ${personaId}, 'assistant', ${"哨兵备份XYZ晚安"})`,
      );
      await db.execute(
        sql`INSERT INTO "letters" ("userId", "personaId", "body") VALUES (${userId}, ${personaId}, ${"哨兵备份XYZ信"})`,
      );
      await setUserBackupSettings(userId, {
        enabled: false,
        frequency: "daily",
        lastFullBackupAt: new Date().toISOString(),
      });
      await enableEncryptionForUser(userId, password, { startInBackground: false });
      for (let step = 0; step < 50; step += 1) {
        const progress = await runPendingMigrationForTests(userId, { maxSteps: 3, batchSize: 2 });
        if (progress.finished) break;
      }
      await fs.mkdir(path.join(uploads, "personas", String(userId), String(personaId)), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(uploads, "personas", String(userId), String(personaId), "a.png"),
        "PNG-BYTES",
      );

      const out = path.join(directory, "encrypted.mirrai-backup");
      await createBackup({
        scope: "instance",
        passphrase: "backup pass",
        out,
        uploadsDir: uploads,
      });
      await truncateEverything();
      forgetAllDataKeys();
      forgetAllEncryptionStates();

      await restoreBackup({
        file: out,
        passphrase: "backup pass",
        uploadsDir: restoreUploads,
      });

      // Raw SQL: no sentinel anywhere, and the content column is ciphertext.
      const plaintext = rowsOf(
        await db.execute(
          sql`SELECT "id" FROM "messages" WHERE "content"::text LIKE ${"%哨兵%"}`,
        ),
      );
      expect(plaintext).toEqual([]);
      const cipher = rowsOf(
        await db.execute(sql`SELECT "content"::text AS content FROM "messages" LIMIT 1`),
      );
      expect(String(cipher[0]?.content)).toMatch(/^enc:v1:/);

      // Sign in again: the wrapped key in the restored user row opens with
      // the original password, and every read decrypts.
      const restoredUser = await getUserById(userId);
      const encryption = normalizeUserEncryption(restoredUser?.encryption);
      expect(encryption).toBeTruthy();
      const key = await unwrapDataKeyWithPassword(
        encryption!.wrappedKey,
        encryption!.salt,
        password,
      );
      expect(key).toBeTruthy();
      rememberDataKey(userId, key!);
      setEncryptionEnabled(userId, true);
      expect((await getPersonasByUserId(userId)).map((row) => row.id)).toContain(personaId);
      expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(
        "哨兵备份XYZ晚安",
      );
      expect((await getLetters(personaId, userId))[0]?.body).toBe("哨兵备份XYZ信");
    } finally {
      forgetAllDataKeys();
      forgetAllEncryptionStates();
      await fs.rm(directory, { recursive: true, force: true });
      await truncateEverything().catch(() => undefined);
    }
  }, 120_000);

  it("rolls the database back and removes the files when a restore fails midway", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await truncateEverything();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-rollback-"));
    const sourceUploads = path.join(directory, "uploads");
    const targetUploads = path.join(directory, "restored");
    try {
      await db.execute(
        sql`INSERT INTO "users" ("username", "name", "passwordHash") VALUES ('rollback', '回滚', 'hash')`,
      );
      await fs.mkdir(path.join(sourceUploads, "personas", "1", "1"), { recursive: true });
      await fs.writeFile(path.join(sourceUploads, "personas", "1", "1", "a.png"), "PNG");
      const out = path.join(directory, "rollback.zip");
      await createBackup({ scope: "instance", out, uploadsDir: sourceUploads });
      await truncateEverything();

      await expect(
        restoreBackup({
          file: out,
          uploadsDir: targetUploads,
          afterFiles: async () => {
            throw new Error("forced failure after the files were written");
          },
        }),
      ).rejects.toThrow(/forced failure/);

      // The transaction rolled back and the files it had copied are gone.
      const users = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS count FROM "users"`))[0];
      expect(Number(users.count)).toBe(0);
      const left = await fs.readdir(targetUploads).catch(() => [] as string[]);
      expect(left).toEqual([]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await truncateEverything().catch(() => undefined);
    }
  }, 120_000);

  it("writes no row and no file when the passphrase is wrong", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await truncateEverything();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-pass-"));
    const sourceUploads = path.join(directory, "uploads");
    const targetUploads = path.join(directory, "restored");
    try {
      await db.execute(
        sql`INSERT INTO "users" ("username", "passwordHash") VALUES ('pass', 'hash')`,
      );
      await fs.mkdir(path.join(sourceUploads, "personas", "1", "1"), { recursive: true });
      await fs.writeFile(path.join(sourceUploads, "personas", "1", "1", "a.png"), "PNG");
      const out = path.join(directory, "encrypted.mirrai-backup");
      await createBackup({
        scope: "instance",
        passphrase: "correct horse battery",
        out,
        uploadsDir: sourceUploads,
      });
      await truncateEverything();

      await expect(
        restoreBackup({ file: out, passphrase: "wrong passphrase", uploadsDir: targetUploads }),
      ).rejects.toThrow();
      const users = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS count FROM "users"`))[0];
      expect(Number(users.count)).toBe(0);
      const left = await fs.readdir(targetUploads).catch(() => [] as string[]);
      expect(left).toEqual([]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await truncateEverything().catch(() => undefined);
    }
  }, 120_000);

  it("refuses a second restore into the same instance", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    await truncateEverything();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-db2-"));
    try {
      await db.execute(
        sql`INSERT INTO "users" ("username", "passwordHash") VALUES ('probe2', 'hash')`,
      );
      const out = path.join(directory, "one.zip");
      await createBackup({ scope: "instance", out, uploadsDir: path.join(directory, "uploads") });
      await expect(
        restoreBackup({ file: out, passphrase: null, uploadsDir: path.join(directory, "restored") }),
      ).rejects.toBeInstanceOf(BackupNotEmptyError);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
      await truncateEverything().catch(() => undefined);
    }
  }, 120_000);
});

describe("serializing a row", () => {
  it("keeps a bytea value markable and restorable", () => {
    const row = serializeBackupRow({ id: 1, vec: Buffer.from([0, 255]) });
    expect(JSON.parse(row).vec).toEqual({ __mirraiBytea: "00ff" });
  });
});
