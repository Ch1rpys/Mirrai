import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeUserEncryption } from "@shared/encryption";
import { normalizeBackupSettings } from "@shared/backup";
import { hashPassword, verifyPassword } from "../_core/password";
import { dataKeyFor, forgetAllDataKeys, forgetDataKey, rememberDataKey } from "../_core/data-keys";
import { forgetAllEncryptionStates, setEncryptionEnabled } from "../_core/encrypted-values";
import {
  createCollectedMessage,
  createDiaryEntry,
  createLetter,
  createMemory,
  createMessage,
  createOralAccount,
  createOutboundLetter,
  createPersona,
  createPersonaVersion,
  createRehearsal,
  createRoleplaySession,
  createScheduledItem,
  createUser,
  createJournalEntry,
  exportUserData,
  getCollectedMessagesForPersona,
  getDb,
  listInboxScheduled,
  getDiaryEntries,
  getLetters,
  getMemoriesByPersonaId,
  getMessagesByPersonaId,
  getOutboundLetters,
  getPersonaById,
  getRoleplaySession,
  getUserById,
  getUserEncryption,
  getUserJournal,
  getScheduledItem,
  listRehearsals,
  searchMessages,
  searchRecordsLexical,
  setUserBackupSettings,
} from "../db";
import {
  disableEncryptionForUser,
  enableEncryptionForUser,
  encryptionStatusForUser,
  resetPasswordWithRecovery,
  rewrapDataKeyForNewPassword,
  runPendingMigrationForTests,
} from "./enable";
import { isEncryptionLocked } from "./lock";
import { blindIndexToken } from "../_core/content-crypto";
import { countMigrationWork } from "./migrate";
import { createBackup } from "../_core/backup";
import { inspectBackup } from "../_core/backup";

/**
 * The encrypted database end to end (C8.5 steps 2, 4, 6).
 *
 * The unit tests prove the primitives; this file proves the promise: after
 * enabling and letting the background job finish, an `psql`-level read of
 * every listed column finds no plaintext, the application still reads the
 * same content back, search still works, and disabling puts the plaintext
 * back without losing a row.
 *
 * A database is required: `describe.skipIf(!process.env.DATABASE_URL)` is
 * the same rule as every other DB test (`server/skip-audit.test.ts`).
 */


const PASSWORD = "correct horse battery";
const SENTINEL = "哨兵内容XYZ";
/** Every encrypted column and its storage kind, for the raw-SQL sweep. */
const COLUMNS: Array<[string, string, "text" | "json"]> = [
  ["messages", "content", "text"],
  ["memories", "title", "text"],
  ["memories", "description", "text"],
  ["letters", "body", "text"],
  ["letters", "replyText", "text"],
  ["outbound_letters", "text", "text"],
  ["outbound_letters", "outcomeNote", "text"],
  ["user_journal", "body", "text"],
  ["diary_entries", "summary", "text"],
  ["diary_entries", "reflection", "text"],
  ["collected_messages", "content", "text"],
  ["collected_messages", "meta", "json"],
  ["personas", "personaData", "json"],
  ["personas", "styleProfile", "json"],
  ["rehearsals", "line", "text"],
  ["rehearsals", "result", "json"],
  ["roleplay_sessions", "transcript", "json"],
  ["scheduled_items", "body", "text"],
  ["oral_accounts", "body", "text"],
  ["persona_versions", "personaData", "json"],
];

interface Seeded {
  userId: number;
  personaId: number;
  ids: Record<string, number>;
}

/** Creates one persona with sentinels in every encrypted column. */
async function seedUser(tag: string): Promise<Seeded> {
  const username = `c85-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const userId = await createUser({
    username,
    passwordHash: await hashPassword(PASSWORD),
    name: "阿树",
  });
  const personaId = await createPersona({
    userId,
    name: "小满",
    personaData: { rules: [`${SENTINEL}规则`] },
    styleProfile: { version: 1, measuredAt: "2024-01-01T00:00:00.000Z", recordsVersion: "1:1" },
  });
  const ids: Record<string, number> = {};
  ids.message = await createMessage({
    personaId,
    userId,
    role: "assistant",
    content: `${SENTINEL}晚安`,
    messageType: "text",
    channel: "web",
  });
  ids.memory = await createMemory({
    personaId,
    userId,
    title: `${SENTINEL}生日`,
    description: `${SENTINEL}描述`,
  });
  const letterRow = await createLetter({
    userId,
    personaId,
    body: `${SENTINEL}信`,
    status: "waiting",
  });
  ids.letter = letterRow.id;
  ids.diary = (await createDiaryEntry({
    userId,
    personaId,
    date: "2024-01-01",
    summary: `${SENTINEL}日记`,
    reflection: `${SENTINEL}反思`,
  }))!;
  ids.oral = await createOralAccount({
    personaId,
    userId,
    tellerName: "琪琪",
    body: `${SENTINEL}口述`,
  });
  ids.rehearsal = (await createRehearsal({
    userId,
    personaId,
    line: `${SENTINEL}排练`,
    result: { variants: [`${SENTINEL}变体`] },
  }))!;
  await createJournalEntry({ userId, body: `${SENTINEL}自己的日记`, entryDate: "2024-01-02" });
  ids.roleplay = (await createRoleplaySession({ userId, personaId, startedAt: new Date() }))!;
  ids.scheduled = (
    await createScheduledItem({
      userId,
      personaId,
      kind: "capsule",
      body: `${SENTINEL}胶囊`,
      dueAt: new Date(),
    })
  ).id;
  ids.record = (await createCollectedMessage({
    personaId,
    userId,
    role: "assistant",
    content: `${SENTINEL}喜欢海`,
    kind: "text",
    source: "import",
    sourceMessageId: `src-${tag}`,
  }))!;
  ids.outbound = (await createOutboundLetter({
    userId,
    personaId,
    text: `${SENTINEL}要说的话`,
  }))!;
  ids.version = (await createPersonaVersion(personaId, userId, "test"))!;
  // A reply on the letter, so `letters.replyText` has content too.
  const db = await getDb();
  await db!.execute(sql`
    UPDATE "letters" SET "replyText" = ${`${SENTINEL}回信`} WHERE "id" = ${ids.letter}
  `);
  return { userId, personaId, ids };
}

/** Grants the "a full backup exists" prerequisite for enabling. */
async function markBackupDone(userId: number): Promise<void> {
  await setUserBackupSettings(userId, {
    enabled: false,
    frequency: "daily",
    lastFullBackupAt: new Date().toISOString(),
  });
}

/** Waits until the background job clears the migration flag. */
async function waitForMigration(userId: number, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const user = await getUserById(userId);
    const encryption = normalizeUserEncryption(user?.encryption);
    if (!encryption?.migration) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`migration did not finish: ${JSON.stringify(encryption.migration)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Raw SQL: how many rows hold the sentinel in one column. */
async function plaintextRows(table: string, column: string, userId: number): Promise<number> {
  const db = await getDb();
  const escaped = SENTINEL;
  const result = await db!.execute(sql.raw(
    `SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = ${userId} AND "${column}"::text LIKE '%${escaped}%'`,
  ));
  return Number((result as unknown as { rows?: Array<{ n?: number }> }).rows?.[0]?.n ?? 0);
}

/** Seeds the process with the account's key, the way a sign-in does. */
async function unlockInProcess(userId: number, password = PASSWORD): Promise<void> {
  const user = await getUserById(userId);
  const encryption = normalizeUserEncryption(user?.encryption);
  if (!encryption) throw new Error("not encrypted");
  const { unwrapDataKeyWithPassword } = await import("../_core/content-crypto");
  const key = await unwrapDataKeyWithPassword(encryption.wrappedKey, encryption.salt, password);
  if (!key) throw new Error("the password did not unwrap the key");
  rememberDataKey(userId, key);
  setEncryptionEnabled(userId, true);
}

describe.skipIf(!process.env.DATABASE_URL)("the encrypted database", () => {
  beforeAll(() => {
    forgetAllDataKeys();
    forgetAllEncryptionStates();
  });

  afterAll(() => {
    forgetAllDataKeys();
    forgetAllEncryptionStates();
  });

  it("refuses to enable before a full backup exists", async () => {
    const { userId } = await seedUser("nobackup");
    await expect(enableEncryptionForUser(userId, PASSWORD)).rejects.toMatchObject({
      code: "backup_required",
    });
    const user = await getUserById(userId);
    expect(normalizeUserEncryption(user?.encryption)).toBeNull();
  });

  it("encrypts every listed column and reads the same content back", async () => {
    const { userId, personaId, ids } = await seedUser("full");
    await markBackupDone(userId);

    const { recoveryCode } = await enableEncryptionForUser(userId, PASSWORD);
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    await waitForMigration(userId);

    const status = await encryptionStatusForUser(userId);
    expect(status).toMatchObject({ enabled: true, unlocked: true, migrating: false });
    expect(status.migration).toBeNull();

    // Raw SQL: no sentinel in any listed column.
    for (const [table, column] of COLUMNS) {
      expect(await plaintextRows(table, column, userId), `${table}.${column}`).toBe(0);
    }

    // Raw SQL: the money columns are actually ciphertext, not merely empty.
    const db = await getDb();
    const messageRow = await db!.execute(
      sql.raw(`SELECT "content"::text AS c FROM "messages" WHERE "id" = ${ids.message}`),
    );
    expect(String((messageRow as unknown as { rows: Array<{ c: string }> }).rows[0]!.c)).toMatch(
      /^enc:v1:/,
    );

    // The application still reads the same words.
    expect((await getPersonaById(personaId, userId))?.personaData).toEqual({
      rules: [`${SENTINEL}规则`],
    });
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);
    expect((await getMemoriesByPersonaId(personaId, userId))[0]?.title).toBe(`${SENTINEL}生日`);
    expect((await getLetters(personaId, userId))[0]?.body).toBe(`${SENTINEL}信`);
    expect((await getDiaryEntries(userId, personaId))[0]?.summary).toBe(`${SENTINEL}日记`);
    expect((await listRehearsals(personaId, userId))[0]?.line).toBe(`${SENTINEL}排练`);
    expect((await getUserJournal(userId))[0]?.body).toBe(`${SENTINEL}自己的日记`);
    expect((await getScheduledItem(ids.scheduled!, userId))?.body).toBe(`${SENTINEL}胶囊`);
    expect((await getCollectedMessagesForPersona(personaId, userId))[0]?.content).toBe(
      `${SENTINEL}喜欢海`,
    );
    expect((await getOutboundLetters(personaId, userId))[0]?.text).toBe(`${SENTINEL}要说的话`);
    expect((await getRoleplaySession(ids.roleplay!, userId))?.transcript).toEqual([]);
    /**
     * The two read paths the first pass missed (independent acceptance):
     * the account export and the mailbox's capsules used to hand the
     * caller `enc:v1:…`.
     */
    const inbox = await listInboxScheduled(userId, [personaId]);
    expect(inbox.find((row) => row.id === ids.scheduled)?.body).toBe(`${SENTINEL}胶囊`);
    const exported = await exportUserData(userId);
    expect(exported?.messages.find((row) => row.id === ids.message)?.content).toBe(
      `${SENTINEL}晚安`,
    );
    expect(exported?.personas.find((row) => row.id === personaId)?.personaData).toEqual({
      rules: [`${SENTINEL}规则`],
    });

    // Search still works, through the blind index.
    const hit = await searchRecordsLexical(personaId, userId, { q: "喜欢海" });
    expect(hit.map((row) => row.content)).toEqual([`${SENTINEL}喜欢海`]);
    const messageHit = await searchMessages(personaId, userId, "晚安");
    expect(messageHit).toHaveLength(1);
    const tokens = await db!.execute(
      sql.raw(`SELECT "searchTokens"::text AS t FROM "collected_messages" WHERE "id" = ${ids.record}`),
    );
    const tokenText = String(
      (tokens as unknown as { rows: Array<{ t: string }> }).rows[0]!.t,
    );
    expect(tokenText).not.toContain("喜欢");
    expect(tokenText).toMatch(/'[0-9a-f]{16}'/);
  });

  it("finds a blind token that to_tsquery would split into several lexemes", async () => {
    /**
     * The blind tokens are hex strings; a token that begins like a number
     * (`862e6…`) is re-parsed by `to_tsquery` into several lexemes and can
     * never match the one lexeme `array_to_tsvector` stored. About one
     * bigram in ten was affected, per data key. The query now casts the
     * quoted tokens straight to `tsquery`, which keeps each one whole.
     *
     * Find such a bigram for this account's key, write it, and search it.
     */
    const { userId, personaId } = await seedUser("blind");
    await markBackupDone(userId);
    await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    const key = dataKeyFor(userId);
    expect(key).not.toBeNull();

    const alphabet =
      "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面" +
      "而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性" +
      "好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气" +
      "第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活" +
      "设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回" +
      "则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清" +
      "己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米" +
      "整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近" +
      "矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快" +
      "效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞";
    const unsafe: Array<{ bigram: string; token: string }> = [];
    for (let i = 0; i + 1 < alphabet.length && unsafe.length < 1; i += 1) {
      const bigram = alphabet.slice(i, i + 2);
      const token = blindIndexToken(key!, bigram);
      if (/^\d+[eE]\d/.test(token)) unsafe.push({ bigram, token });
    }
    expect(unsafe.length, "no token in this key starts like a number — increase the sample").toBe(1);

    const { bigram, token } = unsafe[0]!;
    // The old query form really does split it: this is the failure the
    // test exists for, not an assumption.
    const db = await getDb();
    const parsed = (await db!.execute(sql.raw(
      `SELECT to_tsquery('simple', ${`'${token}'`})::text AS t`,
    ))) as unknown as { rows: Array<{ t: string }> };
    expect(parsed.rows[0]!.t).not.toBe(`'${token}'`);

    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: `句子${bigram}句子`,
      messageType: "text",
      channel: "web",
    });
    await createCollectedMessage({
      personaId,
      userId,
      role: "assistant",
      content: `原话${bigram}原话`,
      kind: "text",
      source: "import",
      sourceMessageId: `blind-${bigram}`,
    });
    const messageHits = await searchMessages(personaId, userId, bigram);
    expect(messageHits.map((row) => row.content)).toContain(`句子${bigram}句子`);
    const recordHits = await searchRecordsLexical(personaId, userId, { q: bigram });
    expect(recordHits.map((row) => row.content)).toContain(`原话${bigram}原话`);
  });

  it("can be interrupted midway and resumed, and every read stays correct", async () => {
    const { userId, personaId } = await seedUser("resume");
    await markBackupDone(userId);
    // The background job is not started: the test drives the batches.
    await enableEncryptionForUser(userId, PASSWORD, { startInBackground: false });
    const first = await runPendingMigrationForTests(userId, { maxSteps: 1, batchSize: 2 });
    expect(first.finished).toBe(false);
    // Half the rows are plaintext, half ciphertext; every helper must
    // still return the original words.
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);
    expect((await getPersonaById(personaId, userId))?.personaData).toEqual({
      rules: [`${SENTINEL}规则`],
    });
    // Finishing the job encrypts the rest.
    for (let i = 0; i < 50; i++) {
      const step = await runPendingMigrationForTests(userId, { maxSteps: 3, batchSize: 2 });
      if (step.finished) break;
    }
    expect((await encryptionStatusForUser(userId)).migrating).toBe(false);
    for (const [table, column] of COLUMNS) {
      expect(await plaintextRows(table, column, userId), `${table}.${column}`).toBe(0);
    }
  });

  it("cannot be opened with the wrong password, and the recovery code resets the password", async () => {
    const { userId, personaId } = await seedUser("recovery");
    await markBackupDone(userId);
    const { recoveryCode } = await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    forgetDataKey(userId);

    const user = await getUserById(userId);
    const encryption = normalizeUserEncryption(user?.encryption);
    expect(encryption).not.toBeNull();
    const { unwrapDataKeyWithPassword } = await import("../_core/content-crypto");
    expect(
      await unwrapDataKeyWithPassword(encryption!.wrappedKey, encryption!.salt, "wrong password"),
    ).toBeNull();

    await resetPasswordWithRecovery(userId, recoveryCode, "a brand new password");
    const updated = await getUserById(userId);
    expect(await verifyPassword("a brand new password", updated?.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, updated?.passwordHash)).toBe(false);
    // The data key is still the same one: the content reads.
    await unlockInProcess(userId, "a brand new password");
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);
  });

  it("keeps the data and the recovery code working after a password change", async () => {
    const { userId, personaId } = await seedUser("rewrap");
    await markBackupDone(userId);
    const { recoveryCode } = await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    await rewrapDataKeyForNewPassword(userId, PASSWORD, "another password");

    // The new wrapper opens only with the new password.
    const user = await getUserById(userId);
    const encryption = normalizeUserEncryption(user?.encryption);
    const { unwrapDataKeyWithPassword } = await import("../_core/content-crypto");
    expect(
      await unwrapDataKeyWithPassword(encryption!.wrappedKey, encryption!.salt, PASSWORD),
    ).toBeNull();
    expect(
      await unwrapDataKeyWithPassword(
        encryption!.wrappedKey,
        encryption!.salt,
        "another password",
      ),
    ).not.toBeNull();

    // The content is still there, read through the new password.
    forgetDataKey(userId);
    await unlockInProcess(userId, "another password");
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);

    // The recovery code survived the password change.
    forgetDataKey(userId);
    await resetPasswordWithRecovery(userId, recoveryCode, "the third password");
    const updated = await getUserById(userId);
    expect(await verifyPassword("the third password", updated?.passwordHash)).toBe(true);
    await unlockInProcess(userId, "the third password");
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);
  });

  it("puts the plaintext back on disable without losing a row", async () => {
    const { userId, personaId } = await seedUser("disable");
    await markBackupDone(userId);
    await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    const db = await getDb();
    const countBefore = await db!.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "messages" WHERE "userId" = ${userId}`),
    );
    await disableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    const user = await getUserById(userId);
    expect(normalizeUserEncryption(user?.encryption)).toBeNull();
    expect(await plaintextRows("messages", "content", userId)).toBeGreaterThan(0);
    expect(await plaintextRows("personas", "personaData", userId)).toBeGreaterThan(0);
    const countAfter = await db!.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "messages" WHERE "userId" = ${userId}`),
    );
    expect((countAfter as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(
      (countBefore as unknown as { rows: Array<{ n: number }> }).rows[0]!.n,
    );
    // The app still reads the same words, and a new write is plaintext.
    expect((await getMessagesByPersonaId(personaId, userId))[0]?.content).toBe(`${SENTINEL}晚安`);
    expect((await getPersonaById(personaId, userId))?.personaData).toEqual({
      rules: [`${SENTINEL}规则`],
    });
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "禁用之后的新消息",
      messageType: "text",
      channel: "web",
    });
    expect(await plaintextRows("messages", "content", userId)).toBeGreaterThan(0);
    expect(await countMigrationWork(userId, "decrypt")).toBe(0);
  });

  it("defers the background jobs of a locked account until it signs in", async () => {
    const { userId } = await seedUser("locked");
    await markBackupDone(userId);
    await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    forgetDataKey(userId);
    forgetAllEncryptionStates();
    expect(await isEncryptionLocked(userId)).toBe(true);
    await unlockInProcess(userId);
    expect(await isEncryptionLocked(userId)).toBe(false);
  });

  it("writes a backup whose encrypted rows stay ciphertext", async () => {
    const { userId } = await seedUser("backup");
    await markBackupDone(userId);
    await enableEncryptionForUser(userId, PASSWORD);
    await waitForMigration(userId);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-c85-backup-"));
    const file = path.join(dir, "encrypted.mirrai-backup");
    try {
      const created = await createBackup({
        scope: userId,
        passphrase: "backup passphrase",
        out: file,
      });
      expect(created.bytes).toBeGreaterThan(0);
      let sawEncryption = false;
      let sawSentinel = false;
      await inspectBackup({
        file,
        passphrase: "backup passphrase",
        onManifest: async (_manifest, staging) => {
          const userPart = await fs.readFile(path.join(staging, "db", "users.ndjson"), "utf8");
          sawEncryption = userPart.includes("\"encryption\"") && userPart.includes("wrappedKey");
          const messages = await fs.readFile(path.join(staging, "db", "messages.ndjson"), "utf8");
          sawSentinel = messages.includes(SENTINEL);
          expect(messages).toContain("enc:v1:");
        },
      });
      expect(sawEncryption).toBe(true);
      expect(sawSentinel).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
