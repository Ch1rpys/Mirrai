import { eq, ne, desc, and, or, sql, count, sum, gte, ilike, asc, lt, lte, max, min, inArray, notInArray, isNull, isNotNull, exists } from "drizzle-orm";
import type { Locale } from "@shared/copy";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes, type Scene,
  chatSummaries, safetyEvents, graduationAssessments,
  channelBindings, channelStates, channelDefaultPersonas, personaTemplates, personaQuestionnaireAnswers,
  reminderDeliveries, researchProfiles, collectedMessages, collectionSources,
  collectionJobs,
  distillationChunks, distillationCards, personaVersions,
  evalCases, evalRuns, outboundLetters, fidelityFeedback, fidelityPairs, blindSessions,
  recordEmbeddings, pushSubscriptions, apiKeys, ApiKey, InsertApiKey, recordMarks, recordReports,
  InsertRecordMark, RecordMark,
  InsertPersona, InsertPersonaFile, InsertMessage,
  InsertWechatBinding, InsertSkillJob, InsertLlmConfig,
  InsertMemory, InsertEmotionSnapshot, InsertDiaryEntry, InsertScene,
  InsertChatSummary, InsertSafetyEvent, InsertGraduationAssessment,
  InsertPersonaTemplate, InsertPersonaQuestionnaireAnswer,
  InsertResearchProfile, InsertCollectedMessage, CollectedMessage,
  InsertCollectionJob,
  InsertDistillationChunk, InsertDistillationCard,
  InsertEvalCase, InsertEvalRun, InsertOutboundLetter, InsertFidelityFeedback, FidelityFeedback,
  InsertFidelityPair,
  InsertBlindSession, InsertRecordEmbedding,
  userMoods, relationshipEvents, letters, memoryExtractions,
  InsertUserMood, InsertRelationshipEvent, InsertLetter,
  replyJobs, InsertReplyJob, ReplyJob,
  stickers, InsertSticker, Sticker,
  media, InsertMedia, Media,
  memoryMedia, InsertMemoryMedia, MemoryMedia,
  rehearsals, InsertRehearsal,
  sessionCheckins, InsertSessionCheckin,
  sessionCheckinPrompts, InsertSessionCheckinPrompt,
  userJournal, InsertUserJournalEntry,
  roleplaySessions, InsertRoleplaySession,
  scheduledItems, InsertScheduledItem, ScheduledItem,
  personaShares, InsertPersonaShare,
  oralAccounts, InsertOralAccount, OralAccount,
  llmUsage, InsertLlmUsage,
  messageMarks, InsertMessageMark, MessageMark,
  schemaMigrations,
} from "../drizzle/schema";
import { BUILTIN_SCENE_DEFINITIONS } from "@shared/copy/scenes";
import { localDateKey, previousDateKey, zonedDateKey, zonedDayKeyWindowStart } from "@shared/timezone";
import { sqlZoneName, userDayColumn, userHourColumn } from "./_core/user-day";
import { dayShiftMinutes, zonedDayStart } from "@shared/timezone";
import {
  normalizePersonaSettings,
  type PersonaSettings,
} from "@shared/persona-settings";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";
import { RELATIONSHIP_PHASE_EVENTS } from "@shared/user-side";
import { mergeInheritedPersonaState } from "@shared/persona-sharing";
import { BEHAVIOR_MAX_GAP_SEC, BEHAVIOR_MIN_GAP_SEC } from "@shared/behavior-profile";
import { DEFAULT_SCENE_BREAK_HOURS } from "@shared/scenes";
import { normalizeSceneRecordRange } from "@shared/scene-range";
import { PERIOD_SILENCE_DAYS } from "@shared/periods";
import type { MaterialCounts } from "@shared/material-report";
import { RITUAL_MAX_REPLY_CHARS, RITUAL_MAX_TRIGGER_CHARS } from "@shared/ritual-table";
import { charBigrams } from "@shared/act-clusters";
import { queryLexemes, searchTokens, toTsQuery } from "@shared/search-tokens";
import { MAX_EMBEDDED_TURNS } from "@shared/records";
import { normalizeLockSettings, type LockSettings } from "@shared/lock";
import { normalizeUserEncryption } from "@shared/encryption";
import {
  decryptJsonForRead,
  decryptRecordMetaForRead,
  decryptRowForRead,
  decryptRowsForRead,
  decryptTextForRead,
  encryptTextForWrite,
  encryptWriteValues,
  encryptRecordMetaForWrite,
  encryptionEnabledFor,
  indexTokensFor,
  queryTokensFor,
  rememberEncryptionState,
  requireDataKeyForWrite,
  usesBlindIndex,
  type EncryptedTable,
} from "./_core/encrypted-values";

let _db: ReturnType<typeof drizzle> | null = null;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|econnrefused|etimedout|connection terminated|socket hang up|too many clients/.test(msg);
}

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
      return _db;
    } catch (error) {
      if (attempt < 2 && isTransientDbError(error)) {
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      return null;
    }
  }
  return null;
}

/**
 * Whether the database answers at all (C8.12).
 *
 * `getDb()` only builds the client; the first query is what actually opens
 * the connection. So this asks the database a question with no tables in
 * it — the cheapest one there is — and lets the driver's error out. A
 * caller that gets `false` knows there is no DATABASE_URL, which is a
 * different answer from "the connection failed".
 */
export async function pingDatabase(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.execute(sql`SELECT 1`);
  return true;
}

/**
 * The newest migration the database says it has applied (C8.12).
 *
 * The versions are zero-padded numbers (`0078_soft_delete`), but the
 * newest is worked out from the number rather than from the text, so a
 * file numbered ten thousand and first would still sort last.
 */
export async function getLatestAppliedMigrationVersion(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ version: schemaMigrations.version })
    .from(schemaMigrations);
  if (rows.length === 0) return null;
  return rows
    .map((row) => row.version)
    .sort((a, b) => {
      const numberA = Number.parseInt(a, 10);
      const numberB = Number.parseInt(b, 10);
      if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) {
        return numberA - numberB;
      }
      return a.localeCompare(b);
    })
    .at(-1) ?? null;
}

/** The size of the database on disk, as PostgreSQL reports it (C8.12). */
export async function getDatabaseSizeBytes(): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(
    sql`SELECT pg_database_size(current_database()) AS size`,
  );
  const row = (result as unknown as { rows?: Array<{ size?: unknown }> }).rows?.[0];
  const size = Number(row?.size);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

/**
 * The `tsvector` expression for one row's text (C8.6).
 *
 * The application cuts the text into character bigrams; PostgreSQL
 * only stores and indexes them. Binding the array through the driver
 * makes PostgreSQL render the Postgres array literal, so no string is
 * spliced into the SQL.
 */
function pgTextArrayLiteral(values: string[]): string {
  // The tokenizer only produces letters, digits, kana and Han, but the
  // quoting is here so the helper is safe for anything else as well.
  return `{${values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}

function searchTokensValue(content: string) {
  return sql`array_to_tsvector(${pgTextArrayLiteral(searchTokens(content))}::text[])`;
}

/**
 * The token expression for one written row (C8.6, C8.5).
 *
 * A plaintext account stores character bigrams; an encrypted account
 * stores an HMAC of every bigram, so the query can still match a word
 * without the column saying what the word is. The value is computed
 * synchronously because every write already knows its owner.
 */
function searchTokensValueFor(userId: number, content: string) {
  if (!usesBlindIndex(userId)) return searchTokensValue(content);
  return sql`array_to_tsvector(${pgTextArrayLiteral(indexTokensFor(userId, content))}::text[])`;
}

/**
 * Decrypts a page of rows read from an encrypted-content table.
 *
 * Reads are state-free: a value that is not ciphertext passes through,
 * so this is safe even for accounts that never turned encryption on.
 */
function decryptRows<T extends Record<string, unknown>>(table: EncryptedTable, rows: T[]): T[] {
  return decryptRowsForRead(table, rows);
}

/** Decrypts one row read from an encrypted-content table. */
function decryptRowOf<T extends Record<string, unknown>>(
  table: EncryptedTable,
  row: T | null | undefined,
): T | null | undefined {
  return decryptRowForRead(table, row);
}

/**
 * Remembers whether an account's content is encrypted.
 *
 * Every user row the database layer reads is an opportunity to teach the
 * process which accounts are encrypted — and every authenticated request
 * reads the user row before it writes anything.
 */
function rememberUserEncryption(user: { id: number; encryption?: unknown } | null | undefined): void {
  if (user) rememberEncryptionState(user.id, user.encryption);
}


/**
 * Users whose encryption column says a row migration is pending (C8.5).
 *
 * The scheduler resumes those jobs after a restart; the settings page
 * shows their progress. Only the two columns needed are read.
 */
export async function getUsersWithPendingEncryptionMigration(): Promise<
  Array<{ id: number; encryption: unknown }>
> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: users.id, encryption: users.encryption })
    .from(users)
    .where(sql`${users.encryption}->'migration' IS NOT NULL`);
  return rows;
}

/**
 * Records that a full backup was made (C8.5).
 *
 * Enabling database encryption is gated on having a backup: if the
 * password and the recovery code are both lost, the backup is the only
 * way back. The marker lives in `users.backupSettings`.
 */
export async function recordFullBackupAt(userId: number, at: Date = new Date()): Promise<void> {
  const { normalizeBackupSettings } = await import("@shared/backup");
  const current = normalizeBackupSettings(await getUserBackupSettings(userId));
  await setUserBackupSettings(userId, { ...current, lastFullBackupAt: at.toISOString() });
}

/** Whether writes for this account are encrypted. */
function encryptsWrites(userId: number): boolean {
  return encryptionEnabledFor(userId);
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (isTransientDbError(err) && attempt < maxRetries) {
        _db = null;
        const delay = 100 * Math.pow(2, attempt);
        console.warn(`[Database] Transient error, reconnecting in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * The transaction handle handed to `withTransaction` callbacks.
 */
export type DbTransaction = Parameters<
  Parameters<ReturnType<typeof drizzle>["transaction"]>[0]
>[0];

/**
 * Runs a set of writes inside a single database transaction.
 *
 * The transaction is wrapped in `withRetry`, so a transient connection
 * failure is retried with a fresh connection instead of failing the write.
 */
export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return withRetry(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    return db.transaction(async (tx) => fn(tx));
  });
}

// ─── User helpers ───────────────────────────────────────────────────────────

export async function createUser(data: {
  username: string;
  passwordHash: string;
  name: string;
  /**
   * The account's role.
   *
   * The first account is the administrator's — it is called "admin" and
   * it is written to a credentials file. It was created with the
   * default role, so it was an ordinary account with a name that
   * promised something else.
   */
  role?: "user" | "admin";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(users).values({
    username: data.username,
    passwordHash: data.passwordHash,
    name: data.name,
    role: data.role ?? "user",
    lastSignedIn: new Date(),
  }).returning({ id: users.id });
  return result.id;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  rememberUserEncryption(result[0]);
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  rememberUserEncryption(result[0]);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  rememberUserEncryption(result[0]);
  return result[0];
}

export async function updateUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, id));
}

export async function updateUserProfile(
  id: number,
  data: {
    name?: string;
    /**
     * The address, or `null` to take it away.
     *
     * `undefined` means "leave it alone" — so an empty field cannot
     * clear the address unless the caller says `null` explicitly.
     */
    email?: string | null;
    timezone?: string | null;
    addressStyle?: string | null;
    boundaries?: string | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set(data).where(eq(users.id, id));
}

// ─── The persona reaching out first ─────────────────────────────────────────

/**
 * The personas that may speak first.
 *
 * Only the ones whose user asked for it: the frequency is not zero.
 */
export async function getProactivePersonas() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personas.id,
    userId: personas.userId,
    name: personas.name,
    lastChatAt: personas.lastChatAt,
    /**
     * When the user last spoke.
     *
     * The proactive sweep measures the *user's* silence — and it used
     * to measure it from the last thing of any kind, which the app's
     * own nightly message reset. So a persona could never reach out to
     * a user who had gone quiet.
     */
    lastUserMessageAt: personas.lastUserMessageAt,
    presence: personas.presence,
    graduationStatus: personas.graduationStatus,
    proactiveFrequencyHours: personas.proactiveFrequencyHours,
    /**
     * Whether the persona is ready, and how it behaves.
     *
     * The sweep used to read the whole persona row for every
     * proactive persona — every minute, for ever — just to learn these
     * two things. So an instance with twenty proactive personas read
     * twenty full rows a minute, and threw nineteen of them away.
     */
    analysisStatus: personas.analysisStatus,
    behaviorProfile: personas.behaviorProfile,
  }).from(personas)
    .where(and(isNull(personas.deletedAt), sql`${personas.proactiveFrequencyHours} > 0`));
}

// ─── Letters ────────────────────────────────────────────────────────────────

/**
 * Writes a letter.
 *
 * "private" is kept and never answered; "waiting" is delivered, and the
 * reply lands later.
 */
/**
 * Writes a letter, and the message that carries it, together.
 *
 * The two are one thing: a letter that is in the letters table but not
 * in the conversation is answered by the persona and never seen by the
 * user. They were two writes with nothing between them, so a failure
 * in the middle left the letter delivered with no message in the thread
 * — and the reply could never be regenerated, because the letter was
 * already answered.
 */
export async function createLetterWithMessage(
  letter: InsertLetter,
  message: {
    personaId: number;
    userId: number;
    content: string;
    channel?: "web" | "wechat" | "feishu" | "api" | "telegram" | "discord" | "matrix";
    origin?: string;
  },
): Promise<typeof letters.$inferSelect> {
  const letterValues = encryptWriteValues("letters", letter.userId, letter as unknown as Record<string, unknown>);
  const messageContent = encryptTextForWrite(message.userId, message.content);
  return withTransaction(async (tx) => {
    const [row] = await tx.insert(letters).values(letterValues as typeof letter).returning();
    await tx.insert(messages).values({
      personaId: message.personaId,
      userId: message.userId,
      role: "user",
      content: messageContent!,
      emotionalState: null,
      channel: message.channel ?? "web",
      origin: message.origin ?? "letter",
    });
    /**
     * A letter is the user speaking.
     *
     * So the moment the user last spoke moves — it used not to, and
     * the counter said the user had gone quiet on a day they had
     * written a letter.
     */
    await tx.update(personas)
      .set({ lastUserMessageAt: new Date() })
      .where(and(
        eq(personas.id, message.personaId),
        eq(personas.userId, message.userId),
      ));
    return decryptRowOf("letters", row) as typeof letters.$inferSelect;
  });
}

export async function createLetter(params: {
  userId: number;
  personaId: number;
  body: string;
  mood?: string | null;
  status: "private" | "waiting";
  /** "letter" is written to the persona; "todo" is kept for later. */
  kind?: "letter" | "todo";
  replyAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(letters)
    .values(encryptWriteValues("letters", params.userId, {
      userId: params.userId,
      personaId: params.personaId,
      body: params.body,
      kind: params.kind ?? "letter",
      mood: params.mood ?? null,
      status: params.status,
      replyAt: params.replyAt ?? null,
      createdAt: new Date(),
    }))
    .returning();
  return decryptRowOf("letters", row) as typeof letters.$inferSelect;
}

/** The letters to a persona, newest first. */
/**
 * How many letters there are.
 *
 * The box showed the newest fifty and said nothing about the rest, so
 * the fifty-first simply disappeared from the screen while it was still
 * in the export. The number is what tells the user that.
 */
/**
 * How many letters a persona has.
 *
 * Only the letters — the notes for later are counted separately. The
 * count used to include them, and the panel compares it against the
 * list it is showing — which has the notes *out* of it. So a user with
 * five letters and three notes was told "there are three older letters
 * that are not shown", and the three were in the box below, written out
 * as notes.
 */
export async function countLetters(personaId: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "letter"),
    ));
  return Number(row?.value ?? 0);
}

/**
 * The letters, newest first.
 *
 * `before` is the id of the oldest letter on the page — so the ones
 * older than it can be asked for. Without it the list stopped at two
 * hundred and there was no way to reach the rest: the letters existed
 * in the export and not in the product.
 */
export async function getLetters(
  personaId: number,
  userId: number,
  limit = 200,
  before?: number,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * Only the letters.
   *
   * The notes for later — 「等 TA 回来再说」 — are a different thing,
   * and they are read by their own helper. They used to be in these
   * rows, and the interface filtered them out *after* the server had
   * applied the limit. So the notes took the page slots: the paging
   * cursor walked through rows that were never displayed, and because
   * the total counts only the letters while the list was truncated by
   * the notes, the panel could say "no letters yet" and "N older
   * letters are not shown" at the same time.
   *
   * And the cursor gets the id as a tie-breaker, the way the messages
   * read does. Two letters written in the same millisecond share a
   * `createdAt`, and the comparison was on the time alone — so the row
   * that sorts after the cursor within that millisecond was on neither
   * page, and could never be reached. The letter was in the export and
   * not in the product.
   */
  let cursor: { createdAt: Date; id: number } | undefined;
  if (before) {
    const [row] = await db
      .select({ createdAt: letters.createdAt, id: letters.id })
      .from(letters)
      .where(and(
        eq(letters.id, before),
        eq(letters.personaId, personaId),
        eq(letters.userId, userId),
      ))
      .limit(1);
    cursor = row ? { createdAt: row.createdAt, id: row.id } : undefined;
  }
  const rows = await db.select().from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "letter"),
      ...(cursor
        ? [
            or(
              lt(letters.createdAt, cursor.createdAt),
              and(eq(letters.createdAt, cursor.createdAt), lt(letters.id, cursor.id)),
            )!,
          ]
        : []),
    ))
    .orderBy(desc(letters.createdAt), desc(letters.id))
    .limit(limit);
  return decryptRows("letters", rows);
}

/**
 * The notes the user kept for later.
 *
 * 「等 TA 回来再说」 — the things to say when the two of them are in
 * touch again. They are surfaced when the user comes back, not pushed
 * out of the blue.
 */
export async function getWaitingNotes(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The open notes first, then the ones already said (C3.7).
   *
   * A checklist that stays in the order it was written is a list where
   * the finished items are in the way. The ticked ones sink to the
   * bottom, and both groups stay newest-first, which is the order the
   * component also keeps.
   *
   * The first sort key is an explicit boolean, not `doneAt asc`: in
   * PostgreSQL `ASC` sorts NULLs last, so `doneAt asc` put the *ticked*
   * notes first. With the limit below, twenty ticked notes pushed the
   * open ones off the page entirely.
   */
  const rows = await db.select().from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "todo"),
    ))
    .orderBy(sql`(${letters.doneAt} is null) desc`, desc(letters.createdAt), desc(letters.id))
    .limit(20);
  return decryptRows("letters", rows);
}

/** One letter or note of the caller's own. */
export async function getLetterById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(letters).where(and(
    eq(letters.id, id),
    eq(letters.userId, userId),
  )).limit(1);
  return decryptRowOf("letters", rows[0]) ?? null;
}

/**
 * Ticks a note off, or puts it back (C3.7).
 *
 * Only 「等 TA 回来再说」 notes have a done state; a letter that was
 * delivered is answered, not completed. The route checks the kind, and
 * the query does too, so a bug in one place cannot tick a letter.
 */
export async function setLetterDone(
  id: number,
  userId: number,
  done: boolean,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(letters).set({
    doneAt: done ? new Date() : null,
  }).where(and(
    eq(letters.id, id),
    eq(letters.userId, userId),
    eq(letters.kind, "todo"),
  )).returning({ id: letters.id });
  return rows.length > 0;
}

/**
 * How many notes there are in all.
 *
 * The list stops at twenty — so the interface needs to know that there
 * are more, or it says "here are your notes" and the rest of the
 * user's own words are simply not on the screen.
 */
export async function countWaitingNotes(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ c: count() }).from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "todo"),
    ));
  return rows[0]?.c ?? 0;
}

/** Pushes a letter's reply further out. */
export async function deferLetter(id: number, userId: number, replyAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set({ replyAt })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning();
  return decryptRowOf("letters", row) ?? null;
}

/** The letters whose reply is due, across every user. */
/**
 * How long a claim on a letter is taken to belong to a process that is
 * no longer running.
 *
 * The answer takes a model call, and a model call is allowed two
 * minutes — three times over, with the retries between them. So the
 * window has to be longer than the worst case, not the typical one: at
 * five minutes the claim went stale *while the first answer was still
 * being written*, so the next sweep claimed the same letter and
 * answered it again — the second answer overwrote the first, and the
 * conversation got both.
 *
 * Fifteen minutes is comfortably longer than the worst case.
 */
export const LETTER_CLAIM_STALE_MS = 15 * 60_000;

export async function getDueLetters(now: Date, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The letters that are due, and that nobody is answering right now.
   *
   * A letter that a sweep has claimed is skipped — until the claim has
   * gone stale, which means the process that took it is gone.
   */
  const staleBefore = new Date(now.getTime() - LETTER_CLAIM_STALE_MS);
  const rows = await db.select().from(letters)
    .where(and(
      eq(letters.status, "waiting"),
      lte(letters.replyAt, now),
      or(
        isNull(letters.claimedAt),
        lt(letters.claimedAt, staleBefore),
      ),
    ))
    .orderBy(asc(letters.replyAt))
    .limit(limit);
  return decryptRows("letters", rows);
}

/** The last answer given to a persona, for the reply gap. */
export async function getLastLetterReplyAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ repliedAt: letters.repliedAt }).from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.status, "answered"),
    ))
    .orderBy(desc(letters.repliedAt))
    .limit(1);
  return rows[0]?.repliedAt ?? null;
}

/** Records the answer to a letter. */
/**
 * Writes the answer into a letter.
 *
 * The claim — `claimLetter` — is what keeps two sweeps from both
 * answering the same letter. This only fills in the text of a letter
 * that has already been claimed.
 */
/**
 * Writes the answer to a letter, and the message that carries it,
 * together.
 *
 * The two are one thing: a reply that lives only in a list is a
 * notification; one that lands in the thread is a reply. They were
 * two writes with nothing between them, so a failure in the middle
 * left the answer in the list and never in the conversation — and the
 * letter was already answered, so it could never be regenerated.
 */
export async function answerLetterWithMessage(
  id: number,
  userId: number,
  replyText: string,
  repliedAt: Date,
  message: {
    personaId: number;
    content: string;
    emotionalState: string | null;
    channel?: "web" | "wechat" | "feishu" | "api" | "telegram" | "discord" | "matrix";
  },
): Promise<boolean> {
  return withTransaction(async (tx) => {
    /**
     * Only a letter that is still waiting.
     *
     * The write used to take any letter — so a second sweep, which had
     * claimed the letter because the first claim had gone stale,
     * overwrote the first answer's text *and* inserted a second
     * message into the conversation. The user saw two replies to the
     * same letter in the thread, and only the second one in the box.
     */
    const [row] = await tx.update(letters)
      .set(encryptWriteValues("letters", userId, { status: "answered", replyText, repliedAt, claimedAt: null }))
      .where(and(
        eq(letters.id, id),
        eq(letters.userId, userId),
        eq(letters.status, "waiting"),
      ))
      .returning({ id: letters.id });
    if (!row) return false;
    await tx.insert(messages).values({
      personaId: message.personaId,
      userId,
      role: "assistant",
      content: encryptTextForWrite(userId, message.content)!,
      emotionalState: message.emotionalState,
      channel: message.channel ?? "web",
      // It is the answer to a letter. Without the marker it was just
      // another message, and the connection to the letter was gone.
      origin: "letter",
    });
    return true;
  });
}

export async function answerLetter(
  id: number,
  userId: number,
  replyText: string,
  repliedAt: Date = new Date(),
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set(encryptWriteValues("letters", userId, { status: "answered", replyText, repliedAt, claimedAt: null }))
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning();
  return decryptRowOf("letters", row) ?? null;
}

/**
 * Claims a letter for answering, before the answer is written.
 *
 * The answer takes a model call, so the claim has to happen first: two
 * sweeps that overlap would otherwise both write an answer.
 */
export async function claimLetter(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * The claim.
   *
   * The letter stays "waiting": it is only answered when the answer
   * has been written. It used to be marked "answered" with an empty
   * reply before the model call, so that nothing could answer it
   * twice — but then a process that stopped during the call left it
   * answered with nothing in it, for ever, because only "waiting"
   * letters are picked up.
   *
   * A claim that has gone stale belongs to a process that is gone, so
   * the letter is claimed again.
   */
  const staleBefore = new Date(Date.now() - LETTER_CLAIM_STALE_MS);
  const [row] = await db.update(letters)
    .set({ claimedAt: new Date() })
    .where(and(
      eq(letters.id, id),
      eq(letters.userId, userId),
      eq(letters.status, "waiting"),
      or(
        isNull(letters.claimedAt),
        lt(letters.claimedAt, staleBefore),
      ),
    ))
    .returning({ id: letters.id });
  return Boolean(row);
}

/**
 * Gives a letter back, so that it can be answered again.
 *
 * It is called when the answer could not be written — the model call
 * failed, or the database did. Without it, the letter would stay
 * claimed for five minutes for nothing.
 */
export async function releaseLetterClaim(id: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(letters)
    .set({ claimedAt: null })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)));
}

/** Marks a letter as answered with nothing — the persona stayed quiet. */
/**
 * A letter the persona could not answer.
 *
 * It used to set the letter back to "private" — the status of a letter
 * that was *kept* and never sent. But the letter had been delivered: it
 * was in the conversation as the user's own message, written
 * atomically with the row. So one provider hiccup turned a delivered
 * letter into a kept one, the interface showed the "kept" badge, and
 * `replyAt: null` meant the sweep never picked it up again — the reply
 * never came and the app said the letter had never been sent.
 *
 * The letter keeps its "waiting" status, and the attempt is put back
 * an hour later — so it is tried again, and the user is not told a
 * lie.
 */
export async function markLetterUnanswered(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(letters)
    .set({
      status: "waiting",
      replyAt: new Date(Date.now() + LETTER_RETRY_AFTER_MS),
      claimedAt: null,
    })
    .where(and(
      eq(letters.id, id),
      eq(letters.userId, userId),
      // Only a letter that is still waiting — one that has been
      // answered keeps its answer.
      eq(letters.status, "waiting"),
    ))
    .returning();
  return decryptRowOf("letters", row) ?? null;
}

/**
 * How long a letter waits before it is tried again.
 *
 * Long enough not to hammer a provider that is having a bad minute,
 * short enough that the reply still arrives while the user cares.
 */
export const LETTER_RETRY_AFTER_MS = 60 * 60_000;

export async function deleteLetter(id: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  const deleted = await db.delete(letters)
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning({ id: letters.id });
  return deleted.length > 0;
}

// ─── The mailbox (C8.2) ────────────────────────────────────────────────────

/**
 * Marks one answered letter as read.
 *
 * The answer is written a day after the letter, when the user is not
 * looking — so without this, an answered letter looked exactly like one
 * the user had already read.
 */
export async function markLetterRead(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(letters).set({ readAt: new Date() })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning({ id: letters.id });
  return rows.length > 0;
}

/**
 * Records that the user had this persona's conversation in front of
 * them.
 *
 * It is what tells "a reply arrived while they were away" from "a reply
 * arrived while they were reading". Only the user's own row is touched:
 * a shared persona's conversation is a separate row.
 *
 * The time is the database's `now()`, not a JavaScript date. The two are
 * written differently — `messages.createdAt` comes from the database's
 * own clock while a JavaScript `Date` is stored as UTC wall-clock time —
 * so comparing a JavaScript date against a message's `createdAt` is off
 * by the zone offset. Writing both the same way is what makes "after the
 * last time they looked" mean what it says.
 */
export async function markPersonaRead(
  personaId: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(personas)
    .set({ lastReadAt: sql`now()` })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

/**
 * Every letter of the user's, across every persona, for the mailbox.
 *
 * The per-persona box reads one persona's letters; the mailbox has to
 * put all of them in the same five groups, so it needs the persona name
 * with each row. Sealed personas are filtered by the caller — that
 * decision needs the settings and the clock, not the table.
 */
export async function listInboxLetters(userId: number, personaIds: number[]) {
  const db = await getDb();
  if (!db || personaIds.length === 0) return [];
  const rows = await db.select({
    id: letters.id,
    userId: letters.userId,
    personaId: letters.personaId,
    body: letters.body,
    kind: letters.kind,
    status: letters.status,
    mood: letters.mood,
    replyAt: letters.replyAt,
    repliedAt: letters.repliedAt,
    replyText: letters.replyText,
    readAt: letters.readAt,
    createdAt: letters.createdAt,
    personaName: personas.name,
  })
    .from(letters)
    .innerJoin(personas, and(eq(personas.id, letters.personaId), isNull(personas.deletedAt)))
    .where(and(
      eq(letters.userId, userId),
      inArray(letters.personaId, personaIds),
      eq(letters.kind, "letter"),
    ))
    .orderBy(desc(letters.createdAt), desc(letters.id))
    .limit(500);
  return decryptRows("letters", rows);
}

/** How many answered letters of theirs have not been read (C8.2). */
export async function countUnreadLetters(
  userId: number,
  personaIds: number[],
): Promise<number> {
  const db = await getDb();
  if (!db || personaIds.length === 0) return 0;
  const [row] = await db.select({ c: count() }).from(letters).where(and(
    eq(letters.userId, userId),
    inArray(letters.personaId, personaIds),
    eq(letters.kind, "letter"),
    eq(letters.status, "answered"),
    isNull(letters.readAt),
  ));
  return Number(row?.c ?? 0);
}

/**
 * The scheduled things that have not come due yet, and the capsules
 * whose day has come.
 *
 * The mailbox shows both groups; the per-persona box could only show
 * one persona's.
 */
export async function listInboxScheduled(userId: number, personaIds: number[]) {
  const db = await getDb();
  if (!db || personaIds.length === 0) return [];
  const rows = await db.select({
    id: scheduledItems.id,
    userId: scheduledItems.userId,
    personaId: scheduledItems.personaId,
    kind: scheduledItems.kind,
    body: scheduledItems.body,
    dueAt: scheduledItems.dueAt,
    status: scheduledItems.status,
    cancelReason: scheduledItems.cancelReason,
    openedAt: scheduledItems.openedAt,
    createdAt: scheduledItems.createdAt,
    personaName: personas.name,
  })
    .from(scheduledItems)
    .innerJoin(personas, and(eq(personas.id, scheduledItems.personaId), isNull(personas.deletedAt)))
    .where(and(
      eq(scheduledItems.userId, userId),
      inArray(scheduledItems.personaId, personaIds),
      inArray(scheduledItems.status, ["scheduled", "delivered"]),
    ))
    .orderBy(asc(scheduledItems.dueAt))
    .limit(500);
  /**
   * `scheduled_items.body` is an encrypted column (C8.5), and the
   * mailbox shows it — decrypt every row before it leaves this layer.
   */
  return decryptRows("scheduled_items", rows);
}

/** How many due capsules have not been opened (C8.2). */
export async function countUnopenedCapsules(
  userId: number,
  personaIds: number[],
  now: Date = new Date(),
): Promise<number> {
  const db = await getDb();
  if (!db || personaIds.length === 0) return 0;
  const [row] = await db.select({ c: count() }).from(scheduledItems).where(and(
    eq(scheduledItems.userId, userId),
    inArray(scheduledItems.personaId, personaIds),
    eq(scheduledItems.kind, "capsule"),
    eq(scheduledItems.status, "delivered"),
    lte(scheduledItems.dueAt, now),
    isNull(scheduledItems.openedAt),
  ));
  return Number(row?.c ?? 0);
}

/** Marks a capsule as opened, so it stops counting as waiting. */
export async function markScheduledOpened(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(scheduledItems)
    .set({ openedAt: new Date() })
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, userId)))
    .returning({ id: scheduledItems.id });
  return rows.length > 0;
}

/**
 * The replies that arrived while the user was not looking (C8.2).
 *
 * Two kinds: a reply the app deferred and then delivered later
 * (`metadata.deferred`), and the answer to a message the user scheduled
 * (`metadata.scheduled`). Proactive messages and follow-ups are
 * deliberately not here — they are waiting quietly in the conversation,
 * not something the user owes an answer to.
 *
 * `personaReadAt` is the user's own `lastReadAt` per persona; a reply is
 * unread when it arrived after the last time that conversation was in
 * front of them.
 */
export async function countUnreadAutoRepliesByPersona(
  userId: number,
  personaReadAt: Array<{ id: number; lastReadAt: Date | null }>,
): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  const ids = personaReadAt.map((p) => p.id);
  if (ids.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  const rows = await db.select({
    personaId: messages.personaId,
    createdAt: messages.createdAt,
  })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      eq(messages.role, "assistant"),
      inArray(messages.personaId, ids),
      or(
        sql`${messages.metadata} -> 'deferred' IS NOT NULL`,
        sql`${messages.metadata} ->> 'scheduled' = 'true'`,
      )!,
    ));
  const lastRead = new Map<number, number | null>(
    personaReadAt.map((p) => [p.id, p.lastReadAt ? p.lastReadAt.getTime() : null]),
  );
  for (const row of rows) {
    const readAt = lastRead.get(row.personaId) ?? null;
    if (readAt === null || row.createdAt.getTime() > readAt) {
      out[row.personaId] = (out[row.personaId] ?? 0) + 1;
    }
  }
  return out;
}

// ─── The user's own side ────────────────────────────────────────────────────

/**
 * Records how the user is doing today.
 *
 * One entry per day: checking in again replaces it, because the point is
 * that recording is cheap enough to do every day.
 */
export async function upsertUserMood(params: {
  userId: number;
  date: string;
  mood: string;
  note?: string | null;
  source?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const [row] = await db.insert(userMoods)
    .values({
      userId: params.userId,
      date: params.date,
      mood: params.mood,
      note: params.note ?? null,
      source: params.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userMoods.userId, userMoods.date],
      set: {
        mood: params.mood,
        note: params.note ?? null,
        source: params.source ?? "manual",
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

/**
 * The messages the user sent to one persona since a point in time.
 *
 * The emotion snapshot belongs to a persona, so its count has to be that
 * persona's messages — not the user's across every conversation.
 */
export async function getUserMessageCountForPersonaSince(
  personaId: number,
  userId: number,
  since: Date,
) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  return result?.c || 0;
}

/** The user's own moods, oldest first. */
export async function getUserMoods(
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window is applied to the *day* of the mood.
   *
   * It was applied to `createdAt` — when the row was written. So a
   * mood recorded today for a day three weeks ago was inside a "last
   * thirty days" chart although its day was outside it, and a mood
   * recorded yesterday for today was outside a "last seven days" chart
   * although its day was inside it. The chart plots the day.
   *
   * The window is in the user's own calendar too, so the days it names
   * are the days the moods are filed under.
   *
   * And it is the same length as the chart beside it: "the last thirty
   * days" is thirty days, ending today. It was thirty-one — so the
   * moods chart started a day before the daily-messages chart, and the
   * two did not line up.
   */
  const since = zonedDayKeyWindowStart(days, timezone);
  return db.select().from(userMoods)
    .where(and(eq(userMoods.userId, userId), gte(userMoods.date, since)))
    .orderBy(asc(userMoods.date));
}

/** The user's moods filed on days between two day keys, oldest first. */
export async function getUserMoodsBetween(
  userId: number,
  fromDay: string,
  toDay: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userMoods)
    .where(and(
      eq(userMoods.userId, userId),
      gte(userMoods.date, fromDay),
      lte(userMoods.date, toDay),
    ))
    .orderBy(asc(userMoods.date));
}

/**
 * The user's most recent mood.
 *
 * A mood from three days ago is not a mood any more, so only the last
 * couple of days count.
 */
export async function getRecentUserMood(userId: number, maxAgeDays = 2) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userMoods)
    .where(eq(userMoods.userId, userId))
    .orderBy(desc(userMoods.date))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - new Date(row.date).getTime();
  if (age > maxAgeDays * 86_400_000) return null;
  return row;
}

/**
 * Records something that actually happened in the relationship.
 *
 * The events are the user's own record of their own life. The app does not
 * guess them: guessing would mean inventing a relationship the user did
 * not have.
 */
export async function createRelationshipEvent(params: {
  userId: number;
  personaId: number;
  kind: string;
  title: string;
  detail?: string | null;
  happenedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(relationshipEvents)
    .values({
      userId: params.userId,
      personaId: params.personaId,
      kind: params.kind,
      title: params.title,
      detail: params.detail ?? null,
      happenedAt: params.happenedAt ?? new Date(),
      recordedAt: new Date(),
    })
    .returning();
  return row ?? null;
}

/** What happened in the relationship, most recent first. */
export async function getRelationshipEvents(
  personaId: number,
  userId: number,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(relationshipEvents)
    .where(and(
      eq(relationshipEvents.personaId, personaId),
      eq(relationshipEvents.userId, userId),
    ))
    .orderBy(desc(relationshipEvents.happenedAt))
    .limit(limit);
}

/**
 * How many events the timeline holds.
 *
 * The list is capped, and the cap used to be silent: a user with
 * three hundred entries saw the newest two hundred with nothing
 * saying so — so the record of their own relationship looked
 * complete, and the oldest entries were simply gone.
 */
export async function countRelationshipEvents(
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(relationshipEvents)
    .where(and(
      eq(relationshipEvents.personaId, personaId),
      eq(relationshipEvents.userId, userId),
    ));
  return result?.c || 0;
}

export async function deleteRelationshipEvent(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const deleted = await db.delete(relationshipEvents)
    .where(and(eq(relationshipEvents.id, id), eq(relationshipEvents.userId, userId)))
    .returning({ id: relationshipEvents.id });
  return deleted.length > 0;
}

/**
 * The user's own time zone.
 *
 * A single column read, because the chat pipeline needs it on every turn
 * and the full user row is more than it needs.
 */
/**
 * The language the user reads.
 *
 * The interface sends it on every request, but the things the app sends
 * on its own — a reminder at midnight, a reply in a chat window — have to
 * know it without being asked, so it is kept here.
 */
export async function getUserLocale(userId: number): Promise<Locale> {
  const db = await getDb();
  if (!db) return "zh";
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  if (row?.locale === "en") return "en";
  if (row?.locale === "zh-Hant") return "zh-Hant";
  return "zh";
}

/** Remembers the language the user reads. */
export async function setUserLocale(userId: number, locale: Locale): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

export async function getUserTimezone(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ timezone: users.timezone }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return rows[0]?.timezone ?? null;
}

/**
 * Sets whether the app may read the user's own messages to assess their
 * emotional trajectory.
 */
export async function updateUserTrajectoryAssessment(id: number, setting: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ trajectoryAssessment: setting }).where(eq(users.id, id));
}

/**
 * Sets the instance-wide default for the graduation mechanism.
 *
 * The value is stored as written; the callers only ever pass one of the
 * three known modes.
 */
export async function updateUserGraduationMode(id: number, mode: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ graduationMode: mode }).where(eq(users.id, id));
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

/**
 * The app lock's stored half (C8.4).
 *
 * The PIN hash and the settings are read together so a route can decide
 * in one round trip, and written together so a half-enabled lock — a
 * PIN without the switch, or the switch without a PIN — cannot happen.
 *
 * `lockSettings` goes through `normalizeLockSettings` on the way out as
 * well as on the way in: the column is JSON, and a hand edit should not
 * be able to hand the guard a shape it does not expect.
 */
export interface UserLockRow {
  lockPinHash: string | null;
  lockSettings: LockSettings;
}

export async function getUserLockRow(userId: number): Promise<UserLockRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ lockPinHash: users.lockPinHash, lockSettings: users.lockSettings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!rows[0]) return null;
  return {
    lockPinHash: rows[0].lockPinHash ?? null,
    lockSettings: normalizeLockSettings(rows[0].lockSettings),
  };
}

/** The encryption half of a user row (C8.5). */
export async function getUserEncryption(userId: number): Promise<unknown> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ encryption: users.encryption })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const value = rows[0]?.encryption ?? null;
  rememberEncryptionState(userId, value);
  return value;
}

/** Writes the encryption column; null means "plaintext account". */
export async function setUserEncryption(userId: number, value: unknown): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .update(users)
    .set({ encryption: value as never, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Writes the app lock's stored half. */
export async function setUserLock(
  userId: number,
  patch: { lockPinHash?: string | null; lockSettings?: LockSettings | null },
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const update: { lockPinHash?: string | null; lockSettings?: LockSettings | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.lockPinHash !== undefined) update.lockPinHash = patch.lockPinHash;
  if (patch.lockSettings !== undefined) {
    update.lockSettings = patch.lockSettings === null ? null : normalizeLockSettings(patch.lockSettings);
  }
  await db.update(users).set(update).where(eq(users.id, userId));
}

/**
 * Bumps the user's token version, retiring every session that was issued
 * before the bump. Used on logout and after a password change.
 */
export async function bumpUserTokenVersion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, id));
}

/**
 * Deletes every row belonging to a user, in one transaction.
 *
 * The list covers every user-scoped table in the schema — there are no
 * foreign keys to cascade, so a table left out here would keep orphaned rows
 * behind after the account is gone. `server/db-migrations.test.ts` asserts
 * that this list stays in step with the schema.
 */
/**
 * The files a user (or a persona) has on disk.
 *
 * The rows are deleted and the bytes were not — so the uploaded
 * photographs and the extracted chat logs stayed in the uploads
 * directory after the account or the persona was gone. Nothing read
 * them again and nothing cleaned them up.
 *
 * The keys are collected before the rows go.
 */
async function collectStoredFiles(userId: number, personaId?: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  /**
   * soft-delete: include-deleted — the purge path has to collect the
   * media of rows that are already in the bin, or their files stay on
   * disk after the persona is gone.
   */
  const keys = new Set<string>();

  const files = await db
    .select({ fileKey: personaFiles.fileKey })
    .from(personaFiles)
    .where(
      personaId === undefined
        ? eq(personaFiles.userId, userId)
        : and(eq(personaFiles.userId, userId), eq(personaFiles.personaId, personaId)),
    );
  for (const file of files) {
    if (file.fileKey) keys.add(file.fileKey);
  }

  /**
   * The pictures and the voice notes of the conversation.
   *
   * They are stored on the message, not in the files table, so they
   * would have been left behind even after the files table was
   * cleaned.
   */
  const messageMedia = await db
    .select({ mediaUrl: messages.mediaUrl })
    .from(messages)
    .where(
      personaId === undefined
        ? eq(messages.userId, userId)
        : and(eq(messages.userId, userId), eq(messages.personaId, personaId)),
    );
  for (const message of messageMedia) {
    const url = message.mediaUrl;
    if (!url) continue;
    // The url is a path: "/uploads/chat/1/2/x.png".
    const marker = "/uploads/";
    const at = url.indexOf(marker);
    if (at === -1) continue;
    keys.add(url.slice(at + marker.length));
  }

  /**
   * The sticker images.
   *
   * They are copies under `personas/<id>/<id>/stickers/`, made so the
   * library survives the source import being deleted — which means
   * nothing else points at them, and deleting the persona or the
   * account has to take them too.
   */
  const stickerFiles = await db
    .select({ fileKey: stickers.fileKey })
    .from(stickers)
    .where(
      personaId === undefined
        ? eq(stickers.userId, userId)
        : and(eq(stickers.userId, userId), eq(stickers.personaId, personaId)),
    );
  for (const sticker of stickerFiles) {
    if (sticker.fileKey) keys.add(sticker.fileKey);
  }

  /**
   * The recordings and photographs.
   *
   * They are not copies — each row points into the import directory —
   * but the row is what says the file belongs to this persona, so the
   * files go when it does.
   */
  const mediaFiles = await db
    .select({ fileKey: media.fileKey })
    .from(media)
    .where(
      personaId === undefined
        ? eq(media.userId, userId)
        : and(eq(media.userId, userId), eq(media.personaId, personaId)),
    );
  for (const row of mediaFiles) {
    if (row.fileKey) keys.add(row.fileKey);
  }

  /**
   * The avatar and the chat background.
   *
   * They are written by the avatar and background routes under the
   * persona's own directory, and nothing else points at them — so they
   * would survive the persona that owns them.
   */
  const personaRows = await db
    .select({ avatarUrl: personas.avatarUrl, settings: personas.settings })
    .from(personas)
    .where(
      personaId === undefined
        ? eq(personas.userId, userId)
        : and(eq(personas.userId, userId), eq(personas.id, personaId)),
    );
  for (const row of personaRows) {
    const settings =
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {};
    const skin =
      settings.skin && typeof settings.skin === "object" && !Array.isArray(settings.skin)
        ? (settings.skin as Record<string, unknown>)
        : {};
    for (const url of [row.avatarUrl, skin.background]) {
      if (typeof url !== "string") continue;
      const marker = "/uploads/";
      const at = url.indexOf(marker);
      if (at === -1) continue;
      keys.add(url.slice(at + marker.length));
    }
  }

  return [...keys];
}

/**
 * Removes the files of a deleted account or persona.
 *
 * A file that is already gone is not an error: the point is that it is
 * not there.
 */
async function removeStoredFiles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { storageDelete } = await import("./storage");
  await Promise.all(keys.map((key) => storageDelete(key).catch(() => false)));
}

export async function deleteUserAccount(id: number) {
  /**
   * soft-delete: include-deleted — deleting the account deletes every
   * row of it, including the rows that are in the bin. That is the one
   * deletion that is immediate and total (C8.11).
   */
  /**
   * The files on disk.
   *
   * The rows are deleted and the bytes are not: so the uploaded
   * photographs and the extracted chat logs stayed in the uploads
   * directory, under the user's own id, after the account was gone.
   * Nothing read them again and nothing cleaned them up.
   *
   * So the keys are collected before the rows go, and the files are
   * removed after.
   */
  const storedFiles = await collectStoredFiles(id);

  await withTransaction(async (tx) => {
    await tx.delete(apiKeys).where(eq(apiKeys.userId, id));
    await tx.delete(channelBindings).where(eq(channelBindings.userId, id));
    await tx.delete(channelDefaultPersonas).where(eq(channelDefaultPersonas.userId, id));
    await tx.delete(channelStates).where(eq(channelStates.userId, id));
    await tx.delete(chatSummaries).where(eq(chatSummaries.userId, id));
    await tx.delete(collectedMessages).where(eq(collectedMessages.userId, id));
    await tx.delete(collectionJobs).where(eq(collectionJobs.userId, id));
    await tx.delete(collectionSources).where(eq(collectionSources.userId, id));
    await tx.delete(diaryEntries).where(eq(diaryEntries.userId, id));
    await tx.delete(distillationCards).where(eq(distillationCards.userId, id));
    await tx.delete(distillationChunks).where(eq(distillationChunks.userId, id));
    await tx.delete(emotionSnapshots).where(eq(emotionSnapshots.userId, id));
    await tx.delete(evalCases).where(eq(evalCases.userId, id));
    await tx.delete(evalRuns).where(eq(evalRuns.userId, id));
    await tx.delete(blindSessions).where(eq(blindSessions.userId, id));
    await tx.delete(fidelityPairs).where(eq(fidelityPairs.userId, id));
    await tx.delete(fidelityFeedback).where(eq(fidelityFeedback.userId, id));
    await tx.delete(graduationAssessments).where(eq(graduationAssessments.userId, id));
    await tx.delete(llmConfigs).where(eq(llmConfigs.userId, id));
    /**
     * The usage ledger goes with the account (C8.9).
     *
     * It says what the user's own money bought — and with the account
     * gone there is nobody it belongs to.
     */
    await tx.delete(llmUsage).where(eq(llmUsage.userId, id));
    await tx.delete(messageMarks).where(eq(messageMarks.userId, id));
    await tx.delete(letters).where(eq(letters.userId, id));
    await tx.delete(memories).where(eq(memories.userId, id));
    await tx.delete(memoryExtractions).where(eq(memoryExtractions.userId, id));
    await tx.delete(memoryMedia).where(eq(memoryMedia.userId, id));
    await tx.delete(messages).where(eq(messages.userId, id));
    await tx.delete(outboundLetters).where(eq(outboundLetters.userId, id));
    await tx.delete(rehearsals).where(eq(rehearsals.userId, id));
    await tx.delete(sessionCheckins).where(eq(sessionCheckins.userId, id));
    await tx.delete(sessionCheckinPrompts).where(eq(sessionCheckinPrompts.userId, id));
    await tx.delete(userJournal).where(eq(userJournal.userId, id));
    await tx.delete(roleplaySessions).where(eq(roleplaySessions.userId, id));
    await tx.delete(scheduledItems).where(eq(scheduledItems.userId, id));
    await tx.delete(personaFiles).where(eq(personaFiles.userId, id));
    await tx.delete(personaQuestionnaireAnswers).where(eq(personaQuestionnaireAnswers.userId, id));
    await tx.delete(personaTemplates).where(eq(personaTemplates.userId, id));
    await tx.delete(personaVersions).where(eq(personaVersions.userId, id));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, id));
    await tx.delete(replyJobs).where(eq(replyJobs.userId, id));
    await tx.delete(stickers).where(eq(stickers.userId, id));
    await tx.delete(media).where(eq(media.userId, id));
    await tx.delete(personaShares).where(or(
      eq(personaShares.ownerUserId, id),
      eq(personaShares.memberUserId, id),
    ));
    await tx.delete(recordEmbeddings).where(eq(recordEmbeddings.userId, id));
    await tx.delete(recordMarks).where(eq(recordMarks.userId, id));
    await tx.delete(recordReports).where(eq(recordReports.userId, id));
    await tx.delete(relationshipEvents).where(eq(relationshipEvents.userId, id));
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, id));
    await tx.delete(researchProfiles).where(eq(researchProfiles.userId, id));
    await tx.delete(safetyEvents).where(eq(safetyEvents.userId, id));
    await tx.delete(scenes).where(eq(scenes.userId, id));
    await tx.delete(skillJobs).where(eq(skillJobs.userId, id));
    await tx.delete(userMoods).where(eq(userMoods.userId, id));
    await tx.delete(wechatBindings).where(eq(wechatBindings.userId, id));
    await tx.delete(wechatBotState).where(eq(wechatBotState.userId, id));
    /**
     * What they told about other people, and what the family told about
     * theirs (C7.4).
     *
     * The second half needs the persona rows, which are about to go: an
     * account told by a family member carries *their* user id, so
     * deleting by `userId` alone would leave it orphaned under a persona
     * that no longer exists.
     */
    const ownedPersonaIds = await tx.select({ id: personas.id }).from(personas)
      .where(eq(personas.userId, id));
    await tx.delete(oralAccounts).where(or(
      eq(oralAccounts.userId, id),
      // An empty list is the word `false`, so this is the same one
      // statement whether the user owns personas or not.
      inArray(oralAccounts.personaId, ownedPersonaIds.map((row) => row.id)),
    ));
    await tx.delete(personas).where(eq(personas.userId, id));
    await tx.delete(users).where(eq(users.id, id));
  });

  await removeStoredFiles(storedFiles);
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, totalMessages: 0, totalFiles: 0, storageUsed: 0 };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId)));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId)));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(and(isNull(messages.deletedAt), eq(messages.userId, userId)));
  const [fileCount] = await db.select({ c: count() }).from(personaFiles).where(eq(personaFiles.userId, userId));
  const [fileSize] = await db.select({ s: sum(personaFiles.fileSize) }).from(personaFiles).where(eq(personaFiles.userId, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    totalMessages: msgCount?.c || 0,
    totalFiles: fileCount?.c || 0,
    storageUsed: Number(fileSize?.s) || 0,
  };
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [user] = await db.select({ username: users.username, name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users).where(eq(users.id, userId));
  const personaList = await db.select().from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId)));
  // Bounded: the bundle is serialised into one string in memory, and an
  // unbounded query is an out-of-memory crash for the whole server.
  const messageList = await db.select().from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId)))
    .orderBy(messages.createdAt).limit(50_000);
  /**
   * The export is a read like any other (C8.5).
   *
   * It used to return the raw columns, so an encrypted account's export
   * was base64 — the one place the transparent layer was bypassed. Both
   * lists are decrypted with the owner's key here.
   */
  return {
    user,
    personas: decryptRows("personas", personaList),
    messages: decryptRows("messages", messageList),
  };
}

// ─── Persona helpers ────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db
    .insert(personas)
    .values(encryptWriteValues("personas", data.userId, { ...data }))
    .returning({ id: personas.id });
  return result.id;
}

export async function getPersonasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId))).orderBy(desc(personas.updatedAt));
  return withInheritedPersonaState(decryptRows("personas", rows));
}

/**
 * The user's personas, with the little the lobby shows about each.
 *
 * The three numbers used to be asked for one persona at a time — so
 * the lobby, which is the first screen of the app, made one round trip
 * per persona plus three. Four queries do the same work.
 */
export async function getPersonasWithStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId))).orderBy(desc(personas.updatedAt));
  if (rows.length === 0) return [];
  const list = await withInheritedPersonaState(decryptRows("personas", rows));
  const ids = list.map((p) => p.id);

  /**
   * The newest message of each persona.
   *
   * It used to be a `selectDistinct` over (personaId, content,
   * createdAt) — which is a plain `SELECT DISTINCT`, and a plain
   * `DISTINCT` over three columns that are different on every row
   * removes nothing. So the query returned **every message the user
   * has ever sent**, with the full text of each one, and the loop
   * below kept the first row per persona.
   *
   * The lobby is the first screen of the app, so this happened on every
   * visit: the whole history went into the heap of the server process.
   *
   * `DISTINCT ON` is the statement that was meant — one row per
   * persona, the newest.
   */
  const lastMessages = await db
    .selectDistinctOn([messages.personaId], {
      personaId: messages.personaId,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      inArray(messages.personaId, ids),
    ))
    // Postgres insists that the ordering starts with the distinct-on
    // columns.
    .orderBy(messages.personaId, desc(messages.createdAt));

  // The number of record lines of each persona (C2.4's entry card).
  const recordCounts = await db.select({
    personaId: collectedMessages.personaId,
    c: count(),
  })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.userId, userId),
      inArray(collectedMessages.personaId, ids),
    ))
    .groupBy(collectedMessages.personaId);

  // The number of files of each persona.
  const fileCounts = await db.select({
    personaId: personaFiles.personaId,
    c: count(),
  })
    .from(personaFiles)
    .where(and(
      eq(personaFiles.userId, userId),
      inArray(personaFiles.personaId, ids),
    ))
    .groupBy(personaFiles.personaId);

  // Whether each persona is bound to a WeChat conversation.
  const bindings = await db.select({
    personaId: wechatBindings.personaId,
    c: count(),
  })
    .from(wechatBindings)
    .where(and(
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
      inArray(wechatBindings.personaId, ids),
    ))
    .groupBy(wechatBindings.personaId);

  const lastByPersona = new Map<number, { content: string; createdAt: Date }>();
  for (const row of lastMessages) {
    if (lastByPersona.has(row.personaId)) continue;
    lastByPersona.set(row.personaId, {
      content: (decryptTextForRead(userId, row.content) || "").slice(0, 60),
      createdAt: row.createdAt,
    });
  }
  const filesByPersona = new Map(fileCounts.map((r) => [r.personaId, Number(r.c)]));
  const recordsByPersona = new Map(recordCounts.map((r) => [r.personaId, Number(r.c)]));
  const bindingsByPersona = new Map(bindings.map((r) => [r.personaId, Number(r.c)]));

  /**
   * The latest relationship-phase event of each persona.
   *
   * One grouped query, not one round trip per persona. A breakup or
   * an "apart" is enough for the lobby to stop putting them forward;
   * a later reconciliation is enough to let them back.
   */
  const latestPhase = await db
    .selectDistinctOn([relationshipEvents.personaId], {
      personaId: relationshipEvents.personaId,
      kind: relationshipEvents.kind,
    })
    .from(relationshipEvents)
    .where(and(
      eq(relationshipEvents.userId, userId),
      inArray(relationshipEvents.personaId, ids),
      inArray(relationshipEvents.kind, [...RELATIONSHIP_PHASE_EVENTS]),
    ))
    .orderBy(relationshipEvents.personaId, desc(relationshipEvents.happenedAt));

  const phaseByPersona = new Map(latestPhase.map((r) => [r.personaId, r.kind]));

  /**
   * The replies that arrived while the user was not looking (C8.2).
   *
   * One grouped query, not one per card: the lobby asks this on every
   * visit, and the card only needs a boolean and a count.
   */
  const unreadReplies = await countUnreadAutoRepliesByPersona(userId, list);

  return list.map((p) => {
    const lastPhase = phaseByPersona.get(p.id);
    const togetherEnded = Boolean((p.togetherTo ?? "").trim());
    const relationshipEnded = togetherEnded || lastPhase === "breakup" || lastPhase === "apart";
    return {
      ...p,
      lastMessage: lastByPersona.get(p.id) ?? null,
      fileCount: filesByPersona.get(p.id) ?? 0,
      recordCount: recordsByPersona.get(p.id) ?? 0,
      wechatBound: (bindingsByPersona.get(p.id) ?? 0) > 0,
      relationshipEnded,
      unreadReplies: unreadReplies[p.id] ?? 0,
    };
  });
}

export async function getUserStats(userId: number, timezone?: string | null) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId)));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(and(isNull(personas.deletedAt), eq(personas.userId, userId)));
  /**
   * The user's midnight.
   *
   * It was the server's — so "today's chats" on the lobby counted the
   * wrong day for anybody who was not on the server's clock. It also
   * gates the "five conversations in a day" achievement, so the
   * achievement could be won with yesterday's conversations.
   */
  /**
   * The user's midnight.
   *
   * It was the server's — so "today's chats" on the lobby counted the
   * wrong day for anybody who was not on the server's clock. It also
   * gates the "five conversations in a day" achievement, so the
   * achievement could be won with yesterday's conversations.
   *
   * And it was the user's midnight shifted by the offset of the zone
   * now — so on the day the clocks changed, the first hour of the
   * user's day was counted as the day before.
   */
  const today = zonedDayStart(new Date(), timezone);
  const [todayCount] = await db.select({ c: count() }).from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId), gte(messages.createdAt, today)));
  const [userRow] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return {
    totalPersonas: personaCount?.c || 0,
    totalChats: Number(chatSum?.s) || 0,
    todayChats: todayCount?.c || 0,
    memberSince: userRow?.createdAt || new Date(),
  };
}

/**
 * The three things that are not about how much the user chatted.
 *
 * First letter written, first sentence taken back to the real person,
 * first goodbye. Dates only; nothing that has not happened yet.
 */
export type UserMilestones = {
  firstLetterAt: Date | null;
  firstOutboundSentAt: Date | null;
  firstFarewellAt: Date | null;
};

export async function getUserMilestones(userId: number): Promise<UserMilestones> {
  const empty: UserMilestones = {
    firstLetterAt: null,
    firstOutboundSentAt: null,
    firstFarewellAt: null,
  };
  const db = await getDb();
  if (!db) return empty;
  /**
   * Only the letters.
   *
   * The notes for later live in the same table, and they are not a
   * letter. "Wrote the first letter" would otherwise light up on a
   * todo the user left for themselves.
   */
  const [letterRow, outboundRow, farewellRow] = await Promise.all([
    db.select({ at: min(letters.createdAt) }).from(letters).where(and(
      eq(letters.userId, userId),
      eq(letters.kind, "letter"),
    )).then((rows) => rows[0]),
    db.select({ at: min(outboundLetters.sentAt) }).from(outboundLetters).where(
      eq(outboundLetters.userId, userId),
    ).then((rows) => rows[0]),
    db.select({ at: min(personas.graduatedAt) }).from(personas).where(
      and(isNull(personas.deletedAt), eq(personas.userId, userId)),
    ).then((rows) => rows[0]),
  ]);
  return {
    firstLetterAt: letterRow?.at ?? null,
    firstOutboundSentAt: outboundRow?.at ?? null,
    firstFarewellAt: farewellRow?.at ?? null,
  };
}

export async function getRecentActivity(userId: number, limit = 8) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messages.id,
    personaId: messages.personaId,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
    personaName: personas.name,
    emotionalState: personas.emotionalState,
  })
    .from(messages)
    .innerJoin(personas, and(eq(messages.personaId, personas.id), isNull(personas.deletedAt)))
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map(r => ({
    ...r,
    content: (decryptTextForRead(userId, r.content) || "").slice(0, 80),
  }));
}

export async function getPersonaById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  const row = result[0];
  /**
   * A shared persona reads its identity from the owner's row (C7.2).
   *
   * The member's own row keeps their conversations, mood and settings;
   * everything about *who the persona is* — the name, the avatar, the
   * persona data, the measured style and the records — comes from the
   * owner. The owner changing a rule therefore reaches the member on
   * their next read.
   *
   * The owner's user id is put on the returned row so the generation
   * path can read the owner's records without guessing.
   */
  if (row?.sharedFromPersonaId) {
    const [share] = await db.select({ id: personaShares.id })
      .from(personaShares)
      .where(and(
        eq(personaShares.memberPersonaId, row.id),
        eq(personaShares.memberUserId, userId),
        eq(personaShares.status, "active"),
      ))
      .limit(1);
    if (!share) return decryptRowOf("personas", row) ?? undefined;
    const [ownerRaw] = await db.select().from(personas)
      .where(and(isNull(personas.deletedAt), eq(personas.id, row.sharedFromPersonaId))).limit(1);
    if (!ownerRaw) return decryptRowOf("personas", row) ?? undefined;
    let owner = ownerRaw;
    try {
      owner = decryptRowOf("personas", ownerRaw) ?? ownerRaw;
    } catch (error) {
      /**
       * The owner's content is encrypted and this process does not have
       * the owner's key (C8.5). The member keeps the copy of the
       * identity that was taken when the share was accepted; the live
       * fields cannot be read until the owner signs in on this instance.
       * The copy is decrypted with the member's own key, because it is
       * the member's row.
       */
      if (error instanceof Error && error.name === "EncryptionKeyMissingError") {
        const memberCopy = decryptRowOf("personas", row) ?? row;
        owner = {
          ...ownerRaw,
          personaData: memberCopy.personaData,
          styleProfile: memberCopy.styleProfile,
        };
      } else {
        throw error;
      }
    }
    return {
      ...row,
      name: owner.name,
      avatarUrl: owner.avatarUrl,
      relationshipDesc: owner.relationshipDesc,
      togetherFrom: owner.togetherFrom,
      togetherTo: owner.togetherTo,
      personaData: owner.personaData,
      styleProfile: owner.styleProfile,
      timezone: owner.timezone,
      /**
       * The seal, the taper step and the memorial mode travel with the
       * persona, not with the member's row (C7.2). The member keeps
       * their own switches; these four decide whether the chat is open
       * and in what register it speaks.
       */
      settings: mergeInheritedPersonaState(row.settings, owner.settings),
      sharedFromUserId: owner.userId,
    };
  }
  return decryptRowOf("personas", row) ?? undefined;
}

// ─── Sharing a persona with family (C7.2) ─────────────────────────────────

/** Creates an invitation. The token itself is never stored. */
export async function createPersonaShare(data: InsertPersonaShare): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(personaShares).values(data).returning({ id: personaShares.id });
  return row.id;
}

export async function getPersonaShareByTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(personaShares)
    .where(eq(personaShares.tokenHash, tokenHash)).limit(1);
  return row;
}

export async function getPersonaShareById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(personaShares)
    .where(and(eq(personaShares.id, id), eq(personaShares.ownerUserId, userId)))
    .limit(1);
  return row;
}

export async function listPersonaShares(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaShares)
    .where(and(
      eq(personaShares.personaId, personaId),
      eq(personaShares.ownerUserId, userId),
    ))
    .orderBy(desc(personaShares.createdAt));
}

export async function getActiveShareForMemberPersona(
  memberPersonaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select({ share: personaShares })
    .from(personaShares)
    .innerJoin(personas, and(
      eq(personas.id, personaShares.personaId),
      isNull(personas.deletedAt),
    ))
    .where(and(
      eq(personaShares.memberPersonaId, memberPersonaId),
      eq(personaShares.memberUserId, userId),
      eq(personaShares.status, "active"),
    ))
    .limit(1);
  /**
   * A soft-deleted owner's persona closes the door (C8.11 × C7.2).
   *
   * The share row survives the recycle-bin window so undo can bring the
   * conversation back, but a member must not keep talking to somebody
   * the owner just deleted. Joining the owner's row and requiring
   * `deletedAt IS NULL` gives that for free — and restores it when the
   * owner undoes the deletion.
   */
  return row?.share;
}

/**
 * The settings that apply to a persona right now (C7.2).
 *
 * A shared persona's seal, taper step and memorial mode belong to the
 * owner; the member's row keeps their own switches, conversation and
 * mood. This reads the owner's row when the share is active and layers
 * those four values over the member's settings — the same merge the
 * hydrated persona row carries, for callers that only need the settings
 * (the seal guard runs before a persona row is read).
 */
export async function getPersonaStateSettings(
  personaId: number,
  userId: number,
): Promise<PersonaSettings | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      settings: personas.settings,
      sharedFromPersonaId: personas.sharedFromPersonaId,
    })
    .from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  const row = rows[0];
  if (!row.sharedFromPersonaId) return normalizePersonaSettings(row.settings);
  const [share] = await db
    .select({ id: personaShares.id })
    .from(personaShares)
    .where(and(
      eq(personaShares.memberPersonaId, personaId),
      eq(personaShares.memberUserId, userId),
      eq(personaShares.status, "active"),
    ))
    .limit(1);
  if (!share) return normalizePersonaSettings(row.settings);
  const [owner] = await db
    .select({ settings: personas.settings })
    .from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, row.sharedFromPersonaId)))
    .limit(1);
  return normalizePersonaSettings(
    mergeInheritedPersonaState(row.settings, owner?.settings),
  );
}

/**
 * Whether this user is an active family member of that persona (C7.2).
 *
 * The owner's user id, the persona id and the reader are all checked, so
 * an invitation to somebody else, or one that has been revoked, does not
 * count.
 */
export async function isPersonaSharedWithMember(
  ownerUserId: number,
  ownerPersonaId: number,
  memberUserId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ id: personaShares.id })
    .from(personaShares)
    .innerJoin(personas, and(
      eq(personas.id, personaShares.personaId),
      isNull(personas.deletedAt),
    ))
    .where(and(
      eq(personaShares.ownerUserId, ownerUserId),
      eq(personaShares.personaId, ownerPersonaId),
      eq(personaShares.memberUserId, memberUserId),
      eq(personaShares.status, "active"),
    ))
    .limit(1);
  return Boolean(row);
}

/** The fields the list helpers need to inherit a shared persona's state. */
interface SharedStateRow {
  id: number;
  userId: number;
  sharedFromPersonaId?: number | null;
  settings?: unknown;
}

/**
 * Lay the owner's state over each shared row's settings.
 *
 * Lists (the lobby, reminder candidates) return raw persona rows; a
 * member's row does not carry the seal or memorial mode the owner set.
 * One share query and one owner-settings query for the whole page, so a
 * list with many personas does not turn into one round trip each.
 */
async function withInheritedPersonaState<T extends SharedStateRow>(rows: T[]): Promise<T[]> {
  const shared = rows.filter((row) => row.sharedFromPersonaId);
  if (shared.length === 0) return rows;
  const db = await getDb();
  if (!db) return rows;
  try {
    const shares = await db
      .select({
        memberPersonaId: personaShares.memberPersonaId,
        memberUserId: personaShares.memberUserId,
        ownerPersonaId: personaShares.personaId,
      })
      .from(personaShares)
      .where(and(
        inArray(personaShares.memberPersonaId, shared.map((row) => row.id)),
        eq(personaShares.status, "active"),
      ));
    if (shares.length === 0) return rows;
    const ownerIds = [...new Set(shares.map((share) => share.ownerPersonaId))];
    const owners = await db
      .select({ id: personas.id, settings: personas.settings })
      .from(personas)
      .where(and(isNull(personas.deletedAt), inArray(personas.id, ownerIds)));
    const ownerSettings = new Map(owners.map((owner) => [owner.id, owner.settings]));
    const ownerByMember = new Map(
      shares.map((share) => [`${share.memberPersonaId}:${share.memberUserId}`, share.ownerPersonaId]),
    );
    return rows.map((row) => {
      if (!row.sharedFromPersonaId) return row;
      const ownerPersonaId = ownerByMember.get(`${row.id}:${row.userId}`);
      if (!ownerPersonaId) return row;
      return {
        ...row,
        settings: mergeInheritedPersonaState(row.settings, ownerSettings.get(ownerPersonaId)),
      };
    });
  } catch (error) {
    console.warn("[DB] Could not read the shared persona state:", (error as Error).message);
    return rows;
  }
}

/**
 * Accepts an invitation: one member row for the accepting user.
 *
 * The transaction is what makes the token one-time under concurrency:
 * the share row is only updated while it is still `invited`, and the
 * member persona is created in the same transaction.
 */
export interface AcceptedPersonaShare {
  personaId: number;
  shareId: number;
}

export async function acceptPersonaShare(
  tokenHash: string,
  userId: number,
): Promise<AcceptedPersonaShare | null> {
  const db = await getDb();
  if (!db) return null;
  return withTransaction(async (tx) => {
    const [share] = await tx.select().from(personaShares)
      .where(and(
        eq(personaShares.tokenHash, tokenHash),
        eq(personaShares.status, "invited"),
        gte(personaShares.expiresAt, new Date()),
        ne(personaShares.ownerUserId, userId),
      ))
      .limit(1);
    if (!share || share.ownerUserId === userId) return null;
    const [ownerRaw] = await tx.select().from(personas)
      .where(and(isNull(personas.deletedAt), eq(personas.id, share.personaId))).limit(1);
    if (!ownerRaw) return null;
    /**
     * The identity is copied into the member's own row.
     *
     * An encrypted owner's values are decrypted with the owner's key
     * (if this instance has it) and re-encrypted with the member's, so
     * the member can read their own copy. Without the owner's key the
     * identity fields are left empty rather than written as ciphertext
     * the member can never open; the live read falls back to the same
     * copy, so nothing is shown that is not readable.
     */
    let owner = ownerRaw;
    try {
      owner = decryptRowOf("personas", ownerRaw) ?? ownerRaw;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "EncryptionKeyMissingError") throw error;
      owner = { ...ownerRaw, personaData: null, styleProfile: null };
    }

    const [member] = await tx.insert(personas).values(encryptWriteValues("personas", userId, {
      userId,
      name: owner.name,
      avatarUrl: owner.avatarUrl,
      relationshipDesc: owner.relationshipDesc,
      togetherFrom: owner.togetherFrom,
      togetherTo: owner.togetherTo,
      personaData: owner.personaData,
      styleProfile: owner.styleProfile,
      timezone: owner.timezone,
      analysisStatus: "ready",
      source: "shared",
      sharedFromPersonaId: share.personaId,
      presence: "active",
      settings: {},
    })).returning({ id: personas.id });
    const updated = await tx.update(personaShares)
      .set({
        status: "active",
        memberUserId: userId,
        memberPersonaId: member.id,
        acceptedAt: new Date(),
      })
      .where(and(
        eq(personaShares.id, share.id),
        eq(personaShares.status, "invited"),
      ))
      .returning({ id: personaShares.id });
    if (!updated.length) return null;
    return { personaId: member.id, shareId: share.id };
  });
}

/** Revokes one invitation or active share, by the owner. */
export async function revokePersonaShare(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(personaShares)
    .set({ status: "revoked" })
    .where(and(
      eq(personaShares.id, id),
      eq(personaShares.ownerUserId, userId),
    ))
    .returning({ id: personaShares.id });
  return rows.length > 0;
}

/** The member leaves a shared persona. */
export async function leavePersonaShare(
  memberPersonaId: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(personaShares)
    .set({ status: "revoked" })
    .where(and(
      eq(personaShares.memberPersonaId, memberPersonaId),
      eq(personaShares.memberUserId, userId),
      eq(personaShares.status, "active"),
    ))
    .returning({ id: personaShares.id });
  return rows.length > 0;
}

// ─── What people remember about them (C7.4) ──────────────────────────────

/** How many characters one oral account may hold. */
export const ORAL_ACCOUNT_MAX_CHARS = 20_000;

/**
 * Writes a new oral account.
 *
 * It starts as a draft: `submittedAt` is null, so only the teller reads
 * it. The owner's persona id is passed in by the route — a family
 * member's row is not where the accounts live.
 */
export async function createOralAccount(data: InsertOralAccount): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(oralAccounts)
    .values(encryptWriteValues("oral_accounts", data.userId, { ...data }))
    .returning({ id: oralAccounts.id });
  return row.id;
}

/**
 * Edits one of the caller's own accounts.
 *
 * The write is scoped to the teller and to the persona the account was
 * written for, so nobody edits another person's words — and an id from
 * one persona cannot be used to change an account on another.
 */
export async function updateOralAccount(
  id: number,
  userId: number,
  personaId: number,
  patch: { body?: string; submittedAt?: Date | null },
): Promise<OralAccount | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.update(oralAccounts)
    .set(encryptWriteValues("oral_accounts", userId, patch as Record<string, unknown>))
    .where(and(
      eq(oralAccounts.id, id),
      eq(oralAccounts.userId, userId),
      eq(oralAccounts.personaId, personaId),
    ))
    .returning();
  return decryptRowOf("oral_accounts", rows[0]) ?? null;
}

/**
 * The accounts the caller may read.
 *
 * Two sets meet here: everything the caller told (drafts included), and
 * — only when the caller owns the persona — every account that has been
 * submitted, including the family's. Ownership is checked in SQL against
 * the personas row, so passing somebody else's persona id returns only
 * the caller's own accounts, and usually none.
 */
export async function listOralAccounts(
  personaId: number,
  userId: number,
): Promise<OralAccount[]> {
  const db = await getDb();
  if (!db) return [];
  const ownedPersona = db.select({ id: personas.id }).from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)));
  const rows = await db.select().from(oralAccounts)
    .where(and(
      eq(oralAccounts.personaId, personaId),
      or(
        eq(oralAccounts.userId, userId),
        and(isNotNull(oralAccounts.submittedAt), exists(ownedPersona)),
      ),
    ))
    .orderBy(asc(oralAccounts.createdAt));
  return decryptRows("oral_accounts", rows);
}

/**
 * The submitted accounts of a persona, for the owner's extraction.
 *
 * The personas join is the ownership check: a family member who knows
 * the persona id reads nothing here, because the join needs the row to
 * belong to their user id.
 */
export async function listSubmittedOralAccounts(
  personaId: number,
  userId: number,
): Promise<Array<Pick<OralAccount, "id" | "userId" | "tellerName" | "body" | "submittedAt">>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: oralAccounts.id,
    userId: oralAccounts.userId,
    tellerName: oralAccounts.tellerName,
    body: oralAccounts.body,
    submittedAt: oralAccounts.submittedAt,
  })
    .from(oralAccounts)
    .innerJoin(
      personas,
      and(
        eq(personas.id, oralAccounts.personaId),
        eq(personas.userId, userId),
        isNull(personas.deletedAt),
      ),
    )
    .where(and(
      eq(oralAccounts.personaId, personaId),
      isNotNull(oralAccounts.submittedAt),
    ))
    .orderBy(asc(oralAccounts.id));
  return decryptRows("oral_accounts", rows);
}

/**
 * The memories that came from what people told us.
 *
 * Only these can conflict with each other in the oral panel: a story
 * told by two people is a disagreement about the same `factKey`, while
 * a memory mined from the chat is a different kind of claim.
 */
export async function getOralMemories(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(memories)
    .where(and(
      isNull(memories.deletedAt),
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.source, "oral"),
    ))
    .orderBy(asc(memories.id));
  return decryptRows("memories", rows);
}

/**
 * Adds one to a persona's chat count.
 *
 * The count used to be read at the start of the turn and written back
 * as an absolute number — so two turns that overlapped both read N and
 * both wrote N+1, and one turn was never counted. The count is a gate
 * on the graduation, so a persona could reach the ritual with fewer
 * conversations than it had.
 *
 * The increment is done by the database, so it cannot be lost.
 */
export async function incrementChatCount(id: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .update(personas)
    .set({ chatCount: sql`"chatCount" + 1` })
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .returning({ chatCount: personas.chatCount });
  return rows[0]?.chatCount ?? 0;
}

/**
 * Writes to a persona.
 *
 * It says whether a row was actually written.
 *
 * The write is scoped to the persona *and* to its owner, so a caller
 * who guessed somebody else's persona id wrote nothing — but the
 * function said nothing about it either, and the procedure answered
 * "saved". So a persona that had been deleted in another tab, or a
 * stale id in the URL, produced a green toast and an unchanged
 * field.
 */
export async function updatePersona(
  id: number,
  userId: number,
  data: Partial<InsertPersona>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const patch: Partial<InsertPersona> = { ...data };
  if (patch.emotionalState !== undefined && patch.emotionalStateSince === undefined) {
    const current = await getPersonaById(id, userId);
    if (current && current.emotionalState !== patch.emotionalState) {
      patch.emotionalStateSince = new Date();
    }
  }
  const rows = await db
    .update(personas)
    .set(encryptWriteValues("personas", userId, patch as Record<string, unknown>))
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  if (rows.length > 0 && patch.presence === "asleep") {
    await cancelPendingReplyJobs(id, userId);
  }
  return rows.length > 0;
}

/**
 * Deletes a persona and everything that hangs off it, for good, in one
 * transaction (C8.11).
 *
 * This is the old `deletePersona`: the thirty-day purge calls it, and so
 * does the recycle bin's "delete now". The "delete" button on the lobby
 * is `softDeletePersona`; this is what runs after the bin has had its
 * thirty days.
 *
 * Ownership is checked *before* anything is deleted. The row deletes are
 * scoped to the persona's owner as well as the persona itself, so a caller
 * who guessed another user's persona id cannot wipe their history — and
 * cannot even delete the rows that belong to it.
 *
 * Covers every table with a `personaId` — the same completeness rule as
 * `deleteUserAccount`, and checked by `server/db-delete-coverage.test.ts`.
 * It also clears the rows the soft delete left behind, so a persona that
 * was purged from the bin leaves nothing in any table.
 */
export async function purgePersona(id: number, userId: number) {
  // soft-delete: include-deleted — the purge path has to find a persona
  // that is already in the bin.
  // The ownership check comes first: without it, a caller who passed
  // somebody else's persona id would still delete that persona's messages
  // and memories.
  const owned = await getPersonaByIdIncludingDeleted(id, userId);
  if (!owned) throw new Error("Persona not found");

  /**
   * The files on disk.
   *
   * The rows are deleted and the bytes are not: so the uploaded
   * photographs and the extracted chat logs stayed in the uploads
   * directory after the persona was gone.
   */
  const storedFiles = await collectStoredFiles(userId, id);

  await withTransaction(async (tx) => {
    await tx.delete(channelBindings).where(and(eq(channelBindings.personaId, id), eq(channelBindings.userId, userId)));
    await tx.delete(channelDefaultPersonas).where(and(eq(channelDefaultPersonas.personaId, id), eq(channelDefaultPersonas.userId, userId)));
    await tx.delete(chatSummaries).where(and(eq(chatSummaries.personaId, id), eq(chatSummaries.userId, userId)));
    await tx.delete(collectedMessages).where(and(eq(collectedMessages.personaId, id), eq(collectedMessages.userId, userId)));
    await tx.delete(recordEmbeddings).where(and(eq(recordEmbeddings.personaId, id), eq(recordEmbeddings.userId, userId)));
    await tx.delete(recordMarks).where(and(eq(recordMarks.personaId, id), eq(recordMarks.userId, userId)));
    await tx.delete(recordReports).where(and(eq(recordReports.personaId, id), eq(recordReports.userId, userId)));
    await tx.delete(collectionJobs).where(and(eq(collectionJobs.personaId, id), eq(collectionJobs.userId, userId)));
    await tx.delete(diaryEntries).where(and(eq(diaryEntries.personaId, id), eq(diaryEntries.userId, userId)));
    await tx.delete(distillationCards).where(and(eq(distillationCards.personaId, id), eq(distillationCards.userId, userId)));
    await tx.delete(distillationChunks).where(and(eq(distillationChunks.personaId, id), eq(distillationChunks.userId, userId)));
    await tx.delete(emotionSnapshots).where(and(eq(emotionSnapshots.personaId, id), eq(emotionSnapshots.userId, userId)));
    await tx.delete(evalCases).where(and(eq(evalCases.personaId, id), eq(evalCases.userId, userId)));
    await tx.delete(evalRuns).where(and(eq(evalRuns.personaId, id), eq(evalRuns.userId, userId)));
    await tx.delete(blindSessions).where(and(eq(blindSessions.personaId, id), eq(blindSessions.userId, userId)));
    await tx.delete(fidelityPairs).where(and(eq(fidelityPairs.personaId, id), eq(fidelityPairs.userId, userId)));
    await tx.delete(fidelityFeedback).where(and(eq(fidelityFeedback.personaId, id), eq(fidelityFeedback.userId, userId)));
    await tx.delete(graduationAssessments).where(and(eq(graduationAssessments.personaId, id), eq(graduationAssessments.userId, userId)));
    /**
     * The usage rows for this persona go with it (C8.9).
     *
     * The ledger is the user's; a row names the persona it was spent
     * on. Once that persona is gone the row has nothing left to say.
     */
    await tx.delete(llmUsage).where(and(eq(llmUsage.personaId, id), eq(llmUsage.userId, userId)));
    await tx.delete(messageMarks).where(and(eq(messageMarks.personaId, id), eq(messageMarks.userId, userId)));
    await tx.delete(memories).where(and(eq(memories.personaId, id), eq(memories.userId, userId)));
    /**
     * Every account of the persona, whoever told it.
     *
     * The rows of a shared persona's family accounts belong to *their*
     * user ids, not the owner's — so the ordinary (persona, user) pair
     * would leave them behind, and the words a person told about
     * somebody would outlive the persona itself.
     */
    await tx.delete(oralAccounts).where(and(
      eq(oralAccounts.personaId, id),
      exists(
        tx.select({ id: personas.id }).from(personas)
          .where(and(eq(personas.id, id), eq(personas.userId, userId))),
      ),
    ));
    await tx.delete(memoryExtractions).where(and(eq(memoryExtractions.personaId, id), eq(memoryExtractions.userId, userId)));
    await tx.delete(memoryMedia).where(and(eq(memoryMedia.personaId, id), eq(memoryMedia.userId, userId)));
    await tx.delete(messages).where(and(eq(messages.personaId, id), eq(messages.userId, userId)));
    await tx.delete(outboundLetters).where(and(eq(outboundLetters.personaId, id), eq(outboundLetters.userId, userId)));
    await tx.delete(rehearsals).where(and(eq(rehearsals.personaId, id), eq(rehearsals.userId, userId)));
    await tx.delete(sessionCheckins).where(and(eq(sessionCheckins.personaId, id), eq(sessionCheckins.userId, userId)));
    await tx.delete(sessionCheckinPrompts).where(and(eq(sessionCheckinPrompts.personaId, id), eq(sessionCheckinPrompts.userId, userId)));
    await tx.delete(userJournal).where(and(eq(userJournal.personaId, id), eq(userJournal.userId, userId)));
    await tx.delete(roleplaySessions).where(and(eq(roleplaySessions.personaId, id), eq(roleplaySessions.userId, userId)));
    await tx.delete(scheduledItems).where(and(eq(scheduledItems.personaId, id), eq(scheduledItems.userId, userId)));
    await tx.delete(personaFiles).where(and(eq(personaFiles.personaId, id), eq(personaFiles.userId, userId)));
    await tx.delete(personaQuestionnaireAnswers).where(and(eq(personaQuestionnaireAnswers.personaId, id), eq(personaQuestionnaireAnswers.userId, userId)));
    await tx.delete(personaVersions).where(and(eq(personaVersions.personaId, id), eq(personaVersions.userId, userId)));
    await tx.delete(relationshipEvents).where(and(eq(relationshipEvents.personaId, id), eq(relationshipEvents.userId, userId)));
    await tx.delete(reminderDeliveries).where(and(eq(reminderDeliveries.personaId, id), eq(reminderDeliveries.userId, userId)));
    await tx.delete(researchProfiles).where(and(eq(researchProfiles.personaId, id), eq(researchProfiles.userId, userId)));
    await tx.delete(safetyEvents).where(and(eq(safetyEvents.personaId, id), eq(safetyEvents.userId, userId)));
    await tx.delete(skillJobs).where(and(eq(skillJobs.personaId, id), eq(skillJobs.userId, userId)));
    await tx.delete(letters).where(and(eq(letters.personaId, id), eq(letters.userId, userId)));
    await tx.delete(replyJobs).where(and(eq(replyJobs.personaId, id), eq(replyJobs.userId, userId)));
    await tx.delete(stickers).where(and(eq(stickers.personaId, id), eq(stickers.userId, userId)));
    await tx.delete(media).where(and(eq(media.personaId, id), eq(media.userId, userId)));
    await tx.delete(wechatBindings).where(and(eq(wechatBindings.personaId, id), eq(wechatBindings.userId, userId)));
    /**
     * Sharing rows go with either side (C7.2).
     *
     * Deleting the owner's persona revokes every share of it; deleting
     * a member's row forgets the share that created it. The other
     * side's row stays — the member keeps their conversations, and a
     * member row whose share is gone simply cannot chat.
     */
    await tx.delete(personaShares).where(or(
      and(eq(personaShares.ownerUserId, userId), eq(personaShares.personaId, id)),
      and(eq(personaShares.memberUserId, userId), eq(personaShares.memberPersonaId, id)),
    ));
    await tx.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
  });

  await removeStoredFiles(storedFiles);
}

// ─── Undo and the recycle bin (C8.11) ───────────────────────────────────────

/** How long a deleted persona stays in the recycle bin, in days. */
export const SOFT_DELETE_RETENTION_DAYS = 30;

/** The same stretch, in milliseconds. */
const SOFT_DELETE_RETENTION_MS = SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * One persona row, deleted or not.
 *
 * A purge or a restore has to find a persona that is in the bin, so it
 * cannot go through `getPersonaById` — that one, like every ordinary
 * read, leaves a deleted row out. Soft-delete whitelist: purge/restore.
 */
export async function getPersonaByIdIncludingDeleted(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  // soft-delete: include-deleted — the purge and restore paths must find
  // a persona that is already in the bin.
  const result = await db.select().from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .limit(1);
  return decryptRowOf("personas", result[0]) ?? undefined;
}

/**
 * Puts a persona in the recycle bin (C8.11).
 *
 * Its conversations and memories are marked with the same moment, so the
 * undo takes back exactly what this deletion took — a message the user
 * had deleted earlier stays in the bin. Nothing is removed from the
 * disk: the files stay until the purge, which is what makes the undo
 * possible at all.
 *
 * The moment is a parameter so the thirty-day sweep can be tested
 * without waiting thirty days.
 */
export async function softDeletePersona(
  id: number,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return withTransaction(async (tx) => {
    const [persona] = await tx
      .select({ id: personas.id })
      .from(personas)
      .where(and(
        eq(personas.id, id),
        eq(personas.userId, userId),
        isNull(personas.deletedAt),
      ))
      .limit(1);
    if (!persona) return false;
    await tx.update(personas)
      .set({ deletedAt: now })
      .where(and(eq(personas.id, id), eq(personas.userId, userId)));
    await tx.update(messages)
      .set({ deletedAt: now })
      .where(and(
        eq(messages.personaId, id),
        eq(messages.userId, userId),
        isNull(messages.deletedAt),
      ));
    await tx.update(memories)
      .set({ deletedAt: now })
      .where(and(
        eq(memories.personaId, id),
        eq(memories.userId, userId),
        isNull(memories.deletedAt),
      ));
    return true;
  });
}

/**
 * Takes a persona back out of the recycle bin (C8.11).
 *
 * Only the rows marked by the deletion being undone come back: a message
 * deleted before the persona stays deleted.
 */
export async function restorePersona(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return withTransaction(async (tx) => {
    // soft-delete: include-deleted — the row being restored is the deleted one.
    const [row] = await tx
      .select({ deletedAt: personas.deletedAt })
      .from(personas)
      .where(and(
        eq(personas.id, id),
        eq(personas.userId, userId),
        isNotNull(personas.deletedAt),
      ))
      .limit(1);
    const at = row?.deletedAt;
    if (!at) return false;
    await tx.update(personas)
      .set({ deletedAt: null })
      .where(and(eq(personas.id, id), eq(personas.userId, userId)));
    await tx.update(messages)
      .set({ deletedAt: null })
      .where(and(
        eq(messages.personaId, id),
        eq(messages.userId, userId),
        eq(messages.deletedAt, at),
      ));
    await tx.update(memories)
      .set({ deletedAt: null })
      .where(and(
        eq(memories.personaId, id),
        eq(memories.userId, userId),
        eq(memories.deletedAt, at),
      ));
    return true;
  });
}

/**
 * The personas in the user's recycle bin, newest first (C8.11).
 *
 * One of the two ordinary reads that are allowed to see deleted rows:
 * listing them is the point.
 */
export async function listDeletedPersonas(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // soft-delete: include-deleted — the recycle bin lists exactly those rows.
  return db.select({
    id: personas.id,
    name: personas.name,
    avatarUrl: personas.avatarUrl,
    relationshipDesc: personas.relationshipDesc,
    chatCount: personas.chatCount,
    deletedAt: personas.deletedAt,
    createdAt: personas.createdAt,
  })
    .from(personas)
    .where(and(eq(personas.userId, userId), isNotNull(personas.deletedAt)))
    .orderBy(desc(personas.deletedAt));
}

/**
 * Hard-deletes the personas whose thirty days are up (C8.11).
 *
 * Called by the scheduler once a day with the current moment, so the age
 * is a parameter and not the clock. A persona deleted exactly thirty days
 * ago is not yet expired; one deleted a millisecond earlier is. The files
 * go with it, through `purgePersona`.
 */
export async function purgeExpiredPersonas(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  // soft-delete: include-deleted — the purge task is the other read that
  // is allowed to see deleted rows.
  const expired = await db.select({ id: personas.id, userId: personas.userId })
    .from(personas)
    .where(and(isNotNull(personas.deletedAt), lt(personas.deletedAt, cutoff)))
    .orderBy(asc(personas.deletedAt))
    .limit(200);
  let purged = 0;
  for (const row of expired) {
    try {
      await purgePersona(row.id, row.userId);
      purged += 1;
    } catch (error) {
      console.warn("[db] A persona in the bin could not be purged:", error);
    }
  }
  return purged;
}

// ─── PersonaFile helpers ────────────────────────────────────────────────────

export async function createPersonaFile(data: InsertPersonaFile) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaFiles).values(data).returning({ id: personaFiles.id });
  return result.id;
}

/**
 * The newest uploaded files, with only what the retrieval needs.
 *
 * The full-text column of an uploaded chat log is megabytes long, and
 * the hot path pulled all of it — for every file of the persona, on
 * every chat turn — of which two summaries of four hundred characters
 * were used.
 */
export async function getFileSummariesByPersonaId(
  personaId: number,
  userId: number,
  limit = 20,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
    extractedMemory: personaFiles.extractedMemory,
    createdAt: personaFiles.createdAt,
  })
    .from(personaFiles)
    .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
    .orderBy(desc(personaFiles.createdAt))
    .limit(limit);
}

/**
 * The photos of a persona, and the date each of them was taken.
 *
 * The sweep runs once a minute, and it used to read every uploaded file
 * in full — the extracted text is up to half a megabyte each — only to
 * look for a date. So the whole table was read every minute, for ever,
 * and the answer was thrown away.
 *
 * The date is now found by the database, and only the columns that are
 * used come back.
 */
export async function getPhotoReminderCandidates(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
    createdAt: personaFiles.createdAt,
    // The first date in the extracted text, if there is one.
    dateHint: sql<string | null>`substring(${personaFiles.extractedMemory} from '[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}-[0-9]{2}')`,
  })
    .from(personaFiles)
    .where(and(
      eq(personaFiles.personaId, personaId),
      eq(personaFiles.userId, userId),
      eq(personaFiles.fileType, "image"),
    ))
    .orderBy(desc(personaFiles.createdAt));
}

/**
 * The titles of the files whose summaries were recalled.
 *
 * A file summary carries a negative id — it lives in another table, and
 * the negative id is what keeps the two apart. So the memories table
 * has no row for it, and the title was empty.
 */
export async function getFileSummaryTitles(ids: number[], userId: number) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, string>();
  const unique = Array.from(new Set(ids));
  const rows = await db.select({
    id: personaFiles.id,
    originalName: personaFiles.originalName,
  })
    .from(personaFiles)
    .where(and(inArray(personaFiles.id, unique), eq(personaFiles.userId, userId)));
  return new Map(rows.map((r) => [r.id, r.originalName]));
}

/**
 * Whether a message of this user's points at a given file.
 *
 * The files written before the TTS output was scoped per user have no
 * owner in their path, so the path cannot say whose they are. Their
 * names are the hash of the text they were made from, so two people
 * who asked for the same words share one file — and every signed-in
 * user could fetch it.
 *
 * So the file is served to the people whose own conversation points at
 * it, and to nobody else.
 */
export async function userHasMessageWithMediaUrl(
  userId: number,
  mediaUrl: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: messages.id })
    .from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId), eq(messages.mediaUrl, mediaUrl)))
    .limit(1);
  return rows.length > 0;
}

/**
 * One file, by its id.
 *
 * Scoped by the owner, so a file id that was guessed reaches nothing.
 */
export async function getPersonaFileById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(personaFiles)
    .where(and(eq(personaFiles.id, id), eq(personaFiles.userId, userId)))
    .limit(1);
  return rows[0];
}

/**
 * A file, as the list of the files of a persona returns it.
 */
export type PersonaFileRow = Omit<
  typeof personaFiles.$inferSelect,
  "extractedMemory"
> & { extractedMemory?: string | null };

/**
 * The files of a persona, newest first.
 *
 * The extracted text is not part of the answer unless it is asked for.
 * It is up to half a million characters per file, and the list of the
 * files is shown on a page that never reads it — so every visit pulled
 * megabytes of chat-log text to the browser and threw it away.
 */
export async function getFilesByPersonaId(
  personaId: number,
  userId: number,
  options: { withExtractedMemory?: boolean } = {},
): Promise<Array<PersonaFileRow>> {
  const db = await getDb();
  if (!db) return [];
  const columns = {
    id: personaFiles.id,
    personaId: personaFiles.personaId,
    userId: personaFiles.userId,
    fileType: personaFiles.fileType,
    originalName: personaFiles.originalName,
    fileKey: personaFiles.fileKey,
    fileUrl: personaFiles.fileUrl,
    fileSize: personaFiles.fileSize,
    processStatus: personaFiles.processStatus,
    parseStatus: personaFiles.parseStatus,
    parseReport: personaFiles.parseReport,
    createdAt: personaFiles.createdAt,
  };
  /**
   * The extracted text is read only when it is asked for.
   *
   * The column is left out of the select otherwise — so the text is
   * never brought back from the database at all, rather than being
   * brought back and thrown away.
   */
  const rows = options.withExtractedMemory
    ? await db.select({ ...columns, extractedMemory: personaFiles.extractedMemory })
        .from(personaFiles)
        .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
        .orderBy(desc(personaFiles.createdAt))
    : await db.select(columns)
        .from(personaFiles)
        .where(and(eq(personaFiles.personaId, personaId), eq(personaFiles.userId, userId)))
        .orderBy(desc(personaFiles.createdAt));
  return rows;
}

// ─── Message helpers ────────────────────────────────────────────────────────

export async function createMessage(data: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db
    .insert(messages)
    .values({
      ...encryptWriteValues("messages", data.userId, { ...data }),
      searchTokens: searchTokensValueFor(data.userId, data.content),
    })
    .returning({ id: messages.id });
  return result.id;
}

export async function createFidelityFeedback(data: InsertFidelityFeedback) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(fidelityFeedback).values(data).returning();
  return result;
}

export async function listFidelityFeedbackForMessage(
  messageId: number,
  userId: number,
  personaId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fidelityFeedback)
    .where(
      and(
        eq(fidelityFeedback.messageId, messageId),
        eq(fidelityFeedback.userId, userId),
        eq(fidelityFeedback.personaId, personaId),
      ),
    )
    .orderBy(desc(fidelityFeedback.createdAt));
}

export async function listFidelityFeedbackForPersona(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fidelityFeedback)
    .where(and(eq(fidelityFeedback.personaId, personaId), eq(fidelityFeedback.userId, userId)))
    .orderBy(desc(fidelityFeedback.createdAt));
}

/**
 * An unlike mark that already has a rewrite, joined to the line that
 * was marked. Named so the isolation scan does not treat a return-type
 * brace as the start of the function body.
 */
export interface FidelityRewritePair {
  id: number;
  messageId: number;
  reason: string;
  rewrite: string;
  unlike: string;
  createdAt: Date;
}

/**
 * The most recent unlike marks that have a rewrite, for this persona
 * and this user. Used in the prompt, in evaluation, and in the export.
 */
export async function listFidelityRewritePairs(
  personaId: number,
  userId: number,
  limit = 3,
): Promise<FidelityRewritePair[]> {
  const db = await getDb();
  if (!db) return [];
  const cap = Math.max(1, Math.min(1000, limit));
  const rows = await db
    .select({
      id: fidelityFeedback.id,
      messageId: fidelityFeedback.messageId,
      reason: fidelityFeedback.reason,
      rewrite: fidelityFeedback.rewrite,
      unlike: messages.content,
      createdAt: fidelityFeedback.createdAt,
    })
    .from(fidelityFeedback)
    .innerJoin(messages, and(eq(messages.id, fidelityFeedback.messageId), isNull(messages.deletedAt)))
    .where(
      and(
        eq(fidelityFeedback.personaId, personaId),
        eq(fidelityFeedback.userId, userId),
        eq(messages.userId, userId),
        eq(messages.personaId, personaId),
        isNotNull(fidelityFeedback.rewrite),
        sql`btrim(${fidelityFeedback.rewrite}) <> ''`,
      ),
    )
    .orderBy(desc(fidelityFeedback.createdAt))
    .limit(cap);
  return rows
    .map((row) => ({ ...row, unlike: decryptTextForRead(userId, row.unlike) ?? "" }))
    .filter((row): row is FidelityRewritePair => typeof row.rewrite === "string" && row.rewrite.trim().length > 0);
}

/**
 * Fills in a rewrite on a mark the caller owns. Somebody else's row
 * is a miss, not an update of the wrong person.
 */
export async function setFidelityFeedbackRewrite(
  id: number,
  userId: number,
  rewrite: string,
): Promise<FidelityFeedback | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .update(fidelityFeedback)
    .set({ rewrite })
    .where(and(eq(fidelityFeedback.id, id), eq(fidelityFeedback.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function createFidelityPair(data: InsertFidelityPair) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(fidelityPairs).values(data).returning();
  return result;
}

export async function listFidelityPairs(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fidelityPairs)
    .where(and(eq(fidelityPairs.personaId, personaId), eq(fidelityPairs.userId, userId)))
    .orderBy(asc(fidelityPairs.createdAt));
}

export async function countFidelityPairs(personaId: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(fidelityPairs)
    .where(and(eq(fidelityPairs.personaId, personaId), eq(fidelityPairs.userId, userId)));
  return Number(row?.n ?? 0);
}

/**
 * The keys of the OpenAI-compatible endpoint (C9.2).
 *
 * The key itself is never stored: only its sha256 hash and the first
 * characters, which is enough for the list and useless to an attacker who
 * reads the database.
 */
export async function createApiKey(data: InsertApiKey): Promise<ApiKey> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(apiKeys).values(data).returning();
  if (!row) throw new Error("DB not available");
  return row;
}

/** This account's keys, newest first. Revoked ones are included. */
export async function listApiKeys(userId: number): Promise<ApiKey[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

/** Revokes one of this account's keys. A second call is a no-op. */
export async function revokeApiKey(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(apiKeys.id, id),
      eq(apiKeys.userId, userId),
      isNull(apiKeys.revokedAt),
    ))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

/**
 * The account behind a presented key, or null.
 *
 * The lookup is by hash, before anybody is known: a key *is* the
 * credential, so there is no user id to filter by yet. A revoked key is
 * not a key.
 */
export async function findActiveApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row ?? null;
}

/** Records that a key was used, so the list can show when. */
export async function touchApiKeyLastUsed(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

export async function listPushSubscriptions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(asc(pushSubscriptions.createdAt));
}

/**
 * One browser, one row.
 *
 * The endpoint is unique. Subscribing again — the same browser, or a
 * different account on that browser — updates the keys instead of
 * inserting a second row.
 */
export async function upsertPushSubscription(
  userId: number,
  input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      },
    })
    .returning();
  return row;
}

export async function deletePushSubscription(userId: number, endpoint: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function setPushSubscriptionPreview(
  userId: number,
  endpoint: string,
  showPreview: boolean,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(pushSubscriptions)
    .set({ showPreview })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function markPushSuccess(userId: number, endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date(), failCount: 0 })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function markPushFailure(userId: number, endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(pushSubscriptions)
    .set({ failCount: sql`${pushSubscriptions.failCount} + 1` })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/**
 * How long a reply-job claim is allowed to sit.
 *
 * The handbook asked for five minutes, the same wording it used for
 * letters. Letters moved to fifteen after five minutes went stale
 * while a model call was still running. A reply job makes the same
 * call, so it uses the same window.
 */
export const REPLY_JOB_CLAIM_STALE_MS = 15 * 60_000;

function isPgUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "23505";
}

export async function createReplyJob(data: InsertReplyJob): Promise<ReplyJob> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    const [row] = await db.insert(replyJobs).values(data).returning();
    if (!row) throw new Error("DB not available");
    return row;
  } catch (error) {
    if (!isPgUniqueViolation(error)) throw error;
    const existing = await getPendingReplyJob(data.personaId, data.userId, data.kind);
    if (existing) return existing;
    throw error;
  }
}

export async function getReplyJobById(id: number, userId: number): Promise<ReplyJob | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(replyJobs)
    .where(and(eq(replyJobs.id, id), eq(replyJobs.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getPendingReplyJob(
  personaId: number,
  userId: number,
  kind = "reply",
): Promise<ReplyJob | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(replyJobs)
    .where(and(
      eq(replyJobs.personaId, personaId),
      eq(replyJobs.userId, userId),
      eq(replyJobs.kind, kind),
      inArray(replyJobs.status, ["pending", "running"]),
    ))
    .orderBy(asc(replyJobs.dueAt))
    .limit(1);
  return row ?? null;
}

/**
 * How many reply jobs are waiting for one user, and how many are late
 * (C8.12, B5.2).
 *
 * A queue that is merely waiting is not a problem — the jobs are due at a
 * time the persona chose. A queue with jobs past their due time is one the
 * scheduler has stopped working through, and that is worth saying.
 */
export interface PendingReplyJobCount {
  pending: number;
  overdue: number;
}

export async function countPendingReplyJobs(
  userId: number,
  now: Date,
): Promise<PendingReplyJobCount> {
  const db = await getDb();
  if (!db) return { pending: 0, overdue: 0 };
  const [row] = await db
    .select({
      pending: count(),
      overdue: sql<string>`coalesce(sum(case when ${replyJobs.dueAt} <= ${now} then 1 else 0 end), 0)`,
    })
    .from(replyJobs)
    .where(and(
      eq(replyJobs.userId, userId),
      inArray(replyJobs.status, ["pending", "running"]),
    ));
  return {
    pending: Number(row?.pending ?? 0),
    overdue: Number(row?.overdue ?? 0),
  };
}

export async function listDueReplyJobs(now: Date, limit = 20): Promise<ReplyJob[]> {
  const db = await getDb();
  if (!db) return [];
  const staleBefore = new Date(now.getTime() - REPLY_JOB_CLAIM_STALE_MS);
  return db
    .select()
    .from(replyJobs)
    .where(and(
      lte(replyJobs.dueAt, now),
      or(
        and(
          eq(replyJobs.status, "pending"),
          or(
            isNull(replyJobs.claimedAt),
            lt(replyJobs.claimedAt, staleBefore),
          ),
        ),
        and(
          eq(replyJobs.status, "running"),
          lt(replyJobs.claimedAt, staleBefore),
        ),
      ),
    ))
    .orderBy(asc(replyJobs.dueAt))
    .limit(limit);
}

export async function claimReplyJob(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const staleBefore = new Date(Date.now() - REPLY_JOB_CLAIM_STALE_MS);
  const [row] = await db
    .update(replyJobs)
    .set({ status: "running", claimedAt: new Date() })
    .where(and(
      eq(replyJobs.id, id),
      eq(replyJobs.userId, userId),
      or(
        and(
          eq(replyJobs.status, "pending"),
          or(
            isNull(replyJobs.claimedAt),
            lt(replyJobs.claimedAt, staleBefore),
          ),
        ),
        and(
          eq(replyJobs.status, "running"),
          lt(replyJobs.claimedAt, staleBefore),
        ),
      ),
    ))
    .returning({ id: replyJobs.id });
  return Boolean(row);
}

export async function finishReplyJob(
  id: number,
  userId: number,
  status: "done" | "failed" | "cancelled",
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(replyJobs)
    .set({ status, finishedAt: new Date(), claimedAt: null })
    .where(and(eq(replyJobs.id, id), eq(replyJobs.userId, userId)))
    .returning({ id: replyJobs.id });
  return rows.length > 0;
}

export async function retryReplyJob(
  id: number,
  userId: number,
  dueAt: Date,
  attempts: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(replyJobs)
    .set({
      status: "pending",
      dueAt,
      attempts,
      claimedAt: null,
    })
    .where(and(eq(replyJobs.id, id), eq(replyJobs.userId, userId)))
    .returning({ id: replyJobs.id });
  return rows.length > 0;
}

export async function cancelPendingReplyJobs(personaId: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .update(replyJobs)
    .set({ status: "cancelled", finishedAt: new Date(), claimedAt: null })
    .where(and(
      eq(replyJobs.personaId, personaId),
      eq(replyJobs.userId, userId),
      inArray(replyJobs.status, ["pending", "running"]),
    ))
    .returning({ id: replyJobs.id });
  return rows.length;
}

export async function upsertRecordEmbedding(data: InsertRecordEmbedding) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(recordEmbeddings)
    .values(data)
    .onConflictDoUpdate({
      target: [recordEmbeddings.personaId, recordEmbeddings.recordId, recordEmbeddings.model],
      set: { vec: data.vec, dim: data.dim, userId: data.userId },
      setWhere: eq(recordEmbeddings.userId, data.userId),
    });
}

export type RecordEmbeddingRow = { recordId: number; dim: number; vec: Buffer };

export async function listRecordEmbeddings(
  personaId: number,
  userId: number,
  model: string,
  options: { limit?: number } = {},
): Promise<RecordEmbeddingRow[]> {
  const db = await getDb();
  if (!db) return [];
  /**
   * The most recent turns first.
   *
   * Record ids grow with the import, so ordering by id selects the
   * newest turns without a join to the record table. C8.6's semantic
   * search keeps only the most recent 60 thousand.
   */
  const query = db
    .select({
      recordId: recordEmbeddings.recordId,
      dim: recordEmbeddings.dim,
      vec: recordEmbeddings.vec,
    })
    .from(recordEmbeddings)
    .where(
      and(
        eq(recordEmbeddings.personaId, personaId),
        eq(recordEmbeddings.userId, userId),
        eq(recordEmbeddings.model, model),
      ),
    )
    .orderBy(desc(recordEmbeddings.recordId));
  if (options.limit != null) return query.limit(Math.max(1, options.limit));
  return query;
}

export async function listEmbeddedRecordIds(
  personaId: number,
  userId: number,
  model: string,
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ recordId: recordEmbeddings.recordId })
    .from(recordEmbeddings)
    .where(
      and(
        eq(recordEmbeddings.personaId, personaId),
        eq(recordEmbeddings.userId, userId),
        eq(recordEmbeddings.model, model),
      ),
    );
  return rows.map((row) => row.recordId);
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * Merges keys into a message's metadata.
 *
 * The A/B pair (B8.8) is stored on the user's own message until they
 * pick a line — there is no assistant row yet, so this is the only
 * place the two unreplied lines can sit.
 */
/** Replaces the words of one stored message, limited to its owner. */
export async function setMessageContent(
  id: number,
  userId: number,
  content: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(messages)
    .set({
      content: encryptTextForWrite(userId, content)!,
      searchTokens: searchTokensValueFor(userId, content),
    })
    .where(and(eq(messages.id, id), eq(messages.userId, userId)))
    .returning({ id: messages.id });
  return rows.length > 0;
}

export async function updateMessageMetadata(
  id: number,
  userId: number,
  personaId: number,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = await getMessageById(id, userId, personaId);
  if (!row) return false;
  const updated = await db.update(messages)
    .set({ metadata: { ...metadataObject(row.metadata), ...patch } })
    .where(and(
      eq(messages.id, id),
      eq(messages.userId, userId),
      eq(messages.personaId, personaId),
    ))
    .returning({ id: messages.id });
  return updated.length > 0;
}

/**
 * Drops the pending A/B pair off a user message after a line is stored.
 */
export async function clearMessagePendingChoice(
  id: number,
  userId: number,
  personaId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = await getMessageById(id, userId, personaId);
  if (!row) return false;
  const next = metadataObject(row.metadata);
  delete next.pendingChoice;
  const updated = await db.update(messages)
    .set({ metadata: next })
    .where(and(
      eq(messages.id, id),
      eq(messages.userId, userId),
      eq(messages.personaId, personaId),
    ))
    .returning({ id: messages.id });
  return updated.length > 0;
}

/**
 * Records which channel a message went out on.
 *
 * The message is stored before it is sent, so that a failure to store
 * it cannot leave the user with a message that was sent but never
 * counted — and the clock that stops the persona from speaking again
 * starts with the same write.
 */
export async function updateMessageChannel(
  id: number,
  userId: number,
  channel: "web" | "wechat" | "feishu" | "api" | "telegram" | "discord" | "matrix",
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(messages)
    .set({ channel })
    .where(and(eq(messages.id, id), eq(messages.userId, userId)));
}

export async function getMessagesByPersonaId(personaId: number, userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return decryptRows("messages", rows).reverse();
}

/**
 * The whole conversation, in pages.
 *
 * A page at a time, because the whole conversation of a persona who has
 * talked for a year is tens of thousands of rows. The ceiling is
 * there so that one very long conversation cannot exhaust the memory
 * of the process.
 */
export async function getMessagesByPersonaIdPaged(
  personaId: number,
  userId: number,
  options: { pageSize?: number; max?: number } = {},
): Promise<typeof messages.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 500));
  const max = Math.max(pageSize, Math.min(20_000, options.max ?? 5000));
  const collected: (typeof messages.$inferSelect)[] = [];
  let before: { createdAt: Date; id: number } | undefined;
  /**
   * The cursor: the time *and* the id of the last row of the page.
   *
   * The time alone was the cursor — so two messages written in the same
   * millisecond (the reply and the letter that went with it, a batch
   * written by the collector) were on both sides of the boundary, and
   * the ones that fell on the wrong side of it were **never read**:
   * the page ended at the first of them and the next page started
   * after the last of them.
   *
   * The id is the tie-breaker: it never repeats, and it says which of
   * two messages with the same time comes first.
   */
  while (collected.length < max) {
    const rows = await db.select().from(messages)
      .where(and(
        isNull(messages.deletedAt),
        eq(messages.personaId, personaId),
        eq(messages.userId, userId),
        ...(before
          ? [
              or(
                lt(messages.createdAt, before.createdAt),
                and(
                  eq(messages.createdAt, before.createdAt),
                  lt(messages.id, before.id),
                ),
              ),
            ]
          : []),
      ))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(Math.min(pageSize, max - collected.length));
    if (rows.length === 0) break;
    collected.push(...decryptRows("messages", rows));
    const last = rows[rows.length - 1];
    before = { createdAt: last.createdAt, id: last.id };
    if (rows.length < pageSize) break;
  }
  return collected.reverse();
}

/**
 * A single message, if it belongs to the user.
 */
/**
 * One message, by its id.
 *
 * The persona may be named, and then the message has to be in that
 * conversation: a reply that quotes a message of another persona of
 * the same user quotes the wrong conversation.
 */
export async function getMessageById(
  messageId: number,
  userId: number,
  personaId?: number,
) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .limit(1);
  return decryptRowOf("messages", rows[0]) ?? null;
}

/**
 * The messages before a given one, oldest first.
 *
 * The chat page used to load the last fifty messages and stop there, so
 * a long conversation simply had no beginning. Everything was in the
 * database; there was no way to reach it.
 */
export async function getMessagesBefore(
  personaId: number,
  userId: number,
  beforeId: number,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      lt(messages.id, beforeId),
    ))
    .orderBy(desc(messages.id)).limit(limit);
  return decryptRows("messages", rows).reverse();
}

/** Whether there are older messages to load. */
export async function hasOlderMessages(
  personaId: number,
  userId: number,
  beforeId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: messages.id }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      lt(messages.id, beforeId),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Deletes every message of a conversation.
 *
 * The count of conversations goes back to zero with them.
 *
 * It used to stay, so the lobby's "total chats" counted conversations
 * the user had just thrown away — and so did the gate on the
 * graduation, which counts the conversations of the relationship.
 */
export async function clearMessagesByPersonaId(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.transaction(async (tx) => {
    await tx.delete(messages)
      .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
    // The marks point at messages that no longer exist; they would
    // otherwise stay as invisible rows (C8.10 × C8.11).
    await tx.delete(messageMarks)
      .where(and(eq(messageMarks.personaId, personaId), eq(messageMarks.userId, userId)));
    await tx.update(personas)
      .set({ chatCount: 0 })
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  });
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  /**
   * An encrypted account's message text is ciphertext, so `ILIKE` can
   * never match it. The search runs on the blind index instead: the
   * query's bigrams are HMACed the same way the stored ones were, then
   * the rows are decrypted here to confirm the substring — a bigram
   * match only says the pairs exist somewhere, not that they are
   * adjacent. A one-character query has no bigram to look up; there is
   * nothing to search on, so it returns nothing rather than every row.
   */
  if (encryptsWrites(userId)) {
    const lexemes = indexableLexemes(queryLexemes(query));
    const tokens = lexemes.length > 0 ? queryTokensFor(userId, lexemes) : [];
    if (tokens.length === 0) return [];
    const tsQuery = toTsQuery(tokens, "&");
    const rows = await db.select().from(messages)
      .where(and(
        isNull(messages.deletedAt),
        eq(messages.personaId, personaId),
        eq(messages.userId, userId),
        sql`${messages.searchTokens} @@ (${tsQuery})::tsquery`,
      ))
      .orderBy(desc(messages.createdAt))
      .limit(limit * 3);
    const needle = query.toLowerCase();
    return decryptRows("messages", rows)
      .filter((row) => String(row.content ?? "").toLowerCase().includes(needle))
      .slice(0, limit);
  }
  // The wildcards are escaped, so a search for "50%" does not match
  // everything that contains a digit.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  /**
   * The stored tokens are character bigrams. A one-character query has
   * no token to match (the characters around it were stored, not the
   * character alone), so the token condition must be left out and the
   * substring test allowed to answer. This is the same rule the record
   * search uses; without it, a search for "猫" stopped finding
   * "我有一只猫" once the tokens were backfilled.
   */
  const tsQuery = toTsQuery(indexableLexemes(queryLexemes(query)), "&");
  const rows = await db.select().from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      ilike(messages.content, `%${escaped}%`),
      tsQuery
        ? or(
            sql`${messages.searchTokens} @@ to_tsquery('simple', ${tsQuery})`,
            isNull(messages.searchTokens),
          )!
        : sql`true`,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return decryptRows("messages", rows);
}

/**
 * Searches across every persona the user has.
 *
 * A person looking for something they said six months ago does not
 * remember which conversation it was in — and the thing they are
 * looking for is often a memory or a diary entry rather than a message.
 */
export async function searchAllMessages(
  userId: number,
  query: string,
  limit = 50,
) {
  const db = await getDb();
  if (!db) return [];
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  /**
   * An encrypted account cannot be searched with `ILIKE`: the message
   * text, memory titles and diary bodies in the database are ciphertext.
   * Messages use the blind index (C8.5 step 4) and are confirmed on the
   * decrypted text here; memories and diary entries have no index
   * column, so the (small) tables are read and filtered in memory. The
   * answer keeps the same shape as the plaintext path.
   */
  if (encryptsWrites(userId)) {
    const lexemes = indexableLexemes(queryLexemes(query));
    const tokens = lexemes.length > 0 ? queryTokensFor(userId, lexemes) : [];
    const messageTsQuery = tokens.length > 0 ? toTsQuery(tokens, "&") : null;

    const [messageRaw, memoryRaw, diaryRaw] = await Promise.all([
      messageTsQuery
        ? db.select({
            id: messages.id,
            personaId: messages.personaId,
            kind: sql<string>`'message'`,
            role: messages.role,
            title: sql<string>`NULL`,
            content: messages.content,
            createdAt: messages.createdAt,
          }).from(messages)
            .where(and(
              isNull(messages.deletedAt),
              eq(messages.userId, userId),
              sql`${messages.searchTokens} @@ (${messageTsQuery})::tsquery`,
            ))
            .orderBy(desc(messages.createdAt))
            .limit(limit * 3)
        : Promise.resolve([]),
      db.select().from(memories)
        .where(and(isNull(memories.deletedAt), eq(memories.userId, userId)))
        .orderBy(desc(memories.createdAt))
        .limit(500),
      db.select().from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .orderBy(desc(diaryEntries.createdAt))
        .limit(500),
    ]);

    const messageRows = messageRaw
      .map((row) => ({ ...row, content: decryptTextForRead(userId, row.content) }))
      .filter((row) => String(row.content ?? "").toLowerCase().includes(needle))
      .slice(0, limit);

    const memoryRows = memoryRaw
      .map((row) => decryptRows("memories", [row])[0]!)
      .filter((row) => {
        const title = String(row.title ?? "").toLowerCase();
        const description = String(row.description ?? "").toLowerCase();
        return title.includes(needle) || description.includes(needle);
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        personaId: row.personaId,
        kind: "memory" as const,
        role: "assistant" as const,
        title: row.title,
        content: row.description ?? "",
        createdAt: row.createdAt,
      }));

    const diaryRows = diaryRaw
      .map((row) => decryptRows("diary_entries", [row])[0]!)
      .filter((row) => {
        const summary = String(row.summary ?? "").toLowerCase();
        const reflection = String(row.reflection ?? "").toLowerCase();
        return summary.includes(needle) || reflection.includes(needle);
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        personaId: row.personaId,
        kind: "diary" as const,
        role: "assistant" as const,
        title: null,
        content: row.summary,
        createdAt: row.createdAt,
      }));

    return [...messageRows, ...memoryRows, ...diaryRows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const messageTsQuery = toTsQuery(indexableLexemes(queryLexemes(query)), "&");

  const [messageRows, memoryRows, diaryRows] = await Promise.all([
    db.select({
      id: messages.id,
      personaId: messages.personaId,
      kind: sql<string>`'message'`,
      role: messages.role,
      title: sql<string>`NULL`,
      content: messages.content,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(
        isNull(messages.deletedAt),
        eq(messages.userId, userId),
        ilike(messages.content, pattern),
        messageTsQuery
          ? or(
              sql`${messages.searchTokens} @@ to_tsquery('simple', ${messageTsQuery})`,
              isNull(messages.searchTokens),
            )!
          : sql`true`,
      ))
      .orderBy(desc(messages.createdAt))
      .limit(limit),

    db.select({
      id: memories.id,
      personaId: memories.personaId,
      kind: sql<string>`'memory'`,
      role: sql<string>`'assistant'`,
      title: memories.title,
      content: sql<string>`COALESCE(${memories.description}, '')`,
      createdAt: memories.createdAt,
    }).from(memories)
      .where(and(
        isNull(memories.deletedAt),
        eq(memories.userId, userId),
        or(
          ilike(memories.title, pattern),
          ilike(sql`COALESCE(${memories.description}, '')`, pattern),
        ),
      ))
      .orderBy(desc(memories.createdAt))
      .limit(limit),

    db.select({
      id: diaryEntries.id,
      personaId: diaryEntries.personaId,
      kind: sql<string>`'diary'`,
      role: sql<string>`'assistant'`,
      title: sql<string>`NULL`,
      content: diaryEntries.summary,
      createdAt: diaryEntries.createdAt,
    }).from(diaryEntries)
      .where(and(
        eq(diaryEntries.userId, userId),
        or(
          ilike(diaryEntries.summary, pattern),
          ilike(sql`COALESCE(${diaryEntries.reflection}, '')`, pattern),
        ),
      ))
      .orderBy(desc(diaryEntries.createdAt))
      .limit(limit),
  ]);

  return [...messageRows, ...memoryRows, ...diaryRows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

// ─── Sticker helpers ───────────────────────────────────────────────────────

/**
 * Writes a sticker, or adds to the one already there.
 *
 * The key is what makes it the same sticker: the content hash when
 * there is an image, the label when there is not. A second import of
 * the same pack must not create a second row — it updates the counts
 * and the last-used time.
 */
export async function upsertSticker(data: InsertSticker): Promise<Sticker> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(stickers)
    .values(data)
    .onConflictDoUpdate({
      target: [stickers.personaId, stickers.userId, stickers.key],
      set: {
        label: data.label,
        ...(data.fileKey ? { fileKey: data.fileKey, mime: data.mime ?? null } : {}),
        usesByThem: data.usesByThem ?? 0,
        usesByMe: data.usesByMe ?? 0,
        firstUsedAt: data.firstUsedAt ?? null,
        lastUsedAt: data.lastUsedAt ?? null,
      },
    })
    .returning();
  return row!;
}

export async function listStickers(personaId: number, userId: number): Promise<Sticker[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(stickers)
    .where(and(eq(stickers.personaId, personaId), eq(stickers.userId, userId)))
    .orderBy(desc(stickers.usesByThem), asc(stickers.label));
}

export async function listEnabledStickers(
  personaId: number,
  userId: number,
): Promise<Sticker[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(stickers)
    .where(
      and(
        eq(stickers.personaId, personaId),
        eq(stickers.userId, userId),
        eq(stickers.enabled, true),
      ),
    )
    .orderBy(desc(stickers.usesByThem), asc(stickers.label));
}

export async function countStickers(personaId: number, userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stickers)
    .where(and(eq(stickers.personaId, personaId), eq(stickers.userId, userId)));
  return Number(row?.c ?? 0);
}

export async function setStickerEnabled(
  personaId: number,
  userId: number,
  stickerId: number,
  enabled: boolean,
): Promise<Sticker | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .update(stickers)
    .set({ enabled })
    .where(
      and(
        eq(stickers.id, stickerId),
        eq(stickers.personaId, personaId),
        eq(stickers.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function setStickerImage(
  personaId: number,
  userId: number,
  stickerId: number,
  image: { fileKey: string; mime: string },
): Promise<Sticker | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .update(stickers)
    .set({ fileKey: image.fileKey, mime: image.mime })
    .where(
      and(
        eq(stickers.id, stickerId),
        eq(stickers.personaId, personaId),
        eq(stickers.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteSticker(
  personaId: number,
  userId: number,
  stickerId: number,
): Promise<Sticker | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .delete(stickers)
    .where(
      and(
        eq(stickers.id, stickerId),
        eq(stickers.personaId, personaId),
        eq(stickers.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

// ─── Media helpers ─────────────────────────────────────────────────────────

/**
 * Registers a recording, photograph, or video.
 *
 * The hash is the identity: the same file imported twice must be one
 * row. A re-import may bring a fresher timestamp or a transcript, so
 * the interesting fields are updated rather than left alone.
 */
export async function upsertMedia(data: InsertMedia): Promise<Media> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(media)
    .values(data)
    .onConflictDoUpdate({
      target: [media.personaId, media.userId, media.hash],
      set: {
        fileKey: data.fileKey,
        // A field the caller did not mention is not a request to
        // erase it. `registerUploadedVideos` re-registers every
        // uploaded video on each run and has no duration or frame size
        // to give; the old `?? null` wrote those columns away.
        ...(data.mime !== undefined ? { mime: data.mime } : {}),
        ...(data.bytes !== undefined ? { bytes: data.bytes } : {}),
        ...(data.at !== undefined ? { at: data.at } : {}),
        ...(data.recordId !== undefined ? { recordId: data.recordId } : {}),
        ...(data.fileId !== undefined ? { fileId: data.fileId } : {}),
        ...(data.fromThem !== undefined ? { fromThem: data.fromThem } : {}),
        ...(data.durationSec !== undefined ? { durationSec: data.durationSec } : {}),
        ...(data.width !== undefined ? { width: data.width } : {}),
        ...(data.height !== undefined ? { height: data.height } : {}),
        ...(data.transcript !== undefined && data.transcript !== null
          ? { transcript: data.transcript }
          : {}),
        ...(data.transcriptEngine !== undefined && data.transcriptEngine !== null
          ? { transcriptEngine: data.transcriptEngine }
          : {}),
        ...(data.exif !== undefined && data.exif !== null ? { exif: data.exif } : {}),
      },
    })
    .returning();
  return row!;
}

export async function listMedia(
  personaId: number,
  userId: number,
  options: { kind?: string; fromThem?: boolean } = {},
): Promise<Media[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(media)
    .where(
      and(
        eq(media.personaId, personaId),
        eq(media.userId, userId),
        ...(options.kind ? [eq(media.kind, options.kind)] : []),
        ...(options.fromThem === undefined ? [] : [eq(media.fromThem, options.fromThem)]),
      ),
    )
    .orderBy(desc(media.at), desc(media.id));
}

/** The voice notes that do not have words yet. */
export async function listUntranscribedMedia(
  personaId: number,
  userId: number,
): Promise<Media[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(media)
    .where(
      and(
        eq(media.personaId, personaId),
        eq(media.userId, userId),
        eq(media.kind, "voice"),
        isNull(media.transcript),
      ),
    )
    .orderBy(asc(media.id));
}

export async function setMediaTranscript(
  id: number,
  userId: number,
  transcript: string,
  engine: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .update(media)
    .set({ transcript, transcriptEngine: engine })
    .where(and(eq(media.id, id), eq(media.userId, userId)))
    .returning({ id: media.id });
  return Boolean(row);
}

/** Fills in what ffmpeg learned about a video, without touching the rest. */
export async function setMediaVideoMeta(
  id: number,
  userId: number,
  meta: { durationSec: number | null; width: number | null; height: number | null },
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(media)
    .set({
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
    })
    .where(and(eq(media.id, id), eq(media.userId, userId)))
    .returning({ id: media.id });
  return rows.length > 0;
}

export async function countMedia(
  personaId: number,
  userId: number,
  kind?: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(media)
    .where(
      and(
        eq(media.personaId, personaId),
        eq(media.userId, userId),
        ...(kind ? [eq(media.kind, kind)] : []),
      ),
    );
  return Number(row?.c ?? 0);
}

/** Removes the media rows of one deleted source file. */
export async function deleteMediaByFile(
  personaId: number,
  userId: number,
  fileId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .delete(media)
    .where(
      and(
        eq(media.personaId, personaId),
        eq(media.userId, userId),
        eq(media.fileId, fileId),
      ),
    )
    .returning({ id: media.id });
  return rows.length;
}

/** One stored photograph, by id, limited to its owner. */
export async function getMediaById(id: number, userId: number): Promise<Media | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.id, id), eq(media.userId, userId)))
    .limit(1);
  return rows[0];
}

/** A photograph attached to a memory, with the fields the panel shows. */
export interface MemoryMediaPhoto {
  memoryId: number;
  mediaId: number;
  kind: string;
  fileKey: string;
  at: Date | null;
  width: number | null;
  height: number | null;
}

export async function linkMemoryMedia(data: {
  userId: number;
  personaId: number;
  memoryId: number;
  mediaId: number;
}): Promise<MemoryMedia> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(memoryMedia)
    .values(data)
    .onConflictDoNothing({
      target: [memoryMedia.memoryId, memoryMedia.mediaId],
    })
    .returning();
  if (row) return row;
  const [existing] = await db
    .select()
    .from(memoryMedia)
    .where(
      and(
        eq(memoryMedia.memoryId, data.memoryId),
        eq(memoryMedia.mediaId, data.mediaId),
        eq(memoryMedia.userId, data.userId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("DB not available");
  return existing;
}

export async function unlinkMemoryMedia(
  memoryId: number,
  mediaId: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .delete(memoryMedia)
    .where(
      and(
        eq(memoryMedia.memoryId, memoryId),
        eq(memoryMedia.mediaId, mediaId),
        eq(memoryMedia.userId, userId),
      ),
    )
    .returning({ id: memoryMedia.id });
  return rows.length > 0;
}

/**
 * The photographs attached to one memory.
 *
 * Both the link and the photo are filtered by the owner: a link row is
 * not permission to read somebody else's picture.
 */
export async function listMemoryMedia(
  memoryId: number,
  userId: number,
): Promise<MemoryMediaPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      memoryId: memoryMedia.memoryId,
      mediaId: media.id,
      kind: media.kind,
      fileKey: media.fileKey,
      at: media.at,
      width: media.width,
      height: media.height,
    })
    .from(memoryMedia)
    .innerJoin(media, eq(media.id, memoryMedia.mediaId))
    .where(
      and(
        eq(memoryMedia.memoryId, memoryId),
        eq(memoryMedia.userId, userId),
        eq(media.userId, userId),
      ),
    )
    .orderBy(asc(media.at), asc(media.id));
  return rows;
}

/**
 * The photos attached to a set of memories, grouped by memory.
 *
 * `chat.getHistory` asks once for a page of messages rather than once
 * per recalled memory.
 */
export async function listMemoryMediaForMemories(
  memoryIds: number[],
  userId: number,
): Promise<MemoryMediaPhoto[]> {
  const db = await getDb();
  if (!db || memoryIds.length === 0) return [];
  const unique = Array.from(new Set(memoryIds));
  return db
    .select({
      memoryId: memoryMedia.memoryId,
      mediaId: media.id,
      kind: media.kind,
      fileKey: media.fileKey,
      at: media.at,
      width: media.width,
      height: media.height,
    })
    .from(memoryMedia)
    .innerJoin(media, eq(media.id, memoryMedia.mediaId))
    .where(
      and(
        inArray(memoryMedia.memoryId, unique),
        eq(memoryMedia.userId, userId),
        eq(media.userId, userId),
        // Only photographs are offered to the photo layer. The link
        // route checks this too; the reader should not depend on it.
        eq(media.kind, "photo"),
      ),
    )
    .orderBy(asc(media.at), asc(media.id));
}

/** Sets or clears the avatar of one persona. */
export async function setPersonaAvatar(
  personaId: number,
  userId: number,
  avatarUrl: string | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(personas)
    .set({ avatarUrl })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

export interface VoicePage {
  rows: Media[];
  nextCursor: number | null;
}

/**
 * Writes the chat background of one persona into its settings (B7.15).
 *
 * The upload route sets one string; reading and rewriting the whole
 * settings object under the persona lock is not needed for that.
 */
export async function setPersonaBackground(
  personaId: number,
  userId: number,
  background: string | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(personas)
    .set({
      settings: sql`jsonb_set(
        jsonb_set(
          COALESCE(${personas.settings}, '{}'::jsonb),
          '{skin}',
          jsonb_set(
            COALESCE(${personas.settings}->'skin', '{}'::jsonb),
            '{theme}',
            COALESCE(${personas.settings}->'skin'->'theme', '"classic"'::jsonb),
            true
          ),
          true
        ),
        '{skin,background}',
        ${JSON.stringify(background)}::jsonb,
        true
      )`,
    })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

/**
 * The photos sent into the conversation since a moment (B7.9).
 *
 * The same picture is not sent twice within a month. The message's
 * metadata carries the media id, so the check is a query rather than a
 * column added to `media` for one feature.
 */
export async function listRecentlySentPhotoMediaIds(
  personaId: number,
  userId: number,
  since: Date,
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ mediaId: sql<string | null>`${messages.metadata}->>'mediaId'` })
    .from(messages)
    .where(
      and(
        isNull(messages.deletedAt),
        eq(messages.personaId, personaId),
        eq(messages.userId, userId),
        eq(messages.role, "assistant"),
        gte(messages.createdAt, since),
        sql`${messages.metadata}->>'kind' = 'photo'`,
      ),
    );
  return rows
    .map((row) => Number(row.mediaId))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * The voice notes of a persona, newest first.
 *
 * The cursor is the last id of the previous page. Registration walks
 * the record in time order, so id order is arrival order — which is
 * close enough to time order for a paged list, and it is a stable one.
 */
export async function listVoices(
  personaId: number,
  userId: number,
  options: { q?: string; fromThem?: boolean; cursor?: number; limit?: number } = {},
): Promise<VoicePage> {
  const db = await getDb();
  if (!db) return { rows: [], nextCursor: null };
  const limit = Math.max(1, Math.min(100, options.limit ?? 30));
  const q = options.q?.trim();
  const page = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.personaId, personaId),
        eq(media.userId, userId),
        eq(media.kind, "voice"),
        ...(options.fromThem === undefined ? [] : [eq(media.fromThem, options.fromThem)]),
        ...(q ? [ilike(media.transcript, `%${q}%`)] : []),
        ...(options.cursor ? [lt(media.id, options.cursor)] : []),
      ),
    )
    .orderBy(desc(media.id))
    .limit(limit + 1);
  const rows = page.slice(0, limit);
  return {
    rows,
    nextCursor: page.length > limit ? rows[rows.length - 1]?.id ?? null : null,
  };
}

/**
 * Merges a patch into a record's `meta`.
 *
 * The transcript of a voice note belongs on the record as well as on
 * the media row: the readers of content (facts, people, search) go
 * through `recordText`, which reads `meta.transcript`.
 */
export async function updateRecordMeta(
  id: number,
  userId: number,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * The merge happens in this process rather than in SQL.
   *
   * An encrypted `meta` is `{ enc: "<ciphertext>", register? }`; the
   * `||` operator would merge the patch into the wrapper instead of into
   * the record's own metadata. So the current value is read, decrypted,
   * merged, and written back in whatever form the account uses.
   */
  const [current] = await db
    .select({ meta: collectedMessages.meta })
    .from(collectedMessages)
    .where(and(eq(collectedMessages.id, id), eq(collectedMessages.userId, userId)))
    .limit(1);
  if (!current) return false;
  const existing = decryptRecordMetaForRead(userId, current.meta);
  const merged = {
    ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}),
    ...patch,
  };
  const [row] = await db
    .update(collectedMessages)
    .set({ meta: encryptRecordMetaForWrite(userId, merged) as never })
    .where(and(eq(collectedMessages.id, id), eq(collectedMessages.userId, userId)))
    .returning({ id: collectedMessages.id });
  return Boolean(row);
}

// ─── WeChat Binding helpers ─────────────────────────────────────────────────

export async function createWechatBinding(data: InsertWechatBinding) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(wechatBindings).values(data).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding({
    userId: data.userId,
    wechatUserId: data.wechatUserId,
    personaId: data.personaId,
    wechatName: data.wechatName ?? null,
  });
  return result.id;
}

export async function getWechatBindingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(wechatBindings).where(eq(wechatBindings.userId, userId));
}

/**
 * Finds the default persona binding for a WeChat conversation.
 *
 * `wechatUserId` is the iLink conversation counterpart id — in the official
 * ClawBot model this is the account owner's own Weixin id.
 */
export async function getWechatBindingByUserId(wechatUserId: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBindings)
    .where(and(
      eq(wechatBindings.wechatUserId, wechatUserId),
      eq(wechatBindings.userId, userId),
      eq(wechatBindings.isActive, true),
    )).limit(1);
  return result[0];
}

/**
 * Sets the default persona for a WeChat conversation, replacing any existing
 * binding for the same (user, wechatUserId) pair.
 */
export async function setWechatBindingPersona(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(wechatBindings).where(and(
    eq(wechatBindings.wechatUserId, params.wechatUserId),
    eq(wechatBindings.userId, params.userId),
  )).limit(1);

  if (existing[0]) {
    await db.update(wechatBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { wechatName: params.wechatName } : {}),
    }).where(eq(wechatBindings.id, existing[0].id));
    await syncWechatChannelBinding(params);
    return existing[0].id;
  }

  const [result] = await db.insert(wechatBindings).values({
    userId: params.userId,
    wechatUserId: params.wechatUserId,
    personaId: params.personaId,
    wechatName: params.wechatName ?? null,
    isActive: true,
  }).returning({ id: wechatBindings.id });
  await syncWechatChannelBinding(params);
  return result.id;
}

/**
 * Mirrors a WeChat binding into the channel-neutral table.
 *
 * The WeChat channel keeps its own table for one more release, but the
 * reminder scheduler and the Feishu adapter work in channel-neutral terms —
 * they read `channel_bindings`. Without this mirror a WeChat account bound
 * after the channel layer landed would never receive a channel reminder.
 */
async function syncWechatChannelBinding(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  wechatName?: string | null;
}) {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, "wechat"),
    eq(channelBindings.targetId, params.wechatUserId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.wechatName != null ? { targetName: params.wechatName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return;
  }

  await db.insert(channelBindings).values({
    userId: params.userId,
    channel: "wechat",
    targetId: params.wechatUserId,
    targetName: params.wechatName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).onConflictDoNothing();
}

/**
 * Removes a WeChat binding.
 *
 * It says whether a row was actually removed: the delete is scoped to
 * the owner, so a row that does not exist — or belongs to somebody
 * else — is silently not removed, and the caller used to report that
 * as a success.
 */
export async function deleteWechatBinding(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(wechatBindings)
    .where(and(eq(wechatBindings.id, id), eq(wechatBindings.userId, userId)))
    .returning({ id: wechatBindings.id, wechatUserId: wechatBindings.wechatUserId });
  /**
   * The mirror goes with it.
   *
   * Every WeChat binding also has a row in `channel_bindings` — and
   * that is the row the scheduler reads. So unbinding in the settings
   * removed the row from the WeChat tab, and the anniversary reminders
   * and the proactive messages kept being pushed into the very
   * conversation the user had just unbound.
   */
  for (const row of rows) {
    await db.delete(channelBindings).where(and(
      eq(channelBindings.userId, userId),
      eq(channelBindings.channel, "wechat"),
      eq(channelBindings.targetId, row.wechatUserId),
    ));
  }
  return rows.length > 0;
}

// ─── Skill Job helpers ──────────────────────────────────────────────────────

/**
 * How many runs are kept per persona.
 *
 * The rows were never pruned — unlike the collector's jobs, which are.
 * So a persona that had been distilled a dozen times carried a dozen
 * rows for ever, each with its intake notes and its snapshot of the
 * persona.
 */
const MAX_SKILL_JOBS_PER_PERSONA = 20;

export async function createSkillJob(data: InsertSkillJob) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(skillJobs).values(data).returning({ id: skillJobs.id });
  /**
   * The old runs go.
   *
   * They are pruned after the new one is written, so the run that was
   * just made is never the one that is removed.
   */
  const old = await db
    .select({ id: skillJobs.id })
    .from(skillJobs)
    .where(and(eq(skillJobs.personaId, data.personaId), eq(skillJobs.userId, data.userId)))
    .orderBy(desc(skillJobs.id))
    .offset(MAX_SKILL_JOBS_PER_PERSONA);
  if (old.length > 0) {
    await db.delete(skillJobs).where(
      inArray(skillJobs.id, old.map((row) => row.id)),
    );
  }
  return result.id;
}

export async function getSkillJobById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(skillJobs)
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId))).limit(1);
  return result[0];
}

/**
 * Writes to a distillation run.
 *
 * The row's `updatedAt` is a *heartbeat*: the guard that stops a
 * second run from starting reads it to decide whether the first one is
 * still going.
 *
 * It was never written — the column has a default and nothing sets it
 * again — so it stayed at the moment the run was *created*. The guard
 * therefore stopped working after ten minutes: the celebrity preset
 * makes fifteen model calls and easily runs longer than that, and the
 * user was told the run had started while nothing happened.
 */
export async function updateSkillJob(
  id: number,
  userId: number,
  data: Partial<InsertSkillJob>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(skillJobs).set({ ...data, updatedAt: new Date() })
    .where(and(eq(skillJobs.id, id), eq(skillJobs.userId, userId)));
}

// ─── LLM Config helpers ────────────────────────────────────────────────────

export async function getLlmConfigsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmConfigs).where(eq(llmConfigs.userId, userId));
}

// ─── The usage ledger (C8.9) ───────────────────────────────────────────────

/** Appends one row to the usage ledger. */
export async function insertLlmUsage(data: InsertLlmUsage): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(llmUsage).values(data);
}

/** The newest rows of one user's ledger, for the panel and the tests. */
export async function llmUsageRowsForUser(userId: number, limit = 500) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmUsage)
    .where(eq(llmUsage.userId, userId))
    .orderBy(desc(llmUsage.createdAt), desc(llmUsage.id))
    .limit(limit);
}

/** What was spent, by why it was spent. */
export async function sumLlmUsageByPurpose(userId: number, from: Date, to?: Date | null) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    purpose: llmUsage.purpose,
    promptTokens: sum(llmUsage.promptTokens),
    completionTokens: sum(llmUsage.completionTokens),
    calls: count(),
    estimatedCalls: sql<string>`coalesce(sum(case when ${llmUsage.estimated} then 1 else 0 end), 0)`,
    costMicros: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    /**
     * The rows belong to one user, and the query says so itself.
     *
     * A helper that takes a user id and does not bind the row to it is
     * how one person's ledger becomes another's (the structural test
     * scans this).
     */
  }).from(llmUsage)
    .where(and(
      eq(llmUsage.userId, userId),
      gte(llmUsage.createdAt, from),
      ...(to ? [lte(llmUsage.createdAt, to)] : []),
    ))
    .groupBy(llmUsage.purpose);
  return rows.map((row) => ({
    purpose: row.purpose,
    promptTokens: Number(row.promptTokens ?? 0),
    completionTokens: Number(row.completionTokens ?? 0),
    calls: Number(row.calls ?? 0),
    estimatedCalls: Number(row.estimatedCalls ?? 0),
    costMicros: Number(row.costMicros ?? 0),
  }));
}

/** What was spent, by the persona it was spent on. */
export async function sumLlmUsageByPersona(userId: number, from: Date, to?: Date | null) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    personaId: llmUsage.personaId,
    promptTokens: sum(llmUsage.promptTokens),
    completionTokens: sum(llmUsage.completionTokens),
    calls: count(),
    estimatedCalls: sql<string>`coalesce(sum(case when ${llmUsage.estimated} then 1 else 0 end), 0)`,
    costMicros: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)`,
  }).from(llmUsage)
    .where(and(
      eq(llmUsage.userId, userId),
      gte(llmUsage.createdAt, from),
      ...(to ? [lte(llmUsage.createdAt, to)] : []),
    ))
    .groupBy(llmUsage.personaId);
  return rows.map((row) => ({
    personaId: row.personaId,
    promptTokens: Number(row.promptTokens ?? 0),
    completionTokens: Number(row.completionTokens ?? 0),
    calls: Number(row.calls ?? 0),
    estimatedCalls: Number(row.estimatedCalls ?? 0),
    costMicros: Number(row.costMicros ?? 0),
  }));
}

/** What was spent, by the day it was spent on, in the user's own days. */
export async function sumLlmUsageByDay(
  userId: number,
  from: Date,
  timeZone: string | null,
  to?: Date | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The zone name is written into the SQL, not bound as a parameter.
   *
   * Postgres compares the select, the group by and the order by
   * literally: two placeholders holding the same value are still two
   * different expressions, so the query is rejected with
   * `column "llm_usage.createdAt" must appear in the GROUP BY clause`.
   * `sqlZoneName` only lets through a name the runtime knows, so
   * writing it in is safe — the same rule, and the same reason, as
   * `server/_core/user-day.ts`.
   */
  const zone = sqlZoneName(timeZone) ?? "UTC";
  const day = sql<string>`to_char(${llmUsage.createdAt} AT TIME ZONE ${sql.raw(`'${zone}'`)}, 'YYYY-MM-DD')`;
  const rows = await db.select({
    day,
    promptTokens: sum(llmUsage.promptTokens),
    completionTokens: sum(llmUsage.completionTokens),
    calls: count(),
    estimatedCalls: sql<string>`coalesce(sum(case when ${llmUsage.estimated} then 1 else 0 end), 0)`,
    costMicros: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)`,
  }).from(llmUsage)
    .where(and(
      eq(llmUsage.userId, userId),
      gte(llmUsage.createdAt, from),
      ...(to ? [lte(llmUsage.createdAt, to)] : []),
    ))
    .groupBy(day)
    .orderBy(day);
  return rows.map((row) => ({
    day: row.day,
    promptTokens: Number(row.promptTokens ?? 0),
    completionTokens: Number(row.completionTokens ?? 0),
    calls: Number(row.calls ?? 0),
    estimatedCalls: Number(row.estimatedCalls ?? 0),
    costMicros: Number(row.costMicros ?? 0),
  }));
}

/** What one distillation or evaluation job spent. */
export async function sumLlmUsageForJob(userId: number, jobId: string) {
  const db = await getDb();
  if (!db) return { calls: 0, promptTokens: 0, completionTokens: 0, costMicros: 0 };
  const [row] = await db.select({
    calls: count(),
    promptTokens: sum(llmUsage.promptTokens),
    completionTokens: sum(llmUsage.completionTokens),
    costMicros: sql<string>`coalesce(sum(${llmUsage.costMicros}), 0)`,
  }).from(llmUsage).where(and(eq(llmUsage.userId, userId), eq(llmUsage.jobId, jobId)));
  return {
    calls: Number(row?.calls ?? 0),
    promptTokens: Number(row?.promptTokens ?? 0),
    completionTokens: Number(row?.completionTokens ?? 0),
    costMicros: Number(row?.costMicros ?? 0),
  };
}

/** The monthly ceiling the user set, raw (C8.9). */
export async function getUserBudget(userId: number): Promise<unknown> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ budget: users.budget }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return rows[0]?.budget ?? null;
}

/** Writes the monthly ceiling; `null` removes it. */
export async function setUserBudget(userId: number, budget: unknown): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(users).set({ budget: budget as never })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** The scheduled-backup settings of one user, raw (C8.3). */
export async function getUserBackupSettings(userId: number): Promise<unknown> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ backupSettings: users.backupSettings }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return rows[0]?.backupSettings ?? null;
}

/** Writes the scheduled-backup settings; `null` removes them. */
export async function setUserBackupSettings(userId: number, settings: unknown): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(users).set({ backupSettings: settings as never })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Every user who has any scheduled-backup settings at all. */
export async function getUsersWithBackupSettings(): Promise<Array<{ id: number; backupSettings: unknown }>> {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, backupSettings: users.backupSettings })
    .from(users)
    .where(isNotNull(users.backupSettings));
}

/** The newest call made for one purpose — what the last distillation cost. */
export async function latestLlmUsageForPurpose(userId: number, purpose: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), eq(llmUsage.purpose, purpose)))
    .orderBy(desc(llmUsage.createdAt), desc(llmUsage.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertLlmConfig(userId: number, data: Partial<InsertLlmConfig> & { providerName: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.providerName, data.providerName))).limit(1);
  if (existing[0]) {
    await db.update(llmConfigs).set(data).where(eq(llmConfigs.id, existing[0].id));
    return existing[0].id;
  }
  const [result] = await db.insert(llmConfigs).values({ userId, ...data }).returning({ id: llmConfigs.id });
  return result.id;
}

/**
 * Makes one of the user's provider configurations the default.
 *
 * The name is matched without regard to case: the provider names come
 * from the registry, where they are written "OpenAI", while a row the
 * user saved by hand can hold "openai". The old comparison was exact,
 * so a case difference matched nothing — and because the defaults were
 * cleared first, the user was left with *no* default provider at all.
 *
 * Returns false when the user has no row for that provider, so the
 * defaults are left alone rather than cleared for nothing.
 */
export async function setDefaultLlmConfig(userId: number, providerName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({
    id: llmConfigs.id,
    providerName: llmConfigs.providerName,
  }).from(llmConfigs).where(eq(llmConfigs.userId, userId));
  const wanted = rows.find(
    (row) => row.providerName.toLowerCase() === providerName.trim().toLowerCase(),
  );
  if (!wanted) return false;

  await withTransaction(async (tx) => {
    await tx.update(llmConfigs).set({ isDefault: false }).where(eq(llmConfigs.userId, userId));
    await tx.update(llmConfigs).set({ isDefault: true }).where(eq(llmConfigs.id, wanted.id));
  });
  return true;
}

export async function getDefaultLlmConfig(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(llmConfigs)
    .where(and(eq(llmConfigs.userId, userId), eq(llmConfigs.isDefault, true))).limit(1);
  return rows[0] ?? null;
}

// ─── Daily Activity helpers ────────────────────────────────────────────────

export async function getDailyChatCounts(userId: number, days = 30, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  // The day a message belongs to is the user's day, not the server's.
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({
    date: day,
    count: count(),
    /**
     * The user's own messages.
     *
     * The count included the persona's — including the ones the app
     * sent by itself, at night, because the user had not spoken for a
     * while. So a day on which the persona spoke first counted as a
     * day of conversation — and the lobby's streak and the analytics'
     * longest streak were two different numbers for the same user.
     */
    userCount: sql<number>`count(*) FILTER (WHERE ${messages.role} = 'user')`,
  })
    .from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(day);
  return rows;
}

// ─── WeChat Bot State helpers ───────────────────────────────────────────────

export async function getWechatBotState(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  return result[0];
}

/** Lists the ids of all users, used to restore per-user channel state on boot. */
export async function getAllUserIds(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}

export type WechatBotStateUpdate = Partial<{
  status: string;
  qrCodeUrl: string | null;
  loggedInUser: string | null;
  lastError: string | null;
  botTokenEnc: string | null;
  accountId: string | null;
  baseUrl: string | null;
  wechatUserId: string | null;
  syncBuf: string | null;
  lastInboundAt: Date | null;
}>;

/**
 * The bot state, written as one statement.
 *
 * It used to be a read and then an insert — and nothing stopped two of
 * them at once. So two concurrent first writes left the user with two
 * rows, and the read (which took the first row the database felt like
 * returning) did not necessarily return the one that had the token in
 * it.
 *
 * The consequence was quiet and confusing: the button said "connected"
 * — the chip comes from the process's memory — and the monitor said
 * "no credentials, cannot start" and the bot never polled.
 *
 * So there is a unique index on the user, and the write is an upsert:
 * one statement, and the database decides which row it is.
 */
export async function upsertWechatBotState(userId: number, data: WechatBotStateUpdate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db
    .insert(wechatBotState)
    .values({ userId, ...data } as any)
    .onConflictDoUpdate({
      target: wechatBotState.userId,
      set: { ...(data as any), updatedAt: new Date() },
    })
    .returning({ id: wechatBotState.id });
  return result.id;
}

/** Persists the long-poll cursor so restarts do not lose inbound messages. */
export async function saveWechatSyncBuf(userId: number, syncBuf: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db
    .insert(wechatBotState)
    .values({ userId, syncBuf } as any)
    .onConflictDoUpdate({
      target: wechatBotState.userId,
      set: { syncBuf, updatedAt: new Date() },
    });
}

/** Records the timestamp of the last inbound message (24h keep-alive check). */
export async function touchWechatLastInbound(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(wechatBotState).where(eq(wechatBotState.userId, userId)).limit(1);
  if (existing[0]) {
    await db.update(wechatBotState).set({ lastInboundAt: new Date() }).where(eq(wechatBotState.id, existing[0].id));
  }
}

// ─── Intimacy helpers ─────────────────────────────────────────────────────

export async function getIntimacyData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const persona = await db.select({ chatCount: personas.chatCount, createdAt: personas.createdAt }).from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)));
  const [memCount] = await db.select({ c: count() }).from(memories)
    .where(and(isNull(memories.deletedAt), eq(memories.personaId, personaId), eq(memories.userId, userId)));
  const emotionRows = await db.select({ s: emotionSnapshots.emotionalState }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .groupBy(emotionSnapshots.emotionalState);
  const daysSinceCreation = Math.floor((Date.now() - new Date(persona[0].createdAt).getTime()) / 86400000);
  // The days the conversations happened on, in the user's own calendar.
  //
  // Two things were wrong here, and together they made the streak always
  // zero: the database hands a `DATE` back as a JavaScript Date rather
  // than as the string the code compared it against, and the day it was
  // compared with was the *UTC* day while the stored value is the
  // server's own clock.
  //
  // The streak is one of the inputs to the intimacy score, and the
  // intimacy score is one of the gates on the graduation — so a streak
  // that was always zero meant the whole ritual was unreachable.
  const timezone = await getUserTimezone(userId);
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const recentDays = await db.select({ d: day }).from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .groupBy(day).orderBy(desc(day)).limit(30);
  let consecutiveDays = 0;
  // Walk back from today, in the user's calendar.
  let cursor = zonedDateKey(new Date(), timezone);
  for (let i = 0; i < recentDays.length; i++) {
    if (recentDays[i].d !== cursor) break;
    consecutiveDays++;
    cursor = previousDateKey(cursor);
  }
  return {
    chatCount: persona[0].chatCount,
    totalMessages: msgCount?.c || 0,
    memoryCount: memCount?.c || 0,
    emotionVariety: emotionRows.length,
    daysSinceCreation,
    consecutiveDays,
  };
}

export async function updateIntimacy(personaId: number, userId: number, score: number, level: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ intimacyScore: score, intimacyLevel: level })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Memory helpers ───────────────────────────────────────────────────────

export async function createMemory(data: InsertMemory) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db
    .insert(memories)
    .values(encryptWriteValues("memories", data.userId, { ...data }))
    .returning({ id: memories.id });
  return result.id;
}

/**
 * How many memories a persona holds.
 *
 * The list is capped, and the cap used to be silent: a person with four
 * hundred memories was shown two hundred of them with nothing saying so.
 */
export async function countMemories(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(memories)
    .where(and(isNull(memories.deletedAt), eq(memories.personaId, personaId), eq(memories.userId, userId)));
  return result?.c || 0;
}

/**
 * The anniversaries of a persona.
 *
 * Only the anniversaries: the sweep ran every minute and read up to
 * two hundred memories of every persona to look at the handful of them
 * that were anniversaries.
 */
export async function getAnniversaryMemories(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: memories.id,
    title: memories.title,
    date: memories.date,
  })
    .from(memories)
    .where(and(
      isNull(memories.deletedAt),
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.category, "anniversary"),
    ))
    .orderBy(asc(memories.date));
  return rows.map((row) => ({ ...row, title: decryptTextForRead(userId, row.title) ?? "" }));
}

export async function getMemoriesByPersonaId(
  personaId: number,
  userId: number,
  limit: number = MEMORY_LIST_LIMIT,
) {
  const db = await getDb();
  if (!db) return [];
  // Pinned first, then by weight, then newest. The retrieval scorer does
  // its own ranking, but a low-weight memory should not be invisible to it
  // just because it is old — the candidate list is capped, so the order
  // decides what gets scored at all.
  const rows = await db.select().from(memories)
    .where(and(isNull(memories.deletedAt), eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.isPinned), desc(memories.importance), desc(memories.createdAt))
    .limit(limit);
  return decryptRows("memories", rows);
}

/**
 * Memories whose source line is something the persona said.
 *
 * In an in-app conversation those lines are reconstructed. The review
 * panel lists them so the user can keep or drop each one.
 */
export type MemoryFromPersona = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  messageId: number | null;
};

export async function getMemoriesFromPersona(
  personaId: number,
  userId: number,
): Promise<MemoryFromPersona[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: memories.id,
      title: memories.title,
      description: memories.description,
      category: memories.category,
      messageId: memories.messageId,
    })
    .from(memories)
    .innerJoin(messages, and(eq(memories.messageId, messages.id), isNull(messages.deletedAt)))
    .where(and(
      isNull(memories.deletedAt),
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.status, "active"),
      eq(messages.userId, userId),
      eq(messages.personaId, personaId),
      eq(messages.role, "assistant"),
    ))
    .orderBy(desc(memories.id));
  return rows.map((row) => ({
    ...row,
    title: decryptTextForRead(userId, row.title) ?? "",
    description: decryptTextForRead(userId, row.description),
  }));
}

/** How many memories the list returns at once. */
export const MEMORY_LIST_LIMIT = 200;

export async function getMemoriesByFactKey(
  personaId: number,
  userId: number,
  factKey: string,
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(memories)
    .where(
      and(
        isNull(memories.deletedAt),
        eq(memories.personaId, personaId),
        eq(memories.userId, userId),
        eq(memories.factKey, factKey),
      ),
    )
    .orderBy(desc(memories.createdAt));
  return decryptRows("memories", rows);
}

export async function supersedeMemory(params: {
  loserId: number;
  winnerId: number;
  personaId: number;
  userId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(memories)
    .set({ status: "superseded", supersededBy: params.winnerId })
    .where(
      and(
        eq(memories.id, params.loserId),
        eq(memories.personaId, params.personaId),
        eq(memories.userId, params.userId),
      ),
    );
}


/**
 * Records that an extraction has just run.
 *
 * It is a timestamp on the conversation rather than a new table: the
 * extraction is a fact about a conversation, and the conversation is
 * where it belongs.
 */
/**
 * Records that an extraction ran.
 *
 * The moment it records is the moment the run covered — not the wall
 * clock. A run that only had room for some of the messages must not
 * claim the rest: they would never be looked at.
 */
export async function markMemoryExtracted(
  personaId: number,
  userId: number,
  extractedAt: Date = new Date(),
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  /**
   * The row is brought up to date, not added to.
   *
   * The write said "do nothing on a conflict", but the table had no
   * constraint for a conflict to happen on — so a row was added every
   * time, and the log grew for ever. And with the constraint there, a
   * plain "do nothing" would have kept the *first* extraction's time
   * for ever, so the window of every later extraction would have been
   * the whole history.
   */
  await db.insert(memoryExtractions)
    .values({ personaId, userId, extractedAt, lastAttemptAt: extractedAt })
    .onConflictDoUpdate({
      target: [memoryExtractions.personaId, memoryExtractions.userId],
      set: { extractedAt, lastAttemptAt: extractedAt },
    });
}

/**
 * Records that an extraction *tried*, whether or not it worked.
 *
 * The window only moves when the answer could be read — so a model
 * that answers with prose instead of JSON left it where it was, and
 * the next turn paid for another call. The attempt is a separate
 * column, so a failing extraction is retried at most once per
 * interval.
 */
export async function markMemoryAttempted(
  personaId: number,
  userId: number,
  attemptedAt: Date = new Date(),
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(memoryExtractions)
    .values({ personaId, userId, extractedAt: attemptedAt, lastAttemptAt: attemptedAt })
    .onConflictDoUpdate({
      target: [memoryExtractions.personaId, memoryExtractions.userId],
      set: { lastAttemptAt: attemptedAt },
    });
}

/**
 * When the extraction last tried, whether or not it worked.
 */
export async function getLastExtractionAttemptAt(
  personaId: number,
  userId: number,
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ at: max(memoryExtractions.lastAttemptAt) }).from(memoryExtractions)
    .where(and(eq(memoryExtractions.personaId, personaId), eq(memoryExtractions.userId, userId)));
  return rows[0]?.at ?? null;
}

/**
 * Claims the right to extract a persona's memories.
 *
 * The extraction is a read and then a write: the window of messages is
 * read, the model is asked about it, and what it says is stored. Two of
 * them running at once read the same window — so the model was asked
 * the same question twice (the user paid twice), and both stored what
 * they were told, so the same memory was in the panel twice.
 *
 * The claim is on the row that already records the extraction, so it
 * is shared by every process of the app: a set in one process's memory
 * would not be.
 *
 * The statement is one, so there is no window between "is anybody
 * running?" and "I am running": the write only happens when nobody
 * holds the claim, and the database decides which of two callers gets
 * it.
 *
 * A claim that is older than `staleAfterMs` belongs to a process that
 * has gone — so it does not block the user for ever.
 */
export async function claimMemoryExtraction(
  personaId: number,
  userId: number,
  staleAfterMs = 10 * 60_000,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const rows = await db.insert(memoryExtractions)
    .values({
      personaId,
      userId,
      /**
       * The window has not moved, and nothing has been tried.
       *
       * The row is only here so the claim has something to live on —
       * the window and the attempt are recorded when the run ends, and
       * only then: a run that could not be read must leave the window
       * where it was, so those messages are read again.
       *
       * So both are the beginning of time, which is what a row that is
       * not there at all means as well.
       */
      extractedAt: new Date(0),
      lastAttemptAt: new Date(0),
      runningAt: now,
    })
    .onConflictDoUpdate({
      target: [memoryExtractions.personaId, memoryExtractions.userId],
      set: { runningAt: now },
      // Only when nobody holds the claim.
      setWhere: or(
        isNull(memoryExtractions.runningAt),
        lt(memoryExtractions.runningAt, staleBefore),
      ),
    })
    .returning({ id: memoryExtractions.id });
  return rows.length > 0;
}

/**
 * Gives the claim back, so the next run may start.
 *
 * A run that never gives it back — a process that died in the middle
 * of it — leaves the claim behind, and a claim that is old enough
 * belongs to a process that has gone.
 */
export async function releaseMemoryExtraction(
  personaId: number,
  userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(memoryExtractions)
    .set({ runningAt: null })
    .where(and(
      eq(memoryExtractions.personaId, personaId),
      eq(memoryExtractions.userId, userId),
    ));
}

/**
 * The last time an extraction ran, from the extraction log.
 */
export async function getLastExtractionAt(personaId: number, userId: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ at: max(memoryExtractions.extractedAt) }).from(memoryExtractions)
    .where(and(eq(memoryExtractions.personaId, personaId), eq(memoryExtractions.userId, userId)));
  return rows[0]?.at ?? null;
}

/**
 * The titles of a set of memories, by id.
 *
 * A message records which memories it recalled, so the interface can
 * show what the persona had in mind when it answered.
 */
/**
 * The titles of some memories.
 *
 * Scoped to the owner, like every other read here. The ids come from
 * the caller's own messages today, so nothing has leaked yet — but this
 * was the only reading helper in the file that did not check, and a
 * helper that does not check is one call away from one that does not.
 */
/**
 * The titles of a set of memories.
 *
 * The owner is required: without it, the helper hands back any user's
 * memory titles for the ids it is given. The only caller passes it, but
 * a parameter that may be left out is a parameter that will be.
 */
export async function getMemoryById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(memories)
    .where(and(isNull(memories.deletedAt), eq(memories.id, id), eq(memories.userId, userId)))
    .limit(1);
  return decryptRowOf("memories", rows[0]);
}

export async function getMemoryTitles(ids: number[], userId: number) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, string>();
  const unique = Array.from(new Set(ids));
  const rows = await db.select({
    id: memories.id,
    title: memories.title,
    subject: memories.subject,
  }).from(memories).where(and(isNull(memories.deletedAt), inArray(memories.id, unique), eq(memories.userId, userId)));
  return new Map(
    rows.map((r) => [r.id, decryptTextForRead(userId, r.title) ?? ""]),
  );
}

/**
 * Edits a memory, and lets the user pin it.
 *
 * The retrieval used to read `isPinned` and sort by `importance`, and
 * nothing ever wrote either — so "pin a memory" did not exist. The
 * fields were there; the door was not.
 */
export async function updateMemory(
  id: number,
  userId: number,
  data: {
    title?: string;
    description?: string | null;
    category?: "milestone" | "memory" | "anniversary" | "anchor";
    date?: string | null;
    isPinned?: boolean;
    importance?: number;
    /** Whose memory this is: "them", "me", or "said". */
    subject?: "them" | "me" | "said";
    /** Where the memory came from: `chat`, `records`, or `manual`. */
    source?: "chat" | "records" | "manual";
    /**
     * Clearing the source line means the user has looked at it.
     *
     * A memory extracted from the persona's own speech keeps its
     * messageId until the user says to keep it — then the link is
     * dropped so it is no longer on the review list.
     */
    messageId?: number | null;
    entities?: { people: string[]; places: string[]; things: string[] };
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(memories)
    .set(encryptWriteValues("memories", userId, data as Record<string, unknown>))
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();
  return decryptRowOf("memories", row) ?? null;
}

/**
 * Puts a memory in the bin (C8.11).
 *
 * It is invisible to every read, and the undo puts it back. The hard
 * delete is `purgeMemory`.
 *
 * It says whether a row was actually put there — a deleted row is not
 * deleted twice.
 */
export async function softDeleteMemory(
  id: number,
  userId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.update(memories)
    .set({ deletedAt: now })
    .where(and(eq(memories.id, id), eq(memories.userId, userId), isNull(memories.deletedAt)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

/**
 * Takes a deleted memory back out of the bin (C8.11).
 */
export async function restoreMemory(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.update(memories)
    .set({ deletedAt: null })
    .where(and(eq(memories.id, id), eq(memories.userId, userId), isNotNull(memories.deletedAt)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

/**
 * Removes a memory for good.
 *
 * The hard half of the old `deleteMemory`: the persona purge uses it.
 * The user's delete is `softDeleteMemory`.
 */
export async function purgeMemory(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning({ id: memories.id });
  return rows.length > 0;
}

// ─── Emotion Snapshot helpers ─────────────────────────────────────────────

/**
 * Writes the day's snapshot — or brings it up to date.
 *
 * It used to be a plain insert, and the caller decided whether there
 * was already a row for the day. So two requests that looked at the
 * same day together both wrote one, and the day had two snapshots: the
 * reader took one of them and the other stayed for ever, with the
 * count it was written with.
 *
 * The write is now the decision: the table has one row per persona,
 * user and day, and the second writer updates it.
 */
export async function createEmotionSnapshot(data: InsertEmotionSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(emotionSnapshots)
    .values(data)
    .onConflictDoUpdate({
      target: [emotionSnapshots.personaId, emotionSnapshots.userId, emotionSnapshots.date],
      set: {
        emotionalState: data.emotionalState,
        messageCount: data.messageCount,
      },
    })
    .returning({ id: emotionSnapshots.id });
  return result.id;
}

/**
 * Brings a day's snapshot up to date.
 *
 * The snapshot was written once, when the first message of the day
 * arrived, and never touched again — so the "message count" in the
 * emotion report was really "the number of messages at that moment".
 * A user who sent one message at nine in the morning and nine more at
 * nine at night showed a count of one for the day.
 */
export async function updateEmotionSnapshot(
  id: number,
  userId: number,
  data: { emotionalState?: string; messageCount?: number },
) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(emotionSnapshots)
    .set(data)
    .where(and(eq(emotionSnapshots.id, id), eq(emotionSnapshots.userId, userId)))
    .returning();
  return row ?? null;
}

export async function getEmotionSnapshots(
  personaId: number,
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window, in the user's own calendar.
   *
   * The rows carry the user's day in their `date` column, so the
   * window has to be a day key in the same calendar. It was the
   * server's clock — so a "last thirty days" chart showed thirty-one
   * days, and the left-most label fell outside the window it claimed.
   */
  const since = zonedDayKeyWindowStart(days, timezone);
  return db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .orderBy(emotionSnapshots.date);
}

export async function getEmotionReport(
  personaId: number,
  userId: number,
  days = 30,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return { snapshots: [], distribution: [], totalDays: 0, totalMessages: 0 };
  // The window is the user's own calendar — the same one the rows are
  // filed under.
  const since = zonedDayKeyWindowStart(days, timezone);
  const snapshots = await db.select().from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .orderBy(emotionSnapshots.date);
  const distribution = await db.select({
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ))
    .groupBy(emotionSnapshots.emotionalState);
  const totalMessages = snapshots.reduce((sum, s) => sum + s.messageCount, 0);
  return { snapshots, distribution, totalDays: snapshots.length, totalMessages };
}

export async function getTodaySnapshot(
  personaId: number,
  userId: number,
  /**
   * The day the snapshot is looked up under.
   *
   * It has to be the same day the snapshot was *written* under — the
   * user's own calendar. It used to be the UTC day, so the two
   * disagreed for sixteen hours out of every twenty-four: the "one
   * snapshot a day" guard fired against yesterday's row, and a user who
   * only talked between midnight and eight in the morning got no
   * snapshot at all for that day.
   */
  today: string = localDateKey(new Date()),
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId), eq(emotionSnapshots.date, today)))
    .limit(1);
  return rows[0];
}

// ─── Analytics helpers ────────────────────────────────────────────────────

export async function getMessageVolume(userId: number, days: number, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window is the user's days.
   *
   * It was an absolute instant — "now, minus thirty days" — while the
   * rows are bucketed by the user's day. So a thirty-day window covered
   * thirty-*one* day keys: the oldest one held only part of a day, and
   * the chart drew a bar the user could not account for.
   */
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({ date: day, count: count() })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      // The user's own messages: the chart is about how much the *user*
      // talked, and the persona always answers within seconds.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day).orderBy(day);
  return fillMissingDays(rows, days, timezone);
}

/**
 * The days of a range, with the days that have nothing in them.
 *
 * The charts joined the days that had rows with a continuous line — so
 * a user who was there on the first day of the month and on the last
 * saw a smooth curve implying steady contact.
 */
function fillMissingDays(
  rows: Array<{ date: string; count: number }>,
  days: number,
  timezone?: string | null,
): Array<{ date: string; count: number }> {
  const byDate = new Map(rows.map((row) => [row.date, Number(row.count)]));
  const filled: Array<{ date: string; count: number }> = [];
  const today = zonedDateKey(new Date(), timezone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return rows;
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  cursor.setUTCDate(cursor.getUTCDate() - Math.max(0, days - 1));
  for (let i = 0; i < Math.max(1, days); i++) {
    const key = cursor.toISOString().slice(0, 10);
    filled.push({ date: key, count: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return filled;
}

export async function getEmotionTimeline(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window, in the user's own calendar.
   *
   * The rows of this chart are filed under the user's day — the `date`
   * column is their day key — so the window has to be a day key in the
   * same calendar. It was the server's clock, applied to the instant
   * the row was written: so the chart showed a day the reader's own
   * calendar had already closed, and left out the day it had just
   * opened, while the charts beside it were in the reader's calendar.
   */
  const since = zonedDayKeyWindowStart(days, timezone);
  return db.select({
    date: emotionSnapshots.date,
    emotionalState: emotionSnapshots.emotionalState,
    count: count(),
  }).from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.userId, userId), gte(emotionSnapshots.date, since)))
    .groupBy(emotionSnapshots.date, emotionSnapshots.emotionalState)
    .orderBy(emotionSnapshots.date);
}

export async function getPersonaEngagement(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The window, in the user's own calendar.
   *
   * It was the server's clock — and one day longer than the chart
   * beside it, because it counted back `days` days from today rather
   * than the `days` days the window names. So a persona the reader
   * had not spoken to for a month was still in the list, with the
   * messages from the day before the window counted towards it.
   */
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  return db.select({
    personaId: messages.personaId,
    name: personas.name,
    messageCount: count(),
  }).from(messages)
    .innerJoin(personas, and(eq(messages.personaId, personas.id), isNull(personas.deletedAt)))
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId), gte(messages.createdAt, since)))
    .groupBy(messages.personaId, personas.name)
    .orderBy(desc(count()));
}

export async function getHourlyDistribution(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  // The user's days — see the message volume above.
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  /**
   * The hour, in the user's own calendar.
   *
   * It was the server's clock — the hour the message was written on
   * the machine that wrote it. So the chart of the active hours and
   * the chart of the days, in the same answer, were on two different
   * calendars.
   */
  const hour = userHourColumn(timezone);
  return db.select({
    hour,
    count: count(),
  }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      // The user's own messages: the chart is "when do *you* talk".
      // The persona answers within seconds, so counting its replies
      // made every hour look busy — and made the numbers disagree with
      // the safety counter, which counts only the user's turns.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(hour);
}

export async function getAnalyticsStats(
  userId: number,
  days: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return { totalMessages: 0, activeDays: 0, longestStreak: 0, avgPerDay: 0 };
  // The user's days — see the message volume above.
  const since = startOfUserDay(new Date(), timezone, Math.max(0, days - 1));
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      // The user's own messages, like the charts beside it.
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  /**
   * The days the user was active, in the user's own calendar.
   *
   * They were the server's days — and the volume chart in the same
   * answer used the user's days. So the "active days" number and the
   * chart beside it disagreed about which days those were.
   */
  const day = userDayColumn(timezone);
  const activeDaysRows = await db.select({ d: day }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day).orderBy(day);
  const activeDays = activeDaysRows.length;
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < activeDaysRows.length; i++) {
    if (i === 0) { currentStreak = 1; }
    else {
      const prev = new Date(activeDaysRows[i - 1].d);
      const curr = new Date(activeDaysRows[i].d);
      const diff = (curr.getTime() - prev.getTime()) / 86400000;
      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
  }
  return {
    totalMessages: msgCount?.c || 0,
    activeDays,
    longestStreak,
    /**
     * The average over the *range*.
     *
     * It was over the days the user was there — so a hundred messages
     * over five active days in a thirty-day window read as "twenty
     * messages a day", six times what the label implies, with the
     * denominator never stated.
     */
    avgPerDay: Math.round((msgCount?.c || 0) / Math.max(1, days)),
  };
}

// ─── Diary helpers ────────────────────────────────────────────────────────

export async function createDiaryEntry(data: InsertDiaryEntry) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db
    .insert(diaryEntries)
    .values(encryptWriteValues("diary_entries", data.userId, { ...data }))
    .returning({ id: diaryEntries.id });
  return result.id;
}

/**
 * How many diary entries there are.
 *
 * The list is capped — and the count used to be the cap: so a persona
 * with two hundred diaries read as if there were thirty.
 */
export async function countDiaryEntries(userId: number, personaId?: number) {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const [result] = await db.select({ c: count() }).from(diaryEntries)
    .where(and(...conditions));
  return result?.c || 0;
}

export async function getDiaryEntries(userId: number, personaId?: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({
    id: diaryEntries.id, personaId: diaryEntries.personaId, date: diaryEntries.date,
    summary: diaryEntries.summary, highlights: diaryEntries.highlights,
    emotionalArc: diaryEntries.emotionalArc, quotes: diaryEntries.quotes,
    reflection: diaryEntries.reflection, messageCount: diaryEntries.messageCount,
    createdAt: diaryEntries.createdAt, personaName: personas.name,
  }).from(diaryEntries)
    .innerJoin(personas, and(eq(diaryEntries.personaId, personas.id), isNull(personas.deletedAt)))
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    summary: decryptTextForRead(userId, row.summary) ?? "",
    reflection: decryptTextForRead(userId, row.reflection),
    highlights: decryptJsonForRead(userId, row.highlights),
    emotionalArc: decryptJsonForRead(userId, row.emotionalArc),
    quotes: decryptJsonForRead(userId, row.quotes),
  }));
}

export async function getDiaryByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId), eq(diaryEntries.date, date)))
    .limit(1);
  return decryptRowOf("diary_entries", rows[0]) ?? undefined;
}

/**
 * Removes a diary entry.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteDiaryEntry(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db.delete(diaryEntries)
    .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)))
    .returning({ id: diaryEntries.id });
  return rows.length > 0;
}

/**
 * The messages of one day, in the user's own calendar.
 *
 * The day a message belongs to is the user's day, not the server's: the
 * timestamps are stored without a time zone, so `DATE(createdAt)` is
 * the day it was written on the machine that wrote it. The shift is the
 * same one the daily counts use.
 */
export async function getMessagesByDate(
  personaId: number,
  userId: number,
  date: string,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select().from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId), sql`${day} = ${date}`))
    .orderBy(asc(messages.createdAt));
  return decryptRows("messages", rows);
}

export async function getDiaryDates(userId: number, personaId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(diaryEntries.userId, userId)];
  if (personaId) conditions.push(eq(diaryEntries.personaId, personaId));
  const rows = await db.select({ date: diaryEntries.date }).from(diaryEntries).where(and(...conditions));
  return rows.map(r => r.date);
}

// ─── SCENES ──────────────────────────────────────────────────────────────────

/**
 * The scenes every installation ships with.
 *
 * The wording comes from the copy table, so the row that is seeded and the
 * wording the interface shows cannot drift apart. The row keeps the
 * Chinese name because that name is how the scene is recognised: the
 * seeding looks for it, and a row that already carries it is left alone.
 *
 * Exported so the seeding routine can be tested without a database.
 */
export const BUILTIN_SCENES: InsertScene[] = BUILTIN_SCENE_DEFINITIONS.map((scene) => ({
  name: scene.name,
  icon: scene.icon,
  description: scene.description.zh,
  systemPromptOverlay: scene.overlay.zh,
  emotionalState: scene.emotionalState,
  starters: scene.starters.map((starter) => starter.zh),
  isBuiltin: true,
}));

/**
 * Seeds the built-in scenes.
 *
 * The scenes are identified by their name, and the list grows with every
 * release — so the seeding fills in whatever is missing rather than
 * deciding that an installation which already has a built-in scene is
 * complete. Otherwise a new scene would only ever appear on a fresh
 * install.
 *
 * Two processes may seed at the same time, so the insert ignores conflicts:
 * the partial unique index on the built-in names decides which row wins.
 *
 * Exported so the routine can be tested without a database.
 */
export async function seedBuiltinScenes(db: ReturnType<typeof drizzle>): Promise<void> {
  const existing = await db.select({ name: scenes.name }).from(scenes).where(eq(scenes.isBuiltin, true));
  const have = new Set(existing.map((row) => row.name));
  const missing = BUILTIN_SCENES.filter((scene) => !have.has(scene.name));
  if (missing.length === 0) return;
  await db.insert(scenes).values(missing).onConflictDoNothing();
}

export async function getScenes(userId: number) {
  const db = await getDb();
  if (!db) return [];
  await seedBuiltinScenes(db);
  return db.select().from(scenes)
    .where(sql`${scenes.isBuiltin} = true OR ${scenes.userId} = ${userId}`)
    .orderBy(desc(scenes.isBuiltin), asc(scenes.createdAt));
}

/**
 * Reads a scene by id.
 *
 * Built-in scenes belong to no user and are readable by everyone; a custom
 * scene is only readable by the user who created it.
 */
export async function getSceneById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(scenes)
    .where(and(
      eq(scenes.id, id),
      or(eq(scenes.isBuiltin, true), eq(scenes.userId, userId)),
    )).limit(1);
  return row || null;
}

export async function createScene(data: InsertScene) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(scenes).values(data).returning();
  return row;
}

/**
 * Changes a custom scene (C8.13).
 *
 * The owner and the built-in flag are in the query, not in the caller:
 * a built-in scene belongs to the installation, and another user's
 * scene was never readable in the first place. What a caller may change
 * is decided by the route, which also reports *why* nothing changed —
 * "not found" and "built-in" are different answers.
 *
 * Returns the updated row, or null when there was nothing to update.
 */
export async function updateScene(
  id: number,
  userId: number,
  patch: Partial<InsertScene>,
): Promise<Scene | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(scenes).set(patch).where(and(
    eq(scenes.id, id),
    eq(scenes.isBuiltin, false),
    eq(scenes.userId, userId),
  )).returning();
  return row ?? null;
}

/**
 * Deletes a custom scene.
 *
 * Returns false when nothing was deleted — the scene belongs to somebody
 * else, or it is a built-in one. The caller turns that into a refusal
 * rather than reporting a success that did not happen.
 */
export async function deleteScene(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const deleted = await db.delete(scenes).where(and(
    eq(scenes.id, id),
    eq(scenes.isBuiltin, false),
    eq(scenes.userId, userId),
  ));
  return (deleted.rowCount ?? 0) > 0;
}

/**
 * Attaches a scene to a persona.
 *
 * Only the persona's owner may change this, and only their own scenes (or a
 * built-in one) may be attached — otherwise a user could graft another
 * user's scene prompt onto their persona.
 */
export async function activateScene(personaId: number, sceneId: number | null, userId: number) {
  const db = await getDb();
  if (!db) return;

  if (sceneId != null) {
    const scene = await getSceneById(sceneId, userId);
    if (!scene) throw new Error("Scene not found");
    /**
     * A scene drawn from a stretch of the record belongs to the persona
     * it came from (C8.13). The route reports this in the user's
     * language; the query-level guard is here so no other caller can
     * attach one across personas either.
     */
    const range = normalizeSceneRecordRange(scene.recordRange);
    if (range && range.personaId !== personaId) {
      throw new Error("A scene drawn from the record can only be used on its own persona");
    }
  }

  await db.update(personas).set({ activeSceneId: sceneId, updatedAt: new Date() })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
}

// ─── Export helpers ─────────────────────────────────────────────────────────

/**
 * How many messages one persona's export carries.
 *
 * The export is held in memory and then serialised into one string, so
 * the ceiling is a memory ceiling rather than a policy one. The
 * whole-account export has had one all along; the single-persona one
 * did not — and a persona with a hundred thousand messages read all of
 * them, and then built one HTML string out of them.
 */
const MAX_PERSONA_EXPORT_MESSAGES = 10_000;

/** How many memories one persona's export carries. */
const MAX_PERSONA_EXPORT_MEMORIES = 10_000;

/** How many days of emotional snapshots one persona's export carries. */
const MAX_PERSONA_EXPORT_SNAPSHOTS = 3_650;

/** How many diary entries one persona's export carries. */
const MAX_PERSONA_EXPORT_DIARIES = 3_650;

/** How many letters one persona's export carries. */
const MAX_PERSONA_EXPORT_LETTERS = 10_000;

export async function getExportData(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const [persona] = await db.select().from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const allMessages = await db.select().from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(asc(messages.createdAt))
    .limit(MAX_PERSONA_EXPORT_MESSAGES);
  /**
   * The other four lists are bounded as well.
   *
   * The export is held in memory and then rendered into one HTML
   * string, so the ceiling is a memory ceiling rather than a policy
   * one. Memories grow by up to five a day, diaries and snapshots by
   * one a day each, and letters by as many as the user writes.
   */
  const allMemories = await db.select().from(memories)
    .where(and(isNull(memories.deletedAt), eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(asc(memories.createdAt))
    .limit(MAX_PERSONA_EXPORT_MEMORIES);
  const allSnapshots = await db.select().from(emotionSnapshots)
    .where(and(eq(emotionSnapshots.personaId, personaId), eq(emotionSnapshots.userId, userId)))
    .orderBy(asc(emotionSnapshots.date))
    .limit(MAX_PERSONA_EXPORT_SNAPSHOTS);
  const allDiaries = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId)))
    .orderBy(asc(diaryEntries.date))
    .limit(MAX_PERSONA_EXPORT_DIARIES);
  const allLetters = await db.select().from(letters)
    .where(and(eq(letters.personaId, personaId), eq(letters.userId, userId)))
    .orderBy(asc(letters.createdAt))
    .limit(MAX_PERSONA_EXPORT_LETTERS);
  return {
    persona: decryptRowOf("personas", persona)!,
    messages: decryptRows("messages", allMessages),
    memories: decryptRows("memories", allMemories),
    emotionSnapshots: allSnapshots,
    diaryEntries: decryptRows("diary_entries", allDiaries),
    letters: decryptRows("letters", allLetters),
  };
}

// ─── Message-level helpers ──────────────────────────────────────────────────

/**
 * Rewrites a message the user sent.
 *
 * Only the user's own messages can be edited: the persona's replies are
 * what they are, and letting them be rewritten would quietly change the
 * record of the conversation.
 */
export async function updateUserMessage(
  messageId: number,
  userId: number,
  content: string,
  personaId?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * The message has to be in the conversation the user is looking at.
   *
   * The edit was scoped to the user alone, so a message of one persona
   * could be edited through another — the conversation on the screen
   * and the conversation that changed were two different ones.
   */
  const updated = await db.update(messages)
    .set({
      content: encryptTextForWrite(userId, content)!,
      searchTokens: searchTokensValueFor(userId, content),
    })
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  return updated.length > 0;
}

/**
 * Puts a single message in the bin (C8.11).
 *
 * The chat history is the user's, and a single message in the middle of it
 * can be something they would rather not have written down. It is hidden
 * from every read, and the undo takes it back; the hard delete is
 * `purgeMessage`, which the message's own deletion does not use.
 *
 * A message inside a deleted persona is already hidden by the persona's
 * own deletion, so only the active rows are marked here.
 */
export async function softDeleteMessage(
  messageId: number,
  userId: number,
  personaId?: number,
  now: Date = new Date(),
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // The message has to be in the conversation the user is looking at.
  const deleted = await db.update(messages)
    .set({ deletedAt: now })
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      isNull(messages.deletedAt),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  /**
   * The marks are left alone here: the undo brings them back with the
   * message. `purgeMessage` is the one that forgets them.
   */
  return deleted.length > 0;
}

/**
 * Takes a deleted message back out of the bin (C8.11).
 *
 * The undo writes the row back as it was; nothing about the message was
 * changed by the deletion.
 */
export async function restoreMessage(
  messageId: number,
  userId: number,
  personaId?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const restored = await db.update(messages)
    .set({ deletedAt: null })
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      isNotNull(messages.deletedAt),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  return restored.length > 0;
}

/**
 * Deletes a single message for good.
 *
 * The hard half of the old `deleteMessage`. The purge of a persona and
 * the internal rollback of a failed turn use it; the user's delete is
 * `softDeleteMessage`.
 */
export async function purgeMessage(
  messageId: number,
  userId: number,
  personaId?: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // The message has to be in the conversation the user is looking at.
  const deleted = await db.delete(messages)
    .where(and(
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .returning({ id: messages.id });
  /**
   * A star or a topic that points at a message that is gone would be a
   * list entry that jumps nowhere (C8.10).
   */
  if (deleted.length > 0) {
    try {
      await db.delete(messageMarks)
        .where(and(eq(messageMarks.messageId, messageId), eq(messageMarks.userId, userId)));
    } catch (error) {
      console.warn("[db] The message's marks could not be removed:", error);
    }
  }
  return deleted.length > 0;
}

// ─── Conversation management (C8.10) ───────────────────────────────────────

/**
 * One row: a star, a pin, or a topic marker.
 *
 * The three are one table because they are one idea — a message the user
 * wants to keep hold of — and because the same message can be starred
 * and pinned without becoming two different features.
 */
export async function addMessageMark(data: InsertMessageMark): Promise<MessageMark> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  /**
   * A second star on the same message is the same star.
   *
   * A topic's label is the thing being changed, so a second marker on
   * the same message renames it instead of failing.
   */
  const [row] = await db.insert(messageMarks)
    .values(data)
    .onConflictDoUpdate({
      target: [messageMarks.userId, messageMarks.messageId, messageMarks.kind],
      set: { label: data.label ?? null },
    })
    .returning();
  return row!;
}

/** The marks of one conversation, newest last, with what they point at. */
export async function listMessageMarks(
  personaId: number,
  userId: number,
  kind?: "star" | "pin" | "topic",
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messageMarks.id,
    personaId: messageMarks.personaId,
    messageId: messageMarks.messageId,
    kind: messageMarks.kind,
    label: messageMarks.label,
    createdAt: messageMarks.createdAt,
    content: messages.content,
    role: messages.role,
    messageCreatedAt: messages.createdAt,
  })
    .from(messageMarks)
    .innerJoin(messages, and(eq(messages.id, messageMarks.messageId), isNull(messages.deletedAt)))
    .where(and(
      eq(messageMarks.personaId, personaId),
      eq(messageMarks.userId, userId),
      eq(messages.userId, userId),
      ...(kind ? [eq(messageMarks.kind, kind)] : []),
    ))
    .orderBy(asc(messageMarks.createdAt), asc(messageMarks.id));
  return rows.map((row) => ({ ...row, content: decryptTextForRead(userId, row.content) ?? "" }));
}

/** How many of one kind a conversation carries. */
export async function countMessageMarks(
  personaId: number,
  userId: number,
  kind: "star" | "pin" | "topic",
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  /**
   * Only marks whose message is still visible count (C8.10 × C8.11).
   *
   * A soft-deleted message keeps its marks so the undo can bring the
   * pin back. Counting the raw rows would let a message the user threw
   * away keep a pin slot for ever — invisible in `list`, impossible to
   * remove, and still counted against the three-pin limit.
   */
  const [row] = await db
    .select({ c: count() })
    .from(messageMarks)
    .innerJoin(messages, and(
      eq(messages.id, messageMarks.messageId),
      isNull(messages.deletedAt),
    ))
    .where(and(
      eq(messageMarks.personaId, personaId),
      eq(messageMarks.userId, userId),
      eq(messageMarks.kind, kind),
    ));
  return Number(row?.c ?? 0);
}

/** One mark of the caller's own. */
export async function getMessageMark(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(messageMarks)
    .where(and(eq(messageMarks.id, id), eq(messageMarks.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Takes one mark away. Only its owner's. */
export async function removeMessageMark(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(messageMarks)
    .where(and(eq(messageMarks.id, id), eq(messageMarks.userId, userId)))
    .returning({ id: messageMarks.id });
  return rows.length > 0;
}

/**
 * Deletes a message and everything the persona said after it.
 *
 * This is what "regenerate" needs: the old reply and everything after it
 * belonged to a turn that is being replaced.
 *
 * The cut is made inside one persona. It used to be made by time across
 * the whole account, so pressing "regenerate" in one conversation deleted
 * the messages of every other conversation the user had — the history of
 * another persona, destroyed by a button in this one.
 */
/**
 * A message, as it is kept so that it can be put back.
 */
export interface MessageSnapshot {
  role: string;
  content: string;
  emotionalState: string | null;
  messageType: string | null;
  mediaUrl: string | null;
  replyToId: number | null;
  /**
   * Where the message came from.
   *
   * It was left out — so a restored WeChat message became a "web" one,
   * and a letter's answer or a proactive message became an ordinary
   * turn. The transcript said the wrong thing about where the message
   * came from.
   */
  channel: string | null;
  /** "letter" or "proactive", when the message was one of those. */
  origin: string | null;
  createdAt: Date;
}

/**
 * The messages from a given one onwards, oldest first.
 *
 * They are read so that they can be put back: a regeneration replaces a
 * turn, and the turn it replaces has to survive a failure.
 */
export async function getMessagesFrom(
  messageId: number,
  personaId: number,
  userId: number,
): Promise<MessageSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    role: messages.role,
    content: messages.content,
    emotionalState: messages.emotionalState,
    messageType: messages.messageType,
    mediaUrl: messages.mediaUrl,
    replyToId: messages.replyToId,
    channel: messages.channel,
    origin: messages.origin,
    createdAt: messages.createdAt,
  })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.id, messageId),
    ))
    .orderBy(asc(messages.id));
  return rows.map((row) => ({ ...row, content: decryptTextForRead(userId, row.content)! }));
}

/**
 * Writes a set of messages back.
 *
 * The ids are new ones, and the order is the order they are given in —
 * so a turn that is put back reads the same way it did before.
 */
export async function restoreMessages(
  rows: MessageSnapshot[],
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  /**
   * All of it, or none of it.
   *
   * The rows were inserted one at a time, outside a transaction — so a
   * failure halfway through left a half-restored turn: the user's own
   * question back and the persona's answer missing. And the caller
   * swallowed the error, so nobody was told.
   */
  await withTransaction(async (tx) => {
    for (const row of rows) {
      await tx.insert(messages).values({
        personaId,
        userId,
        role: row.role as "user" | "assistant",
        content: encryptTextForWrite(userId, row.content)!,
        searchTokens: searchTokensValueFor(userId, row.content),
        emotionalState: row.emotionalState,
        messageType: row.messageType as any,
        mediaUrl: row.mediaUrl,
        replyToId: row.replyToId,
        // The message keeps its own origin: a WeChat message stays a
        // WeChat message, and a letter's answer stays a letter's answer.
        ...(row.channel ? { channel: row.channel as any } : {}),
        ...(row.origin ? { origin: row.origin as any } : {}),
        createdAt: row.createdAt,
      });
    }
  });
  return rows.length;
}

export async function deleteMessagesFrom(
  messageId: number,
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const target = await db.select({ id: messages.id })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.id, messageId),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
    ))
    .limit(1);
  if (target.length === 0) return 0;

  // The ids are a sequence, so "this message and everything after it" is
  // `id >= this one`. Cutting by time instead would take the messages
  // that share the millisecond with it as well.
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(messages)
      .where(and(
        eq(messages.personaId, personaId),
        eq(messages.userId, userId),
        gte(messages.id, target[0].id),
      ))
      .returning({ id: messages.id });
    // The marks of the removed tail go with it (C8.10 × C8.11).
    await tx.delete(messageMarks).where(and(
      eq(messageMarks.personaId, personaId),
      eq(messageMarks.userId, userId),
      gte(messageMarks.messageId, target[0].id),
    ));
    return deleted.length;
  });
}

/** The message before the given one, for "regenerate the last reply". */
/**
 * The message before a given one.
 *
 * It used to read the persona's entire history — every row, with every
 * message's text — to find one. A persona with fifty thousand messages
 * read all of them on each "regenerate".
 *
 * The row before it is found in the database instead: the messages
 * before it, newest first, one row.
 */
export async function getPreviousMessage(
  personaId: number,
  userId: number,
  messageId: number,
  /**
   * The role the row must have.
   *
   * It was the row immediately before — whatever it was. So a reply to
   * a message the user did not write (a proactive message, a letter
   * answer, a message that came from another channel) had no previous
   * *user* message, and the regeneration said "that message was not
   * found".
   *
   * With a role, the search walks back to the nearest row of that
   * role — which is the user's own question that the reply answered.
   */
  role?: "user" | "assistant",
) {
  const db = await getDb();
  if (!db) return null;
  // The row before it is found by the database: the messages that are
  // older than the one asked for, newest first, one row.
  const rows = await db.select().from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      ...(role ? [eq(messages.role, role)] : []),
      sql`"createdAt" < (SELECT "createdAt" FROM "messages" WHERE "id" = ${messageId} AND "personaId" = ${personaId} AND "userId" = ${userId} AND "deletedAt" IS NULL)`,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return decryptRowOf("messages", rows[0]) ?? null;
}

// ─── Graduation helpers ─────────────────────────────────────────────────────

export async function getRecentEmotionTrend(
  personaId: number,
  userId: number,
  days: number = 14,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  /**
   * The user's own calendar, like the rows themselves.
   *
   * And the window is the same length as every other one on the page:
   * `zonedDayKeySince` is the day `days` days back, which opens a
   * window of N+1 days — so the emotion chart covered one day more
   * than it said, and one day more than the chart of daily messages
   * beside it. The two halves of the same page were on two different
   * ranges.
   */
  const since = zonedDayKeyWindowStart(days, timezone);
  return db.select({ emotionalState: emotionSnapshots.emotionalState })
    .from(emotionSnapshots)
    .where(and(
      eq(emotionSnapshots.personaId, personaId),
      eq(emotionSnapshots.userId, userId),
      gte(emotionSnapshots.date, since),
    ));
}

/**
 * The number of messages in a window of days.
 *
 * The window is the user's own.
 *
 * It used to be the server's midnight-to-midnight, while the emotion
 * trend one line above was measured on the user's — so the two halves
 * of the same gate were on two different calendars, and the gate
 * fired at the wrong moment for anybody not on the server's clock.
 */
/**
 * The start of the user's own day, N days ago.
 *
 * The messages are stored with the server's wall clock, so the user's
 * midnight has to be expressed in it: shift to the user's clock, take
 * the day, shift back.
 */
function startOfUserDay(now: Date, timezone: string | null | undefined, daysAgo: number): Date {
  /**
   * The user's midnight, N days back.
   *
   * It used to be the user's midnight shifted by the offset of the zone
   * *now*, and then moved back by whole days on the *server's* clock.
   * Both are wrong on the days the clocks change: the offset of a zone
   * is not the same all year, so the midnight was an hour out, and the
   * days were counted on the server's calendar rather than the user's.
   */
  return zonedDayStart(now, timezone, daysAgo);
}

export async function getMessageCountInRange(
  personaId: number,
  userId: number,
  startDaysAgo: number,
  endDaysAgo: number,
  timezone?: string | null,
) {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  const start = startOfUserDay(now, timezone, startDaysAgo);
  const end = startOfUserDay(now, timezone, endDaysAgo);
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, start),
      sql`${messages.createdAt} < ${end}`
    ));
  return result?.c || 0;
}

export async function setGraduationStatus(
  personaId: number, userId: number,
  status: "suggested" | "graduated" | "declined" | null,
  farewellLetter?: string,
  /**
   * Whether the letter is the simplified one.
   *
   * It is recorded next to the letter because the two belong together:
   * a reader has to be able to tell which of the two they are looking
   * at, and that has to survive a reload.
   */
  farewellDegraded?: boolean,
  /**
   * Which lines the second pass kept, and which it cut.
   *
   * It is stored next to the letter because the two belong together:
   * the letter is the result, and this is how it got there.
   */
  farewellDraft?: unknown,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const now = new Date();
  const data: Record<string, any> = { graduationStatus: status, updatedAt: now };
  if (status === "suggested") {
    // The offer is recorded so it is made once rather than on every turn.
    data.graduationSuggestedAt = now;
  }
  if (status === "declined") {
    // A refusal is recorded too: it starts the cooldown, after which the
    // offer may be made again.
    data.graduationDeclinedAt = now;
  }
  if (status === "graduated") {
    data.graduatedAt = now;
    data.presence = "asleep";
    if (farewellLetter) data.farewellLetter = farewellLetter;
    if (farewellDegraded !== undefined) data.farewellDegraded = farewellDegraded;
    if (farewellDraft !== undefined) data.farewellDraft = farewellDraft;
  }
  if (status === null) {
    // Waking a persona does not destroy its farewell letter. The letter is
    // the one artefact of the goodbye, and losing it because the persona
    // was woken up would be the wrong kind of easy.
    data.graduationStatus = null;
    data.presence = "active";
  }
  await db.update(personas).set(data)
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (status === "graduated") {
    await cancelPendingReplyJobs(personaId, userId);
  }
}


// ─── Conversation summary helpers ──────────────────────────────────────────

export async function createChatSummary(data: InsertChatSummary) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(chatSummaries).values(data).returning({ id: chatSummaries.id });
  return result.id;
}

export async function getLatestChatSummary(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(chatSummaries)
    .where(and(eq(chatSummaries.personaId, personaId), eq(chatSummaries.userId, userId)))
    .orderBy(desc(chatSummaries.createdAt)).limit(1);
  return rows[0];
}


// ─── Safety event helpers ──────────────────────────────────────────────────

export async function createSafetyEvent(data: InsertSafetyEvent) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(safetyEvents).values(data).returning({ id: safetyEvents.id });
  return result.id;
}

/**
 * Whether a safety event of this kind was already recorded today.
 *
 * The safety layer's own conditions stay true all day: "more than
 * five messages" is true for the sixth message *and every message
 * after it*, and a long session stays long. So without this, every
 * message of the day recorded another event and carried another copy
 * of the same caring words — and the transparency panel, which shows
 * the newest twenty, filled up with twenty identical rows and pushed
 * the one real record off the end.
 */
export async function hasSafetyEventSince(params: {
  userId: number;
  personaId: number | null;
  type: "crisis" | "usage" | "dependency" | "graduation_trajectory" | "distress";
  since: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: safetyEvents.id })
    .from(safetyEvents)
    .where(and(
      eq(safetyEvents.userId, params.userId),
      eq(safetyEvents.type, params.type),
      gte(safetyEvents.createdAt, params.since),
      ...(params.personaId === null
        ? [isNull(safetyEvents.personaId)]
        : [eq(safetyEvents.personaId, params.personaId)]),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * How many safety events there are in all.
 *
 * The panel shows the newest twenty — so without this it could not say
 * that what it is showing is not everything.
 */
export async function countSafetyEvents(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ c: count() }).from(safetyEvents)
    .where(eq(safetyEvents.userId, userId));
  return rows[0]?.c ?? 0;
}

export async function getSafetyEvents(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(safetyEvents)
    .where(eq(safetyEvents.userId, userId))
    .orderBy(desc(safetyEvents.createdAt)).limit(limit);
}

/**
 * Marks a safety event as handled.
 *
 * It says whether a row was actually changed — see `deleteWechatBinding`.
 */
export async function resolveSafetyEvent(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(safetyEvents).set({ resolvedAt: new Date(), handled: true })
    .where(and(eq(safetyEvents.id, id), eq(safetyEvents.userId, userId)))
    .returning({ id: safetyEvents.id });
  return rows.length > 0;
}

// ─── Graduation trajectory helpers ─────────────────────────────────────────

export async function createGraduationAssessment(data: InsertGraduationAssessment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(graduationAssessments).values(data)
    .returning({ id: graduationAssessments.id });
  return result.id;
}

/**
 * The latest assessment of each of a user's personas.
 *
 * One query, rather than one per persona: the trajectory page asked
 * for the newest assessment of every persona the user had, one round
 * trip at a time.
 */
export async function getLatestGraduationAssessments(
  userId: number,
): Promise<Array<typeof graduationAssessments.$inferSelect>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinctOn([graduationAssessments.personaId])
    .from(graduationAssessments)
    .where(eq(graduationAssessments.userId, userId))
    .orderBy(graduationAssessments.personaId, desc(graduationAssessments.createdAt));
  return rows;
}

export async function getLatestGraduationAssessment(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(graduationAssessments)
    .where(and(
      eq(graduationAssessments.personaId, personaId),
      eq(graduationAssessments.userId, userId),
    ))
    .orderBy(desc(graduationAssessments.createdAt)).limit(1);
  return rows[0];
}

// ─── Channel helpers ───────────────────────────────────────────────────────


export async function getChannelBindingsByUserId(userId: number, channel?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(channelBindings.userId, userId)];
  if (channel) conditions.push(eq(channelBindings.channel, channel));
  return db.select().from(channelBindings).where(and(...conditions));
}

/** The default persona bound to a conversation on a channel. */
export async function getChannelBinding(
  userId: number,
  channel: string,
  targetId: string,
) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, userId),
    eq(channelBindings.channel, channel),
    eq(channelBindings.targetId, targetId),
    eq(channelBindings.isActive, true),
  )).limit(1);
  return rows[0];
}

/**
 * Sets the default persona for a conversation on a channel.
 *
 * Replaces any existing active binding for the same conversation.
 */
/**
 * The persona a channel talks to when a conversation has no binding of
 * its own.
 */
export async function getChannelDefaultPersona(userId: number, channel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(channelDefaultPersonas).where(and(
    eq(channelDefaultPersonas.userId, userId),
    eq(channelDefaultPersonas.channel, channel),
  )).limit(1);
  return row;
}

/**
 * Sets the persona a channel talks to.
 *
 * It is an upsert: the choice is made again and again, and it always
 * means "the persona this channel talks to".
 */
export async function setChannelDefaultPersona(params: {
  userId: number;
  channel: string;
  personaId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(channelDefaultPersonas).values({
    userId: params.userId,
    channel: params.channel,
    personaId: params.personaId,
  }).onConflictDoUpdate({
    target: [channelDefaultPersonas.userId, channelDefaultPersonas.channel],
    set: { personaId: params.personaId },
  }).returning();
  return row ?? null;
}

export async function setChannelBindingPersona(params: {
  userId: number;
  channel: string;
  targetId: string;
  personaId: number;
  targetName?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const existing = await db.select().from(channelBindings).where(and(
    eq(channelBindings.userId, params.userId),
    eq(channelBindings.channel, params.channel),
    eq(channelBindings.targetId, params.targetId),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelBindings).set({
      personaId: params.personaId,
      isActive: true,
      ...(params.targetName != null ? { targetName: params.targetName } : {}),
    }).where(eq(channelBindings.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelBindings).values({
    userId: params.userId,
    channel: params.channel,
    targetId: params.targetId,
    targetName: params.targetName ?? null,
    personaId: params.personaId,
    isActive: true,
  }).returning({ id: channelBindings.id });
  return result.id;
}

/**
 * Removes a channel binding.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteChannelBinding(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(channelBindings)
    .where(and(eq(channelBindings.id, id), eq(channelBindings.userId, userId)))
    .returning({ id: channelBindings.id });
  return rows.length > 0;
}

export async function getChannelState(userId: number, channel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);
  return rows[0];
}

export type ChannelStateUpdate = Partial<{
  status: string;
  credentialsEnc: string | null;
  cursor: string | null;
  lastInboundAt: Date | null;
  lastError: string | null;
}>;

export async function upsertChannelState(
  userId: number,
  channel: string,
  data: ChannelStateUpdate,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(channelStates).where(and(
    eq(channelStates.userId, userId),
    eq(channelStates.channel, channel),
  )).limit(1);

  if (existing[0]) {
    await db.update(channelStates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channelStates.id, existing[0].id));
    return existing[0].id;
  }

  const [result] = await db.insert(channelStates)
    .values({ userId, channel, ...data })
    .returning({ id: channelStates.id });
  return result.id;
}


// ─── Persona template helpers ──────────────────────────────────────────────

export async function getUserTemplates(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personaTemplates)
    .where(eq(personaTemplates.userId, userId))
    .orderBy(desc(personaTemplates.createdAt));
}

export async function createUserTemplate(data: InsertPersonaTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaTemplates).values(data)
    .returning({ id: personaTemplates.id });
  return result.id;
}

/**
 * Updates a template.
 *
 * It says whether a row was actually changed: the update is scoped to
 * the owner, so a row that does not exist — or belongs to somebody
 * else — is silently not updated, and the caller used to report that
 * as a success.
 */
export async function updateUserTemplate(
  id: number,
  userId: number,
  data: Partial<InsertPersonaTemplate>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(personaTemplates).set(data)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)))
    .returning({ id: personaTemplates.id });
  return rows.length > 0;
}

/**
 * Deletes a template.
 *
 * It says whether a row was actually removed, for the same reason.
 */
export async function deleteUserTemplate(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(personaTemplates)
    .where(and(eq(personaTemplates.id, id), eq(personaTemplates.userId, userId)))
    .returning({ id: personaTemplates.id });
  return rows.length > 0;
}

// ─── Questionnaire helpers ─────────────────────────────────────────────────

export async function createQuestionnaireAnswers(data: InsertPersonaQuestionnaireAnswer) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personaQuestionnaireAnswers).values(data)
    .returning({ id: personaQuestionnaireAnswers.id });
  return result.id;
}


/**
 * Appends a correction entry to a persona's log.
 *
 * The log is an array, so the append happens in application code rather than
 * with a SQL expression — the read and the write are close enough together
 * that a lost update is not worth optimising for.
 */
export async function appendPersonaCorrection(
  personaId: number,
  userId: number,
  entry: Record<string, unknown>,
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.select({ log: personas.correctionLog }).from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  const existing = Array.isArray(row?.log) ? (row.log as Record<string, unknown>[]) : [];
  const next = [...existing, entry];
  await db.update(personas).set({ correctionLog: next })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  return next;
}

// ─── Research profile helpers ──────────────────────────────────────────────

/**
 * Stores the artefacts of the celebrity research flow.
 */
/**
 * Stores the research artefacts.
 *
 * The row is written by (persona, profile) — so a second distillation
 * of the same persona with the same profile *replaces* the first one.
 *
 * The write used to be a plain insert, so every run added another row
 * and the table grew for the life of the instance, with the newest run
 * and the one before it both sitting there.
 */
export async function createResearchProfile(data: InsertResearchProfile) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db
    .insert(researchProfiles)
    .values(data)
    .onConflictDoUpdate({
      target: [researchProfiles.personaId, researchProfiles.userId, researchProfiles.profile],
      set: {
        notes: data.notes,
        audit: data.audit,
        synthesis: data.synthesis,
        validation: data.validation,
        qualityReport: data.qualityReport,
        status: data.status,
        createdAt: data.createdAt ?? new Date(),
      },
    })
    .returning({ id: researchProfiles.id });
  return result.id;
}


/** The research artefacts of a persona, newest first. */
export async function getResearchProfilesByPersonaId(
  personaId: number,
  userId: number,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researchProfiles)
    .where(and(eq(researchProfiles.personaId, personaId), eq(researchProfiles.userId, userId)))
    .orderBy(desc(researchProfiles.createdAt));
}

// ─── Collected message helpers ────────────────────────────────────────────

export async function createCollectedMessage(data: InsertCollectedMessage) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db
    .insert(collectedMessages)
    .values({
      ...encryptWriteValues("collected_messages", data.userId, { ...data }),
      searchTokens: searchTokensValueFor(data.userId, data.content),
    })
    .returning({ id: collectedMessages.id });
  return result.id;
}

/**
 * Stores a batch of collected messages.
 *
 * One insert with many rows, rather than one insert per message. A
 * chat log of fifty thousand lines was fifty thousand round trips to
 * the database, and the collection sat there for an hour.
 */
/**
 * Writes the collected messages.
 *
 * The whole batch goes in one transaction.
 *
 * The chunks were written one at a time with no transaction, so a
 * failure in the seventh of thirty left fourteen hundred rows committed
 * — and the caller swallowed the failure and reported success, so the
 * job settled as "completed" with a count that did not match what was
 * stored. Now either all of it is there or none of it is.
 */
/**
 * Every record of one persona, in insertion order (C9.5).
 *
 * The persona bundle has to be able to tell which new row is which old
 * row after an import. Records are exported in id order and inserted in
 * that same order, so the ids line up one to one — but only if the read
 * is by id, not by the time the line was spoken.
 */
export async function listRecordsForBundle(
  personaId: number,
  userId: number,
): Promise<CollectedMessage[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
    ))
    .orderBy(asc(collectedMessages.id));
  return decryptRows("collected_messages", rows);
}

/** The ids of a persona's records in insertion order — the import's pairing. */
export async function listCollectedRecordIds(
  personaId: number,
  userId: number,
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: collectedMessages.id })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
    ))
    .orderBy(asc(collectedMessages.id));
  return rows.map((row) => row.id);
}

export async function createCollectedMessages(
  rows: InsertCollectedMessage[],
): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  // Postgres takes at most a thousand parameters in one statement, and
  // a row has six of them.
  const chunkSize = 200;
  let written = 0;
  await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      /**
       * The search tokens are written with the row (C8.6).
       *
       * Computing them here rather than in a later sweep means the
       * common case — an import, then a search — reads an index that is
       * already full. The backfill exists for rows imported before the
       * column did.
       */
      const values = chunk.map((row) => ({
        ...encryptWriteValues("collected_messages", row.userId, { ...row }),
        searchTokens: searchTokensValueFor(row.userId, row.content),
      }));
      /**
       * The second copy of a message is not written.
       *
       * The importer already checks which messages are new — but that
       * check is a read, and two of them running at once both read the
       * same table and both found the same messages new. So the
       * database refuses the second copy: the unique index on the
       * idempotency key turns "the same sentence stored twice" into
       * "the second copy is quietly dropped".
       *
       * The count is what was *written*, not what was tried — so the
       * caller does not report rows that the database refused.
       */
      const inserted = await tx
        .insert(collectedMessages)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: collectedMessages.id });
      written += inserted.length;
    }
  });
  return written;
}


/** The three fields a collected message's identity is made of. */
export interface CollectedMessageKey {
  source: string | null;
  timestamp: Date | null;
  content: string;
  /**
   * The source's own id for the message.
   *
   * It is what tells one message from another when the message has no
   * time of its own. The rows collected before the column existed have
   * none — and they are matched the way they were written.
   *
   * It is not called `id`: the row has an `id` of its own, and the two
   * are nothing alike.
   */
  sourceMessageId?: string | null;
}

/**
 * The keys of the messages that were already collected.
 *
 * Only the three columns the key is made of are read: the whole row of
 * every message ever collected was loaded into the heap — fifty
 * thousand rows of a full chat log — of which three fields were used.
 */
export async function getCollectedMessageKeys(
  personaId: number,
  userId: number,
  source: string,
): Promise<CollectedMessageKey[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    source: collectedMessages.source,
    timestamp: collectedMessages.timestamp,
    content: collectedMessages.content,
    sourceMessageId: collectedMessages.sourceMessageId,
  })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
      eq(collectedMessages.source, source),
    ))
    /**
     * In the order they were written.
     *
     * The order was not specified — so the database was free to return
     * the rows in any order. And the order is what tells the first
     * "嗯" from the second: a message without a timestamp is keyed by
     * how many times that same text has been seen. So a re-collection
     * could number the "嗯"s differently from the first collection, the
     * keys would not match, and the messages would be stored a second
     * time.
     *
     * A chat log is mostly repeated messages, so this was not a rare
     * case.
     */
    .orderBy(collectedMessages.id);
  return rows.map((row) => ({ ...row, content: decryptTextForRead(userId, row.content) ?? "" }));
}

/**
 * Every collected message of a persona, across all sources.
 *
 * The distillation pipeline reads the whole history, not one source at a
 * time.
 */
/**
 * The sources a persona has collected from.
 *
 * It is a question about the distinct sources, so it is asked of the
 * database — not by reading every collected message and looking at
 * what they say.
 */
export async function getCollectedMessageSources(
  personaId: number,
  userId: number,
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.selectDistinct({ source: collectedMessages.source })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
    ));
  return rows.map((r) => r.source).filter((s): s is string => !!s);
}

/**
 * The collected messages of a persona, oldest first.
 *
 * The ceiling is a real one. A fifty-thousand-line imported chat log
 * was read whole — every time the preview was opened, every time the
 * fidelity tools ran, and every time the distillation started.
 */
export const MAX_COLLECTED_MESSAGES = 20_000;

/** How many records one persona may hold. The in-memory read cap stays at `MAX_COLLECTED_MESSAGES`. */
export const MAX_RECORDS_PER_PERSONA = 1_000_000;

export async function getCollectedMessagesForPersona(
  personaId: number,
  userId: number,
  options: {
    limit?: number;
    source?: string | null;
    newest?: boolean;
    /**
     * Which register to read. Missing means private only, the same
     * default as `iterateRecords`: a public post imported for the
     * archive must not become an exemplar or a fact in a one-to-one
     * conversation.
     */
    register?: "private" | "public" | "all";
  } = {},
) {
  const db = await getDb();
  if (!db) return [];
  const register = options.register ?? "private";
  const registerFilter =
    register === "all"
      ? []
      : register === "private"
        ? [sql`(
            ${collectedMessages.meta} IS NULL
            OR ${collectedMessages.meta}->>'register' IS NULL
            OR ${collectedMessages.meta}->>'register' = 'private'
          )`]
        : [sql`${collectedMessages.meta}->>'register' = ${register}`];
  // Ordered by when the message was *said*, not by when it was
  // imported. Two imports of two different conversations used to be
  // laid end to end, and the ruler cut cases across the seam — a case
  // whose context was half of one conversation and half of another.
  const query = db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    ...registerFilter,
    ...(options.source ? [eq(collectedMessages.source, options.source)] : []),
  ));
  /**
   * Which end of the history.
   *
   * The limit is applied *after* the order, so an ascending order with
   * a limit gives the *oldest* N. The preview asks for "the last few"
   * and got the first few ever collected — so the user saw "300
   * messages" above messages from three months ago.
   */
  if (options.newest) {
    const newest = await query
      .orderBy(desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`))
      .limit(options.limit ?? MAX_COLLECTED_MESSAGES);
    // And back into the order they were said in.
    return decryptRows("collected_messages", newest).reverse();
  }
  const rows = await query
    .orderBy(asc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`))
    .limit(options.limit ?? MAX_COLLECTED_MESSAGES);
  return decryptRows("collected_messages", rows);
}

/**
 * A lexical hit in the collected records.
 *
 * Named so the isolation scan does not treat a return-type `{` as the
 * start of the function body.
 */
export interface SearchRecordsLexicalHit {
  id: number;
  content: string;
  timestamp: Date | null;
  role: string;
  speaker: string | null;
  coverage: number;
}

export interface SearchRecordsLexicalParams {
  q: string;
  role?: "assistant" | "user" | "all";
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

function lexicalCoverage(query: string, haystack: string): number {
  const left = charBigrams(query);
  if (left.size === 0) return 0;
  const right = charBigrams(haystack);
  let hits = 0;
  for (const gram of left) if (right.has(gram)) hits += 1;
  return hits / left.size;
}

/**
 * Whether the bigram index can answer this query at all.
 *
 * A one-character query has no bigram to look up — the index stores
 * "喜欢" and "欢海", not "海" — so it falls back to the substring
 * test. That is a scan, but only for one-character queries, and the
 * alternative (storing every single character as well) would nearly
 * double the index for a rare search.
 */
function indexableLexemes(lexemes: string[]): string[] {
  return lexemes.every((lexeme) => [...lexeme].length >= 2) ? lexemes : [];
}

/** The register filter the search and the fact check share: private only. */
function privateRegisterCondition() {
  return sql`(
    ${collectedMessages.meta} IS NULL
    OR ${collectedMessages.meta}->>'register' IS NULL
    OR ${collectedMessages.meta}->>'register' = 'private'
  )`;
}

/** Escape the wildcards of a `LIKE` pattern, so `50%` does not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Lexical search over the record table (C8.6).
 *
 * The tokens are character bigrams written by `array_to_tsvector`, so
 * PostgreSQL can use the GIN index instead of reading every row of the
 * persona. The substring test is kept as well: the bigram AND says
 * every pair appears somewhere, not that the words appear together.
 *
 * Rows written before the column existed have no tokens yet. They are
 * found with the substring test until the backfill reaches them, so a
 * search during the backfill is still correct.
 */
export async function searchRecordsLexical(
  personaId: number,
  userId: number,
  params: SearchRecordsLexicalParams,
): Promise<SearchRecordsLexicalHit[]> {
  const db = await getDb();
  if (!db) return [];
  const q = String(params.q ?? "").trim();
  if (!q) return [];
  const role = params.role && params.role !== "all" ? params.role : undefined;
  const lexemes = queryLexemes(q);
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.max(1, params.limit ?? 20);
  /**
   * An encrypted account's record text is ciphertext, so `ILIKE` can
   * never match it. The search runs on the blind index instead (C8.5
   * step 4), and every candidate is decrypted here to confirm the
   * substring — the bigram AND only says the pairs exist somewhere, not
   * that they appear together. A query with no bigram (a single
   * character) has nothing to look up; searching encrypted records needs
   * at least two characters, which the interface says.
   */
  if (encryptsWrites(userId)) {
    const indexable = indexableLexemes(lexemes);
    const tokens = indexable.length > 0 ? queryTokensFor(userId, indexable) : [];
    if (tokens.length === 0) return [];
    const tsQuery = toTsQuery(tokens, "&");
    const rank = sql<number>`ts_rank(${collectedMessages.searchTokens}, (${tsQuery})::tsquery)`;
    const candidates = await db
      .select({
        id: collectedMessages.id,
        content: collectedMessages.content,
        timestamp: collectedMessages.timestamp,
        role: collectedMessages.role,
        speaker: collectedMessages.speaker,
        rank,
      })
      .from(collectedMessages)
      .where(and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        privateRegisterCondition(),
        ...(role ? [eq(collectedMessages.role, role)] : []),
        ...(params.from ? [gte(collectedMessages.timestamp, params.from)] : []),
        ...(params.to ? [lte(collectedMessages.timestamp, params.to)] : []),
        sql`${collectedMessages.searchTokens} @@ (${tsQuery})::tsquery`,
      ))
      .orderBy(
        desc(sql`COALESCE(${rank}, -1)`),
        desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`),
        desc(collectedMessages.id),
      )
      .limit(limit * 4)
      .offset(offset);
    const needle = q.toLowerCase();
    const hits: SearchRecordsLexicalHit[] = [];
    for (const row of candidates) {
      // The projection has no `userId`, so it is decrypted with the
      // caller's id — every row here is the caller's.
      const text = String(decryptTextForRead(userId, row.content as string | null) ?? "");
      if (!text.toLowerCase().includes(needle)) continue;
      hits.push({
        id: row.id,
        content: text,
        timestamp: row.timestamp ?? null,
        role: row.role,
        speaker: row.speaker ?? null,
        coverage: 1,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }
  const tsQuery = toTsQuery(indexableLexemes(lexemes), "&");
  const pattern = `%${escapeLike(q)}%`;
  const rank = tsQuery
    ? sql<number>`ts_rank(${collectedMessages.searchTokens}, to_tsquery('simple', ${tsQuery}))`
    : sql<number>`0`;
  const rows = await db
    .select({
      id: collectedMessages.id,
      content: collectedMessages.content,
      timestamp: collectedMessages.timestamp,
      role: collectedMessages.role,
      speaker: collectedMessages.speaker,
      rank,
    })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
      privateRegisterCondition(),
      ...(role ? [eq(collectedMessages.role, role)] : []),
      ...(params.from ? [gte(collectedMessages.timestamp, params.from)] : []),
      ...(params.to ? [lte(collectedMessages.timestamp, params.to)] : []),
      sql`${collectedMessages.content} ILIKE ${pattern}`,
      tsQuery
        ? or(
            sql`${collectedMessages.searchTokens} @@ to_tsquery('simple', ${tsQuery})`,
            isNull(collectedMessages.searchTokens),
          )!
        : sql`true`,
    ))
    .orderBy(
      desc(sql`COALESCE(${rank}, -1)`),
      desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`),
      desc(collectedMessages.id),
    )
    .limit(limit)
    .offset(offset);

  /**
   * The application checks the substring again.
   *
   * The database test is already `ILIKE`, so this is a second pair of
   * eyes rather than the only gate — but a search that returns a row
   * which does not contain the words would be worse than a miss.
   */
  const needle = q.toLowerCase();
  const scored: SearchRecordsLexicalHit[] = [];
  for (const row of rows) {
    const text = String(row.content ?? "");
    if (!text.toLowerCase().includes(needle)) continue;
    scored.push({
      id: row.id,
      content: text,
      timestamp: row.timestamp ?? null,
      role: row.role,
      speaker: row.speaker ?? null,
      coverage: 1,
    });
  }
  return scored;
}

/**
 * Candidate records whose tokens overlap the given text (C8.6).
 *
 * The OR query is deliberately loose: this is the candidate set that
 * C8.7, C2.3 and the fact check then score. Ranked by `ts_rank`, most
 * recent first on a tie.
 */
export async function candidateRecordsByOverlap(
  personaId: number,
  userId: number,
  params: {
    text: string;
    role?: "assistant" | "user" | "all";
    from?: Date;
    to?: Date;
    limit?: number;
  },
): Promise<SearchRecordsLexicalHit[]> {
  const db = await getDb();
  if (!db) return [];
  const text = String(params.text ?? "").trim();
  if (!text) return [];
  const role = params.role && params.role !== "all" ? params.role : undefined;
  const lexemes = queryLexemes(text);
  const limit = Math.max(1, Math.min(1000, params.limit ?? 200));
  /**
   * The same split as the lexical search: plaintext accounts match on
   * `ILIKE` and bigrams, encrypted accounts match on blind tokens and
   * are scored from the decrypted text. There is no substring fallback
   * here because the ciphertext cannot answer one.
   */
  if (encryptsWrites(userId)) {
    const indexable = indexableLexemes(lexemes);
    const tokens = indexable.length > 0 ? queryTokensFor(userId, indexable) : [];
    if (tokens.length === 0) return [];
    const tsQuery = toTsQuery(tokens, "|");
    const rank = sql<number>`ts_rank(${collectedMessages.searchTokens}, (${tsQuery})::tsquery)`;
    const rows = await db
      .select({
        id: collectedMessages.id,
        content: collectedMessages.content,
        timestamp: collectedMessages.timestamp,
        role: collectedMessages.role,
        speaker: collectedMessages.speaker,
        rank,
      })
      .from(collectedMessages)
      .where(and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        privateRegisterCondition(),
        ...(role ? [eq(collectedMessages.role, role)] : []),
        ...(params.from ? [gte(collectedMessages.timestamp, params.from)] : []),
        ...(params.to ? [lte(collectedMessages.timestamp, params.to)] : []),
        sql`${collectedMessages.searchTokens} @@ (${tsQuery})::tsquery`,
      ))
      .orderBy(
        desc(sql`COALESCE(${rank}, -1)`),
        desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`),
        desc(collectedMessages.id),
      )
      .limit(limit);
    return rows.map((row) => {
      const content = String(decryptTextForRead(userId, row.content as string | null) ?? "");
      return {
        id: row.id,
        content,
        timestamp: row.timestamp ?? null,
        role: row.role,
        speaker: row.speaker ?? null,
        coverage: lexicalCoverage(text, content),
      };
    });
  }
  const tsQuery = toTsQuery(indexableLexemes(lexemes), "|");
  /**
   * Rows that predate the column are matched on their substring, one
   * pattern per lexeme. Only the first twenty lexemes are used: an OR
   * of two thousand patterns is worse than the scan it replaces.
   */
  const fallback = lexemes.slice(0, 20).map(
    (lexeme) => sql`${collectedMessages.content} ILIKE ${`%${escapeLike(lexeme)}%`}`,
  );
  if (!tsQuery && fallback.length === 0) return [];
  const rank = tsQuery
    ? sql<number>`ts_rank(${collectedMessages.searchTokens}, to_tsquery('simple', ${tsQuery}))`
    : sql<number>`0`;
  const rows = await db
    .select({
      id: collectedMessages.id,
      content: collectedMessages.content,
      timestamp: collectedMessages.timestamp,
      role: collectedMessages.role,
      speaker: collectedMessages.speaker,
      rank,
    })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
      privateRegisterCondition(),
      ...(role ? [eq(collectedMessages.role, role)] : []),
      ...(params.from ? [gte(collectedMessages.timestamp, params.from)] : []),
      ...(params.to ? [lte(collectedMessages.timestamp, params.to)] : []),
      or(
        tsQuery
          ? sql`${collectedMessages.searchTokens} @@ to_tsquery('simple', ${tsQuery})`
          : sql`false`,
        fallback.length > 0
          ? and(
              tsQuery ? isNull(collectedMessages.searchTokens) : sql`true`,
              or(...fallback),
            )
          : sql`false`,
      ),
    ))
    .orderBy(
      desc(sql`COALESCE(${rank}, -1)`),
      desc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`),
      desc(collectedMessages.id),
    )
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    content: String(row.content ?? ""),
    timestamp: row.timestamp ?? null,
    role: row.role,
    speaker: row.speaker ?? null,
    coverage: lexicalCoverage(text, String(row.content ?? "")),
  }));
}

export { MAX_EMBEDDED_TURNS };

/**
 * A hit of the semantic search.
 *
 * `searchRecordsSemantic` returns `null` — not an empty list — when
 * the local embedding model is unavailable. The caller then shows only
 * the literal results and says why, instead of pretending there are
 * no similar lines.
 */
export interface SemanticRecordHit {
  id: number;
  content: string;
  timestamp: Date | null;
  role: string;
  speaker: string | null;
  score: number;
}

export interface SemanticSearchResult {
  hits: SemanticRecordHit[];
  /** True when the persona has more turns than the in-memory ceiling. */
  truncated: boolean;
}

/** Cosine ranking over stored vectors, kept pure so it can be tested. */
export function rankSemanticVectors(
  query: number[],
  rows: Array<{ recordId: number; vec: Uint8Array | Buffer; dim: number }>,
  cosine: (a: number[], b: number[]) => number,
  dequantize: (vec: Uint8Array | Buffer) => number[],
  k: number,
): Array<{ recordId: number; score: number }> {
  const scores: Array<{ recordId: number; score: number }> = [];
  for (const row of rows) {
    const vec = dequantize(row.vec);
    if (vec.length === 0 || query.length === 0) continue;
    const score = cosine(query, vec);
    if (score >= 0.55) scores.push({ recordId: row.recordId, score });
  }
  scores.sort((a, b) => b.score - a.score || b.recordId - a.recordId);
  return scores.slice(0, Math.max(1, k));
}

/**
 * Meaning-based search over record turns (C8.6).
 *
 * The vectors are made locally by the user's own Ollama and stored by
 * B2.3; the query is embedded the same way. Only the most recent
 * `MAX_EMBEDDED_TURNS` turns are compared — an in-memory cosine over
 * every turn of a very large history would block the server.
 */
export async function searchRecordsSemantic(
  personaId: number,
  userId: number,
  params: {
    q: string;
    role?: "assistant" | "user" | "all";
    k?: number;
    from?: Date;
    to?: Date;
  },
): Promise<SemanticSearchResult | null> {
  const q = String(params.q ?? "").trim();
  if (!q) return { hits: [], truncated: false };
  const { embedTexts, cosine, dequantizeInt8, embedModelName } = await import("./chat/embeddings");
  /**
   * The embedding check comes first: "the local model is down" is a
   * different answer (null, with an explanation in the interface) from
   * "there is nothing similar".
   */
  const encoded = await embedTexts([q]);
  if (!encoded || !encoded[0]) return null;
  const db = await getDb();
  if (!db) return null;
  const [owned] = await db
    .select({ id: personas.id })
    .from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  if (!owned) return null;
  const model = embedModelName();
  const rows = await listRecordEmbeddings(personaId, userId, model, { limit: MAX_EMBEDDED_TURNS + 1 });
  const truncated = rows.length > MAX_EMBEDDED_TURNS;
  const usable = truncated ? rows.slice(0, MAX_EMBEDDED_TURNS) : rows;
  if (usable.length === 0) return { hits: [], truncated };
  const k = Math.max(1, Math.min(50, params.k ?? 8));
  const ranked = rankSemanticVectors(encoded[0], usable, cosine, dequantizeInt8, k * 5);
  if (ranked.length === 0) return { hits: [], truncated };
  const records = await getRecordsByIds(ranked.map((row) => row.recordId), userId);
  const byId = new Map(records.map((row) => [row.id, row]));
  const role = params.role && params.role !== "all" ? params.role : undefined;
  const hits: SemanticRecordHit[] = [];
  for (const hit of ranked) {
    const record = byId.get(hit.recordId);
    if (!record) continue;
    if (role && record.role !== role) continue;
    /**
     * The date range belongs to the whole search, not only the literal
     * half. A line outside the range is not a hit just because its
     * meaning is close.
     */
    const at = record.timestamp;
    if (params.from && (!at || at.getTime() < params.from.getTime())) continue;
    if (params.to && (!at || at.getTime() > params.to.getTime())) continue;
    hits.push({
      id: record.id,
      content: String(record.content ?? ""),
      timestamp: record.timestamp ?? null,
      role: record.role,
      speaker: record.speaker ?? null,
      score: hit.score,
    });
    if (hits.length >= k) break;
  }
  return { hits, truncated };
}

/**
 * How many messages have been collected for a persona.
 *
 * The preview asks for the last few and says how many there are — and
 * the count used to be the length of the *preview*, so "30 messages"
 * was said about a history of three hundred.
 */
export async function countCollectedMessagesForPersona(
  personaId: number,
  userId: number,
  source?: string | null,
) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    ...(source ? [eq(collectedMessages.source, source)] : []),
  ));
  return result?.c || 0;
}

export interface IterateRecordsOptions {
  pageSize?: number;
  role?: string;
  kinds?: string[];
  from?: Date;
  to?: Date;
  /**
   * Missing means private only — later imports of moments, letters, or
   * group chats must not quietly change the one-to-one voice.
   *
   * `"all"` drops the filter, which is what the write-path cap uses:
   * the million-row ceiling is the whole table, not one register.
   */
  register?: string;
  /** Only rows whose search tokens have not been filled in (C8.6). */
  tokensMissing?: boolean;
}

function spokenAtColumn() {
  return sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`;
}

function recordsWhere(
  personaId: number,
  userId: number,
  options: IterateRecordsOptions = {},
) {
  const register = options.register ?? "private";
  const registerFilter =
    register === "all"
      ? undefined
      : register === "private"
        ? sql`(
            ${collectedMessages.meta} IS NULL
            OR ${collectedMessages.meta}->>'register' IS NULL
            OR ${collectedMessages.meta}->>'register' = 'private'
          )`
        : sql`${collectedMessages.meta}->>'register' = ${register}`;
  return and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
    ...(registerFilter ? [registerFilter] : []),
    ...(options.role ? [eq(collectedMessages.role, options.role)] : []),
    ...(options.kinds && options.kinds.length > 0
      ? [inArray(collectedMessages.kind, options.kinds)]
      : []),
    ...(options.from ? [gte(collectedMessages.timestamp, options.from)] : []),
    ...(options.to ? [lte(collectedMessages.timestamp, options.to)] : []),
    ...(options.tokensMissing ? [isNull(collectedMessages.searchTokens)] : []),
  );
}

/**
 * Pages through a persona's records in the order they were said.
 *
 * Anything that has to read the whole history must go through here —
 * a million-row import cannot be loaded at once. Each page is one
 * query; the caller can `await` between them so the event loop stays
 * free.
 *
 * The default register is private. Moments, letters, and group chats
 * have to ask for themselves.
 */
export async function* iterateRecords(
  personaId: number,
  userId: number,
  options: IterateRecordsOptions = {},
): AsyncGenerator<CollectedMessage, void, unknown> {
  const db = await getDb();
  if (!db) return;
  const pageSize = Math.max(1, options.pageSize ?? 5000);
  const filter = recordsWhere(personaId, userId, options);
  const spokenAt = spokenAtColumn();
  let cursorId = 0;
  for (;;) {
    const page = await db
      .select()
      .from(collectedMessages)
      .where(
        and(
          eq(collectedMessages.personaId, personaId),
          eq(collectedMessages.userId, userId),
          filter,
          ...(cursorId
            ? [
                sql`(
                  ${spokenAt},
                  ${collectedMessages.id}
                ) > (
                  SELECT COALESCE(c."timestamp", c."createdAt"), c."id"
                  FROM "collected_messages" c
                  WHERE c."id" = ${cursorId}
                )`,
              ]
            : []),
        ),
      )
      .orderBy(asc(spokenAt), asc(collectedMessages.id))
      .limit(pageSize);
    if (page.length === 0) return;
    for (const row of decryptRows("collected_messages", page)) yield row;
    if (page.length < pageSize) return;
    cursorId = page[page.length - 1].id;
  }
}

export async function countRecords(
  personaId: number,
  userId: number,
  options: IterateRecordsOptions = {},
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db
    .select({ c: count() })
    .from(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        recordsWhere(personaId, userId, options),
      ),
    );
  return Number(result?.c ?? 0);
}

/** How many rows still have no search tokens (C8.6). */
export async function countMissingSearchTokens(
  kind: "records" | "messages",
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const table = kind === "records" ? collectedMessages : messages;
  const [result] = await db
    .select({ c: count() })
    .from(table)
    .where(isNull(table.searchTokens));
  return Number(result?.c ?? 0);
}

/**
 * Fills one batch of missing search tokens (C8.6).
 *
 * The backfill is deliberately a batch: the table can hold a million
 * rows, and a single statement that rewrote them all would hold the
 * event loop and a lock for minutes. Returns how many rows it wrote.
 */
export async function backfillSearchTokenBatch(
  kind: "records" | "messages",
  limit = 2000,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const table = kind === "records" ? collectedMessages : messages;
  const rows = await db
    .select({ id: table.id, content: table.content, userId: table.userId })
    .from(table)
    .where(isNull(table.searchTokens))
    .limit(Math.max(1, Math.min(20_000, limit)));
  if (rows.length === 0) return 0;
  /**
   * An encrypted row's tokens are written by the enable migration, which
   * has the key. A row that is still ciphertext and has no key here (the
   * account is locked after a restart) is skipped: tokenising the
   * ciphertext would fill the index with noise, and the migration will
   * do it correctly later.
   */
  const writable = rows.filter((row) => {
    if (!encryptsWrites(row.userId)) return true;
    try {
      requireDataKeyForWrite(row.userId);
      return true;
    } catch {
      return false;
    }
  });
  if (writable.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const row of writable) {
      const content = decryptTextForRead(row.userId, row.content) ?? "";
      await tx
        .update(table)
        .set({ searchTokens: searchTokensValueFor(row.userId, content) })
        .where(eq(table.id, row.id));
    }
  });
  return writable.length;
}

/**
 * The rows immediately around some user records, for C8.7.
 *
 * The exemplar scorer needs the user turn in front of each reply and
 * the reply itself. Doing that per candidate would be two hundred
 * queries; this is one query for the rows before and one for the rows
 * after, both filtered by the owner.
 */
export interface RecordWindow {
  candidate: CollectedMessage;
  before: CollectedMessage[];
  after: CollectedMessage[];
}

export async function getWindowsAroundUserRecords(
  ids: number[],
  userId: number,
  options: { before?: number; after?: number; maxGapHours?: number } = {},
): Promise<Map<number, RecordWindow>> {
  const db = await getDb();
  const out = new Map<number, RecordWindow>();
  if (!db || ids.length === 0) return out;
  const before = Math.max(0, Math.min(20, options.before ?? 6));
  const after = Math.max(0, Math.min(20, options.after ?? 8));
  const maxGapHours = Math.max(1, Math.min(48, options.maxGapHours ?? 6));
  const idList = pgTextArrayLiteral([...new Set(ids)].map(String));
  /**
   * The owner filter is in the query, not only in the ids the caller
   * passed: an id from another account must not open a window.
   */
  const candidates = await db
    .select()
    .from(collectedMessages)
    .where(and(inArray(collectedMessages.id, [...new Set(ids)]), eq(collectedMessages.userId, userId)))
    .orderBy(asc(spokenAtColumn()), asc(collectedMessages.id));
  for (const candidate of decryptRows("collected_messages", candidates)) {
    if (candidate.role !== "user") continue;
    out.set(candidate.id, { candidate, before: [], after: [] });
  }
  if (out.size === 0) return out;

  const [beforeRows, afterRows] = await Promise.all([
    before > 0
      ? db.execute(sql`
          SELECT u.id AS "candidateId", m.*
          FROM unnest(${idList}::int[]) AS cid
          JOIN "collected_messages" u
            ON u.id = cid AND u."userId" = ${userId} AND u."role" = 'user'
          JOIN LATERAL (
            SELECT * FROM "collected_messages" b
            WHERE b."personaId" = u."personaId" AND b."userId" = u."userId"
              AND (
                COALESCE(b."timestamp", b."createdAt"),
                b.id
              ) < (
                COALESCE(u."timestamp", u."createdAt"),
                u.id
              )
              AND COALESCE(b."timestamp", b."createdAt")
                >= COALESCE(u."timestamp", u."createdAt") - (${maxGapHours} * interval '1 hour')
            ORDER BY COALESCE(b."timestamp", b."createdAt") DESC, b.id DESC
            LIMIT ${before}
          ) m ON true
          ORDER BY cid, COALESCE(m."timestamp", m."createdAt"), m.id
        `)
      : { rows: [] },
    after > 0
      ? db.execute(sql`
          SELECT u.id AS "candidateId", m.*
          FROM unnest(${idList}::int[]) AS cid
          JOIN "collected_messages" u
            ON u.id = cid AND u."userId" = ${userId} AND u."role" = 'user'
          JOIN LATERAL (
            SELECT * FROM "collected_messages" a
            WHERE a."personaId" = u."personaId" AND a."userId" = u."userId"
              AND (
                COALESCE(a."timestamp", a."createdAt"),
                a.id
              ) > (
                COALESCE(u."timestamp", u."createdAt"),
                u.id
              )
              AND COALESCE(a."timestamp", a."createdAt")
                <= COALESCE(u."timestamp", u."createdAt") + (${maxGapHours} * interval '1 hour')
            ORDER BY COALESCE(a."timestamp", a."createdAt") ASC, a.id ASC
            LIMIT ${after}
          ) m ON true
          ORDER BY cid, COALESCE(m."timestamp", m."createdAt"), m.id
        `)
      : { rows: [] },
  ]);
  const decryptRaw = (rows: Array<Record<string, unknown>>) =>
    decryptRows("collected_messages", rows as unknown as Array<Record<string, unknown> & { userId: number }>);
  for (const row of decryptRaw(beforeRows.rows as Array<Record<string, unknown>>)) {
    const window = out.get(Number(row.candidateId));
    if (window) window.before.push(row as unknown as CollectedMessage);
  }
  for (const row of decryptRaw(afterRows.rows as Array<Record<string, unknown>>)) {
    const window = out.get(Number(row.candidateId));
    if (window) window.after.push(row as unknown as CollectedMessage);
  }
  // The lateral reads each direction newest-first or oldest-first; the
  // caller wants both in the order they were said.
  const spokenAt = (row: CollectedMessage): number => {
    const value = row.timestamp ?? row.createdAt;
    const time = value instanceof Date ? value.getTime() : new Date(value as unknown as string).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  for (const window of out.values()) {
    window.before.sort((a, b) => spokenAt(a) - spokenAt(b) || a.id - b.id);
    window.after.sort((a, b) => spokenAt(a) - spokenAt(b) || a.id - b.id);
  }
  return out;
}

export async function getRecordsByIds(
  ids: number[],
  userId: number,
): Promise<CollectedMessage[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const rows = await db
    .select()
    .from(collectedMessages)
    .where(and(inArray(collectedMessages.id, ids), eq(collectedMessages.userId, userId)))
    .orderBy(asc(spokenAtColumn()), asc(collectedMessages.id));
  return decryptRows("collected_messages", rows);
}

export interface RecordLabelPatch {
  act?: string | null;
  actSource?: string | null;
  emotion?: string | null;
  emotionSource?: string | null;
}

/**
 * Writes a speech-act or emotion label onto one record.
 *
 * Distillation labels in bulk and has to refuse another user's row even
 * when it was handed the id. The owner check belongs in the query.
 */
export async function updateRecordLabels(
  id: number,
  userId: number,
  patch: RecordLabelPatch,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .update(collectedMessages)
    .set(patch)
    .where(and(eq(collectedMessages.id, id), eq(collectedMessages.userId, userId)))
    .returning({ id: collectedMessages.id });
  return Boolean(row);
}

export interface RecordsAround {
  target: CollectedMessage | undefined;
  before: CollectedMessage[];
  after: CollectedMessage[];
}

export async function getRecordsAround(
  recordId: number,
  userId: number,
  before: number,
  after: number,
): Promise<RecordsAround> {
  const db = await getDb();
  if (!db) return { target: undefined, before: [], after: [] };
  const [target] = await db
    .select()
    .from(collectedMessages)
    .where(and(eq(collectedMessages.id, recordId), eq(collectedMessages.userId, userId)))
    .limit(1);
  if (!target) return { target: undefined, before: [], after: [] };
  const spokenAt = spokenAtColumn();
  const earlier =
    before > 0
      ? await db
          .select()
          .from(collectedMessages)
          .where(
            and(
              eq(collectedMessages.personaId, target.personaId),
              eq(collectedMessages.userId, userId),
              sql`(
                ${spokenAt},
                ${collectedMessages.id}
              ) < (
                SELECT COALESCE(c."timestamp", c."createdAt"), c."id"
                FROM "collected_messages" c
                WHERE c."id" = ${target.id}
              )`,
            ),
          )
          .orderBy(desc(spokenAt), desc(collectedMessages.id))
          .limit(before)
      : [];
  const later =
    after > 0
      ? await db
          .select()
          .from(collectedMessages)
          .where(
            and(
              eq(collectedMessages.personaId, target.personaId),
              eq(collectedMessages.userId, userId),
              sql`(
                ${spokenAt},
                ${collectedMessages.id}
              ) > (
                SELECT COALESCE(c."timestamp", c."createdAt"), c."id"
                FROM "collected_messages" c
                WHERE c."id" = ${target.id}
              )`,
            ),
          )
          .orderBy(asc(spokenAt), asc(collectedMessages.id))
          .limit(after)
      : [];
  return {
    target: decryptRowOf("collected_messages", target) as CollectedMessage | undefined,
    before: decryptRows("collected_messages", earlier.reverse()),
    after: decryptRows("collected_messages", later),
  };
}

/** One page of the timeline reader (C2.10). */
export interface RecordPage {
  rows: CollectedMessage[];
  hasOlder: boolean;
  hasNewer: boolean;
}

export interface RecordPageOptions {
  anchor?: { recordId?: number; at?: Date };
  direction: "older" | "newer" | "around";
  limit?: number;
  register?: string;
}

/**
 * A Date as the naive UTC string the column stores.
 *
 * The driver binds a JavaScript Date as a local-time string; comparing
 * that against a `timestamp without time zone` shifted the cursor by
 * the server's offset, so "older than the first line" matched every
 * line and the reader repeated pages. The stored column is UTC, so the
 * cursor is sent the same way.
 */
function naiveUtc(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function recordKeyCondition(comparison: "<" | ">", key: { at: Date; id: number }) {
  return sql`(
    COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt}),
    ${collectedMessages.id}
  ) ${sql.raw(comparison)} (
    ${naiveUtc(key.at)}::timestamp,
    ${key.id}
  )`;
}

/**
 * Pages the record table around an anchor (C2.10).
 *
 * The reader cannot load a hundred thousand lines at once, so this is
 * a keyset page: the time *and* the id make the cursor unique even
 * when two lines were said in the same second.
 */
export async function pageRecords(
  personaId: number,
  userId: number,
  options: RecordPageOptions,
): Promise<RecordPage> {
  const db = await getDb();
  if (!db) return { rows: [], hasOlder: false, hasNewer: false };
  const limit = Math.max(1, Math.min(200, options.limit ?? 200));
  const base = recordsWhere(personaId, userId, { register: options.register ?? "private" });
  const spokenAt = spokenAtColumn();

  let anchorRow: CollectedMessage | undefined;
  if (options.anchor?.recordId != null) {
    const [row] = await db
      .select()
      .from(collectedMessages)
      .where(and(
        eq(collectedMessages.id, options.anchor.recordId),
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
      ))
      .limit(1);
    anchorRow = row;
  } else if (options.anchor?.at) {
    /**
     * "Jump to this date" lands on the last line said at or before the
     * moment, so the anchor line is visible rather than the first line
     * of the next day.
     */
    const [row] = await db
      .select()
      .from(collectedMessages)
      .where(and(base, lte(spokenAt, sql`${naiveUtc(options.anchor.at)}::timestamp`)))
      .orderBy(desc(spokenAt), desc(collectedMessages.id))
      .limit(1);
    anchorRow = row;
  }

  const anchorKey = anchorRow
    ? { at: anchorRow.timestamp ?? anchorRow.createdAt, id: anchorRow.id }
    : null;

  const older = async (key: { at: Date; id: number } | null, count: number) => {
    const query = db
      .select()
      .from(collectedMessages)
      .where(key ? and(base, recordKeyCondition("<", key)) : base)
      .orderBy(desc(spokenAt), desc(collectedMessages.id))
      .limit(count + 1);
    return query;
  };
  const newer = async (key: { at: Date; id: number } | null, count: number) => {
    const query = db
      .select()
      .from(collectedMessages)
      .where(key ? and(base, recordKeyCondition(">", key)) : base)
      .orderBy(asc(spokenAt), asc(collectedMessages.id))
      .limit(count + 1);
    return query;
  };

  if (options.direction === "newer") {
    const rows = await newer(anchorKey, limit);
    const hasNewer = rows.length > limit;
    return {
      rows: decryptRows("collected_messages", rows.slice(0, limit)),
      hasOlder: anchorKey != null,
      hasNewer,
    };
  }

  if (options.direction === "around" && anchorKey && anchorRow) {
    /**
     * The anchor counts as one of the requested lines.
     *
     * The old split read `limit / 2` on each side and then added the
     * anchor, so an even limit returned one line too many (200 ->
     * 201). The reader asks for 200 and must get at most 200.
     */
    const beforeCount = Math.max(0, Math.floor((limit - 1) / 2));
    const afterCount = Math.max(0, limit - 1 - beforeCount);
    const [beforeDesc, afterAsc] = await Promise.all([
      older(anchorKey, beforeCount),
      newer(anchorKey, afterCount),
    ]);
    const hasOlder = beforeDesc.length > beforeCount;
    const hasNewer = afterAsc.length > afterCount;
    const rows = [
      ...beforeDesc.slice(0, beforeCount).reverse(),
      anchorRow,
      ...afterAsc.slice(0, afterCount),
    ];
    return { rows: decryptRows("collected_messages", rows), hasOlder, hasNewer };
  }

  // "older", or "around" with no anchor: the newest page.
  const rowsDesc = await older(anchorKey, limit);
  const hasOlder = rowsDesc.length > limit;
  const rows = rowsDesc.slice(0, limit).reverse();
  return {
    rows: decryptRows("collected_messages", rows),
    hasOlder,
    // With an anchor there are rows at or after it; without one this is
    // the newest page, so there is nothing newer to load.
    hasNewer: anchorKey != null,
  };
}

/**
 * The record count of each month, in the reader's own clock (C2.10).
 *
 * The outline is a list of chapter sizes; reading the whole table to
 * count them would defeat the page-at-a-time reader.
 */
export interface RecordMonthCount {
  month: string;
  count: number;
}

export async function countRecordsByMonth(
  personaId: number,
  userId: number,
  timeZone?: string | null,
  register = "private",
): Promise<RecordMonthCount[]> {
  const db = await getDb();
  if (!db) return [];
  const zone = timeZone && timeZone.trim() ? timeZone.trim() : "UTC";
  const month = sql<string>`to_char(
    (COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt}) AT TIME ZONE 'UTC')
      AT TIME ZONE ${zone},
    'YYYY-MM'
  )`;
  const rows = await db
    .select({ month, c: count() })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
      recordsWhere(personaId, userId, { register }),
    ))
    // The expression is the first select column; grouping by its
    // position avoids the planner reading the raw column as ungrouped.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((row) => ({ month: row.month, count: Number(row.c) }));
}

/** A bookmark or note with the line it points at. */
export interface RecordMarkWithLine extends RecordMark {
  content: string | null;
  timestamp: Date | null;
}

export async function listRecordMarks(
  personaId: number,
  userId: number,
): Promise<RecordMarkWithLine[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: recordMarks.id,
      userId: recordMarks.userId,
      personaId: recordMarks.personaId,
      recordId: recordMarks.recordId,
      kind: recordMarks.kind,
      note: recordMarks.note,
      createdAt: recordMarks.createdAt,
      content: collectedMessages.content,
      timestamp: collectedMessages.timestamp,
    })
    .from(recordMarks)
    .leftJoin(
      collectedMessages,
      and(
        eq(collectedMessages.id, recordMarks.recordId),
        eq(collectedMessages.userId, userId),
        eq(collectedMessages.personaId, personaId),
      ),
    )
    .where(and(eq(recordMarks.personaId, personaId), eq(recordMarks.userId, userId)))
    .orderBy(desc(recordMarks.createdAt));
  return decryptRows("collected_messages", rows);
}

/**
 * Adds or updates one mark.
 *
 * Returns null when the record is not this persona's — the caller is
 * told "not found" rather than being allowed to bookmark another
 * account's line.
 */
export async function upsertRecordMark(
  data: InsertRecordMark,
): Promise<RecordMark | null> {
  const db = await getDb();
  if (!db) return null;
  const [record] = await db
    .select({ id: collectedMessages.id })
    .from(collectedMessages)
    .where(and(
      eq(collectedMessages.id, data.recordId),
      eq(collectedMessages.personaId, data.personaId),
      eq(collectedMessages.userId, data.userId),
    ))
    .limit(1);
  if (!record) return null;
  const [row] = await db
    .insert(recordMarks)
    .values({
      userId: data.userId,
      personaId: data.personaId,
      recordId: data.recordId,
      kind: data.kind,
      note: data.note ?? null,
    })
    .onConflictDoUpdate({
      target: [recordMarks.personaId, recordMarks.userId, recordMarks.recordId, recordMarks.kind],
      set: { note: data.note ?? null },
    })
    .returning();
  return row ?? null;
}

export async function removeRecordMark(
  id: number,
  userId: number,
  personaId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .delete(recordMarks)
    .where(and(
      eq(recordMarks.id, id),
      eq(recordMarks.userId, userId),
      eq(recordMarks.personaId, personaId),
    ))
    .returning({ id: recordMarks.id });
  return rows.length > 0;
}

/** Removes one line of the record. The caller has already checked the persona. */
export async function deleteRecordRow(
  recordId: number,
  personaId: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .delete(collectedMessages)
    .where(and(
      eq(collectedMessages.id, recordId),
      eq(collectedMessages.personaId, personaId),
      eq(collectedMessages.userId, userId),
    ))
    .returning({ id: collectedMessages.id });
  if (rows.length > 0) {
    await db
      .delete(recordMarks)
      .where(and(
        eq(recordMarks.recordId, recordId),
        eq(recordMarks.personaId, personaId),
        eq(recordMarks.userId, userId),
      ));
  }
  return rows.length > 0;
}

export interface RecordReportCache {
  recordsVersion: string;
  report: unknown;
  createdAt: Date;
}

export async function getRecordReportCache(
  personaId: number,
  userId: number,
): Promise<RecordReportCache | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      recordsVersion: recordReports.recordsVersion,
      report: recordReports.report,
      createdAt: recordReports.createdAt,
    })
    .from(recordReports)
    .where(and(
      eq(recordReports.personaId, personaId),
      eq(recordReports.userId, userId),
    ))
    .limit(1);
  return row ?? null;
}

export async function saveRecordReportCache(data: {
  userId: number;
  personaId: number;
  recordsVersion: string;
  report: unknown;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(recordReports)
    .values({
      userId: data.userId,
      personaId: data.personaId,
      recordsVersion: data.recordsVersion,
      report: data.report,
    })
    .onConflictDoUpdate({
      target: [recordReports.personaId, recordReports.userId],
      set: {
        recordsVersion: data.recordsVersion,
        report: data.report,
        createdAt: new Date(),
      },
    });
}

/** The media rows attached to some record lines, for the reader. */
export async function listMediaForRecordIds(
  personaId: number,
  userId: number,
  recordIds: number[],
): Promise<Media[]> {
  const db = await getDb();
  if (!db || recordIds.length === 0) return [];
  return db
    .select()
    .from(media)
    .where(and(
      eq(media.personaId, personaId),
      eq(media.userId, userId),
      inArray(media.recordId, [...new Set(recordIds)]),
    ));
}

export async function deleteRecordsByFile(
  personaId: number,
  userId: number,
  fileId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const deleted = await db
    .delete(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        eq(collectedMessages.fileId, fileId),
      ),
    )
    .returning({ id: collectedMessages.id });
  return deleted.length;
}

/**
 * Deletes one uploaded file's row and the records it brought in.
 *
 * The disk bytes are not touched here — they go after the transaction
 * commits, the same way `purgePersona` waits.
 */
export type DeletedPersonaFile = {
  personaId: number;
  fileKey: string | null;
  originalName: string | null;
  deletedRecords: number;
};

export async function deletePersonaFile(
  fileId: number,
  userId: number,
): Promise<DeletedPersonaFile | null> {
  const file = await getPersonaFileById(fileId, userId);
  if (!file) return null;
  const deletedRecords = await withTransaction(async (tx) => {
    const records = await tx
      .delete(collectedMessages)
      .where(
        and(
          eq(collectedMessages.personaId, file.personaId),
          eq(collectedMessages.userId, userId),
          eq(collectedMessages.fileId, fileId),
        ),
      )
      .returning({ id: collectedMessages.id });
    /**
     * Standalone uploads registered before `fileId` was stored have
     * `fileId: null` but point at the same key. Matching the key as
     * well keeps their row (and the memory links under it) from
     * outliving the bytes the route deletes next.
     */
    const removedMedia = await tx
      .delete(media)
      .where(
        and(
          eq(media.personaId, file.personaId),
          eq(media.userId, userId),
          or(eq(media.fileId, fileId), eq(media.fileKey, file.fileKey)),
        ),
      )
      .returning({ id: media.id });
    if (removedMedia.length > 0) {
      await tx
        .delete(memoryMedia)
        .where(
          and(
            inArray(memoryMedia.mediaId, removedMedia.map((row) => row.id)),
            eq(memoryMedia.userId, userId),
          ),
        );
    }
    await tx
      .delete(personaFiles)
      .where(and(eq(personaFiles.id, fileId), eq(personaFiles.userId, userId)));
    return records.length;
  });
  return {
    personaId: file.personaId,
    fileKey: file.fileKey,
    originalName: file.originalName,
    deletedRecords,
  };
}

export async function deleteRecordsBySource(
  personaId: number,
  userId: number,
  source: string,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const deleted = await db
    .delete(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        eq(collectedMessages.source, source),
      ),
    )
    .returning({ id: collectedMessages.id });
  return deleted.length;
}

export interface RecordSourceSummary {
  source: string;
  fileId: number | null;
  count: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

export async function getRecordSourceSummary(
  personaId: number,
  userId: number,
): Promise<RecordSourceSummary[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      source: collectedMessages.source,
      fileId: collectedMessages.fileId,
      count: count(),
      firstAt: min(collectedMessages.timestamp),
      lastAt: max(collectedMessages.timestamp),
    })
    .from(collectedMessages)
    .where(
      and(eq(collectedMessages.personaId, personaId), eq(collectedMessages.userId, userId)),
    )
    .groupBy(collectedMessages.source, collectedMessages.fileId);
  return rows.map((row) => ({
    source: row.source,
    fileId: row.fileId,
    count: Number(row.count),
    firstAt: row.firstAt,
    lastAt: row.lastAt,
  }));
}

export async function updatePersonaFile(
  id: number,
  userId: number,
  data: Partial<InsertPersonaFile>,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(personaFiles)
    .set(data)
    .where(and(eq(personaFiles.id, id), eq(personaFiles.userId, userId)))
    .returning({ id: personaFiles.id });
  return rows.length > 0;
}

// ─── Collection source helpers ────────────────────────────────────────────



// ─── Collection job helpers ───────────────────────────────────────────────

export async function createCollectionJob(data: InsertCollectionJob) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(collectionJobs).values(data)
    .returning({ id: collectionJobs.id });
  return result.id;
}

/**
 * Writes a job's state, whatever is already there.
 *
 * The row is written by key, so a write that arrives before the row
 * exists — and a write that arrives twice — both land on the same
 * row. The insert used to lose the unique index on the key, and the
 * error was swallowed: the snapshot was lost, and the job the user saw
 * after a restart was an earlier stage of it.
 */
export async function upsertCollectionJob(
  jobKey: string,
  userId: number,
  data: Omit<InsertCollectionJob, "jobKey" | "userId">,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(collectionJobs)
    .values({ jobKey, userId, ...data })
    .onConflictDoUpdate({
      target: collectionJobs.jobKey,
      set: {
        status: data.status,
        progress: data.progress,
        messageCount: data.messageCount,
        foundCount: data.foundCount,
        /**
         * The kept count is written here too.
         *
         * It was not — and the row is INSERTed once, when the job is
         * queued, at which point the count is still zero. Every later
         * snapshot takes the `ON CONFLICT DO UPDATE` branch, whose SET
         * list is what is written — and the kept count was not in it.
         * So the column kept the value it was inserted with: zero.
         *
         * And a job is read from the database as soon as it falls out
         * of the process's memory — which happens after two hundred
         * jobs, and on every restart. So the user saw "found 400,
         * kept 0": the exact self-contradicting sentence the column
         * was added to remove.
         */
        keptCount: data.keptCount,
        truncated: data.truncated,
        error: data.error,
        personaId: data.personaId,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
      },
      // And only the owner's row is written.
      setWhere: sql`${collectionJobs.userId} = ${userId}`,
    });
}

export async function updateCollectionJob(
  id: number,
  userId: number,
  data: Partial<InsertCollectionJob>,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(collectionJobs).set(data)
    .where(and(eq(collectionJobs.id, id), eq(collectionJobs.userId, userId)));
}

/** Looks a collection job up by its stable key, for one user. */
export async function getCollectionJobByKey(jobKey: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(collectionJobs)
    .where(and(eq(collectionJobs.jobKey, jobKey), eq(collectionJobs.userId, userId)))
    .limit(1);
  return rows[0];
}

/** A collection job that is still marked as running. */
export interface RunningCollectionJob {
  id: number;
  userId: number;
}

/**
 * The collection jobs that are still marked as running.
 *
 * The reconciliation after a restart used to look at the twenty newest
 * jobs of everybody: so a job that had been running when the process
 * died stayed "running" for ever, and the interface showed a spinner
 * that never ended — which is exactly what the reconciliation exists to
 * prevent.
 */
export async function getRunningCollectionJobs(): Promise<RunningCollectionJob[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: collectionJobs.id,
    userId: collectionJobs.userId,
  })
    .from(collectionJobs)
    .where(eq(collectionJobs.status, "running"));
  return rows.map((row) => ({ id: row.id, userId: row.userId }));
}

/**
 * A user's collection jobs, newest first.
 *
 * The owner is required: without it, the helper hands back every
 * user's collection jobs — their source, their status and their error
 * text.
 */
/**
 * Forgets the collection jobs that are old.
 *
 * The jobs are mirrored into the database so that they survive a
 * restart — and nothing ever deleted them, so the table grew for the
 * life of the instance. The in-memory store keeps the newest twenty;
 * the database now keeps the same.
 */
export async function pruneCollectionJobs(userId: number, keep = 20): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const old = await db
    .select({ id: collectionJobs.id })
    .from(collectionJobs)
    .where(eq(collectionJobs.userId, userId))
    .orderBy(desc(collectionJobs.createdAt))
    .offset(keep);
  if (old.length === 0) return 0;
  await db
    .delete(collectionJobs)
    .where(
      inArray(
        collectionJobs.id,
        old.map((row) => row.id),
      ),
    );
  return old.length;
}

export async function getCollectionJobs(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(collectionJobs)
    .where(eq(collectionJobs.userId, userId))
    .orderBy(desc(collectionJobs.createdAt))
    .limit(limit);
}

/**
 * One persisted collection job.
 *
 * The job list is read from the database, so a job that survived a
 * restart is in the list — and clicking it returned "not found",
 * because the detail was read from the process's memory. The panel
 * then spun on "loading" for ever.
 */
export async function getCollectionJob(jobKey: string, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select().from(collectionJobs)
    .where(and(
      eq(collectionJobs.jobKey, jobKey),
      eq(collectionJobs.userId, userId),
    ))
    .limit(1);
  return row;
}

// ─── Reminder helpers ──────────────────────────────────────────────────────

/** Personas that may receive proactive reminders. */
export async function getAllPersonasForReminders() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: personas.id,
    userId: personas.userId,
    name: personas.name,
    togetherFrom: personas.togetherFrom,
    togetherTo: personas.togetherTo,
    remindersEnabled: personas.remindersEnabled,
    presence: personas.presence,
    graduationStatus: personas.graduationStatus,
    reachability: personas.reachability,
    /**
     * The day the persona said goodbye (C6.5).
     *
     * The revisit on day 7 and day 30 is counted from it, in the user's
     * calendar.
     */
    graduatedAt: personas.graduatedAt,
    /** The revisit switch and the memorial mode live here. */
    settings: personas.settings,
    // The time zone the reminders are timed in. Without it the scheduler
    // counted the days in the server's calendar, which is not the day the
    // anniversary is.
    timezone: personas.timezone,
  }).from(personas).where(and(
    isNull(personas.deletedAt),
    eq(personas.remindersEnabled, true),
    /**
     * A family member's shared row carries the owner's relationship
     * dates, not their own (C7.2): its anniversaries are the owner's
     * relationship. Reminders about that relationship belong to the
     * owner's row, so the member's copy is left out instead of
     * announcing somebody else's anniversary to them.
     */
    isNull(personas.sharedFromPersonaId),
  ));
}

/**
 * Records a reminder.
 *
 * The unique index on (userId, dedupeKey) is what makes a reminder
 * idempotent: a second attempt to deliver the same reminder is ignored.
 */
export async function recordReminder(data: {
  userId: number;
  personaId: number;
  channel: string;
  kind: string;
  text?: string;
  dedupeKey: string;
  scheduledFor: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const inserted = await db.insert(reminderDeliveries)
    .values({ ...data, deliveredAt: new Date() })
    .onConflictDoNothing();
  return (inserted.rowCount ?? 0) > 0;
}

/**
 * Gives a reminder's slot back.
 *
 * Used when the delivery failed: the slot was claimed before the send,
 * so that two sweeps could not both send, and it has to be released so
 * that the next tick can try again.
 */
export async function forgetReminder(userId: number, dedupeKey: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(reminderDeliveries).where(and(
    eq(reminderDeliveries.userId, userId),
    eq(reminderDeliveries.dedupeKey, dedupeKey),
  ));
}

/**
 * Moves a reminder's claim from a channel to the web.
 *
 * The claim was made for the channel, and the channel delivery failed —
 * so the reminder has to surface in the web client instead. It used to
 * do that by giving the slot back and claiming it again for the web,
 * which is two writes where one will do — and if the first write failed
 * (and its error was swallowed), the second one hit the unique index
 * and did nothing. So the reminder was neither sent nor shown, and the
 * old claim stood for the rest of the day.
 */
export async function moveReminderToWeb(userId: number, dedupeKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(reminderDeliveries)
    .set({ channel: "web" })
    .where(and(
      eq(reminderDeliveries.userId, userId),
      eq(reminderDeliveries.dedupeKey, dedupeKey),
    ))
    .returning({ id: reminderDeliveries.id });
  return rows.length > 0;
}

/** Whether a reminder with this dedupe key has already been delivered. */
export async function hasReminderDelivery(userId: number, dedupeKey: string) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: reminderDeliveries.id })
    .from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      eq(reminderDeliveries.dedupeKey, dedupeKey),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * The reminders that are waiting for the reader on the web.
 *
 * Only the ones that were delivered on the web. A reminder that went out
 * on WeChat or Feishu was delivered there — the user read it in the app
 * they had open — and it used to turn up in the web lobby as well, so
 * the same anniversary showed up twice: once in the conversation and
 * once in the hall, with nothing to say which one was the real one.
 */
export async function getActiveReminders(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(reminderDeliveries)
    .where(and(
      eq(reminderDeliveries.userId, userId),
      eq(reminderDeliveries.channel, "web"),
      sql`${reminderDeliveries.dismissedAt} IS NULL`,
    ))
    .orderBy(desc(reminderDeliveries.deliveredAt)).limit(limit);
}

/**
 * Dismisses a reminder.
 *
 * It says whether a row was actually changed — see `deleteWechatBinding`.
 */
export async function dismissReminder(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(reminderDeliveries).set({ dismissedAt: new Date() })
    .where(and(eq(reminderDeliveries.id, id), eq(reminderDeliveries.userId, userId)))
    .returning({ id: reminderDeliveries.id });
  return rows.length > 0;
}

// ─── Memory recall helpers ─────────────────────────────────────────────────

/** Records that a memory was surfaced, so repeats can be damped. */
export async function touchMemoryRecalled(id: number, userId: number, at: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(memories).set({ lastRecalledAt: at })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

// ─── Message window helpers ────────────────────────────────────────────────

/** Messages for a persona within a time window, oldest first. */
export async function getMessagesSince(
  personaId: number,
  userId: number,
  since: Date,
  limit?: number,
  role?: "user" | "assistant",
) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
    metadata: messages.metadata,
    origin: messages.origin,
  }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, since),
      // The role, when the caller names one.
      //
      // The window is read whole otherwise — and the reader that wants
      // only the user's turns had to fetch the persona's answers too,
      // only to throw them away.
      role ? eq(messages.role, role) : undefined,
    ))
    .orderBy(asc(messages.createdAt));
  // The newest messages are the ones that matter when the window is
  // larger than the ceiling.
  const rows = await (limit === undefined ? query : query.limit(limit));
  return decryptRows("messages", rows);
}

/**
 * The newest messages of a persona, oldest first.
 *
 * "The last N messages" is a different thing from "the first N
 * messages of a window": the second is the beginning of the window,
 * which is old news by the time the reader looks at it. So the window
 * is read backwards and turned round again.
 */
export async function getRecentMessages(
  personaId: number,
  userId: number,
  since: Date,
  limit: number,
  role?: "user" | "assistant",
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: messages.id,
    role: messages.role,
    content: messages.content,
    createdAt: messages.createdAt,
  }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, since),
      role ? eq(messages.role, role) : undefined,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  // The caller reads it as a conversation, so it is turned round.
  return decryptRows("messages", rows).reverse();
}

/** The timestamp of the most recent message, used for session-duration checks. */
export async function getLastMessageAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ createdAt: messages.createdAt }).from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(1);
  return rows[0]?.createdAt;
}

/**
 * When the *user* last spoke to this persona.
 *
 * The plain "last message" is the last message of any kind — and after
 * the app has spoken first, that is the app's own message. So the
 * persona that said "ten days without a word from you" said it once,
 * and every message after it counted from itself: "zero days", while
 * the user had still not said a word.
 */
export async function getLastUserMessageAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ createdAt: messages.createdAt }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
    ))
    .orderBy(desc(messages.createdAt)).limit(1);
  return rows[0]?.createdAt;
}


/**
 * Counts the messages the *user* sent since a point in time.
 *
 * The plain message count includes the persona's replies, so "five
 * messages a day" was really about three conversations — the threshold
 * fired at half the rate it was written for.
 */
export async function getUserMessageCountSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return 0;
  const [result] = await db.select({ c: count() }).from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ));
  return result?.c || 0;
}

/**
 * The number of messages the user sent on each of the last N days.
 *
 * Only the user's own messages count: a conversation is one turn from
 * them, not two rows in the table.
 */
export async function getDailyUserChatCounts(userId: number, days = 30, timezone?: string | null) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  // The shift is in minutes: an interval in hours cannot carry the half
  // hour that India, Adelaide, Kathmandu and Chatham are on, and a
  // rounded shift put the user's day boundary out by up to forty-five
  // minutes.
  const day = userDayColumn(timezone);
  const rows = await db.select({
    date: day,
    count: count(),
  })
    .from(messages)
    .where(and(
      isNull(messages.deletedAt),
      eq(messages.userId, userId),
      eq(messages.role, "user"),
      gte(messages.createdAt, since),
    ))
    .groupBy(day);
  return rows;
}

/**
 * When the current conversation session began.
 *
 * A session is a run of messages with no long silence in it. The previous
 * "long session" check measured the gap between the last two messages, so
 * a five-hour conversation never tripped it while a user who came back
 * after three hours away tripped it immediately — the opposite of what the
 * signal is for.
 */
export async function getSessionStartAt(
  personaId: number,
  userId: number,
  maxGapMs = 30 * 60 * 1000,
  lookback = 200,
): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt))
    .limit(lookback);
  if (rows.length === 0) return null;

  let oldest = rows[0].createdAt;
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i - 1].createdAt.getTime() - rows[i].createdAt.getTime();
    if (gap > maxGapMs) break;
    oldest = rows[i].createdAt;
  }
  return oldest;
}

// ─── Fidelity evaluation ────────────────────────────────────────────────────

/**
 * Replaces the held-out cases for a persona.
 *
 * They are replaced rather than appended: the cases are cut from the
 * records, so re-cutting after a new import would otherwise leave the
 * old ones behind, scored against a persona that has since changed.
 */
export async function saveEvalCases(
  personaId: number,
  userId: number,
  cases: Array<{
    context: unknown;
    expected: unknown;
    expectedState?: string | null;
    expectedAct?: string | null;
    expectedActSource?: string | null;
    source?: string;
    occurredAt?: Date | null;
    periodId?: string | null;
  }>,
) {
  const db = await getDb();
  if (!db) return 0;
  if (!cases.length) {
    await db.delete(evalCases).where(and(
      eq(evalCases.personaId, personaId),
      eq(evalCases.userId, userId),
    ));
    return 0;
  }
  // The delete and the insert are one thing, not two: a failure between
  // them would leave the persona with no cases at all, and the ruler
  // would have nothing to measure.
  return withTransaction(async (tx) => {
    await tx.delete(evalCases).where(and(
      eq(evalCases.personaId, personaId),
      eq(evalCases.userId, userId),
    ));
    await tx.insert(evalCases).values(cases.map((c) => ({
      userId,
      personaId,
      contextJson: c.context,
      expectedJson: c.expected,
      expectedState: c.expectedState ?? null,
      expectedAct: c.expectedAct ?? null,
      expectedActSource: c.expectedActSource ?? null,
      source: c.source ?? "collected",
      occurredAt: c.occurredAt ?? null,
      periodId: c.periodId ?? null,
    })));
    return cases.length;
  });
}

/** The held-out cases for a persona, oldest first. */
export async function getEvalCases(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(evalCases).where(and(
    eq(evalCases.personaId, personaId),
    eq(evalCases.userId, userId),
  )).orderBy(asc(evalCases.id));
}

/**
 * Records a run of the evaluation.
 *
 * The snapshot matters: a run is only meaningful next to the persona
 * that produced it, and the persona changes.
 */
/**
 * How many runs of the evaluation are kept for a persona.
 *
 * Every run stores a full snapshot of the persona, so the table grew
 * for ever — and nothing ever pruned it, unlike the collector's jobs.
 */
const MAX_EVAL_RUNS_PER_PERSONA = 20;

export async function saveEvalRun(
  personaId: number,
  userId: number,
  metrics: unknown,
  personaSnapshot?: unknown,
) {
  const db = await getDb();
  if (!db) return undefined;
  const [result] = await db.insert(evalRuns).values({
    userId,
    personaId,
    metricsJson: metrics,
    personaSnapshot: personaSnapshot ?? null,
  }).returning({ id: evalRuns.id });

  /**
   * The old runs go.
   *
   * They are pruned after the new one is written, so the run that was
   * just made is never the one that is removed.
   */
  const old = await db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(and(eq(evalRuns.personaId, personaId), eq(evalRuns.userId, userId)))
    .orderBy(desc(evalRuns.id))
    // One more than the limit: the surplus is the tail of this list.
    .limit(MAX_EVAL_RUNS_PER_PERSONA + 1);
  const surplus = old.slice(MAX_EVAL_RUNS_PER_PERSONA);
  if (surplus.length > 0) {
    await db
      .delete(evalRuns)
      .where(
        inArray(
          evalRuns.id,
          surplus.map((row) => row.id),
        ),
      )
      .catch(() => undefined);
  }

  return result.id;
}

/** The most recent run of the evaluation for a persona. */
/**
 * The last runs, newest first.
 *
 * Only the newest was exposed — so the comparison the panel exists for
 * ("with the rules" against "without them") could not be made: the
 * toggle changed what the *next* run measured, and the four numbers on
 * screen were whichever run happened to be last.
 */
export async function getEvalRuns(personaId: number, userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(evalRuns).where(and(
    eq(evalRuns.personaId, personaId),
    eq(evalRuns.userId, userId),
  )).orderBy(desc(evalRuns.createdAt)).limit(limit);
}

export async function getLatestEvalRun(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(evalRuns).where(and(
    eq(evalRuns.personaId, personaId),
    eq(evalRuns.userId, userId),
  )).orderBy(desc(evalRuns.id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Stores how this persona behaves over time.
 *
 * The profile is what makes the waiting theirs rather than the app's,
 * so it is kept on the persona next to everything else that describes
 * them.
 */
export async function setPersonaBehaviorProfile(
  personaId: number,
  userId: number,
  profile: unknown,
) {
  const db = await getDb();
  if (!db) return;
  await db.update(personas).set({ behaviorProfile: profile ?? null }).where(and(
    eq(personas.id, personaId),
    eq(personas.userId, userId),
  ));
}

/** How this persona behaves over time, as measured. */
export async function getPersonaBehaviorProfile(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ behaviorProfile: personas.behaviorProfile }).from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  return rows[0]?.behaviorProfile ?? null;
}

/**
 * The sixth-stage switches for this persona.
 *
 * Missing means every default. A row that is not the caller's returns
 * null, the same way the other persona helpers do.
 */
export async function getPersonaSettings(
  personaId: number,
  userId: number,
): Promise<PersonaSettings | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ settings: personas.settings })
    .from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  return normalizePersonaSettings(rows[0].settings);
}

export async function setPersonaSettings(
  personaId: number,
  userId: number,
  settings: PersonaSettings,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const rows = await db
    .update(personas)
    .set({ settings: normalizePersonaSettings(settings) })
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

/** The measurements taken from this persona's records. */
export async function getPersonaStyleProfile(
  personaId: number,
  userId: number,
): Promise<StyleProfile | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ styleProfile: personas.styleProfile })
    .from(personas)
    .where(and(isNull(personas.deletedAt), eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  if (rows[0].styleProfile == null) return null;
  return normalizeStyleProfile(decryptJsonForRead(userId, rows[0].styleProfile));
}

export async function setPersonaStyleProfile(
  personaId: number,
  userId: number,
  profile: StyleProfile,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(personas)
    .set(encryptWriteValues("personas", userId, { styleProfile: normalizeStyleProfile(profile) }))
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

/**
 * `${count}:${maxId}` of the collected records.
 *
 * The style profile uses this to decide whether the measurements are
 * still for the records that are in the table.
 */
export async function getRecordsVersion(personaId: number, userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "0:0";
  const [row] = await db
    .select({
      n: count(),
      maxId: max(collectedMessages.id),
    })
    .from(collectedMessages)
    .where(
      and(eq(collectedMessages.personaId, personaId), eq(collectedMessages.userId, userId)),
    );
  return `${Number(row?.n ?? 0)}:${Number(row?.maxId ?? 0)}`;
}

// ─── The way out ────────────────────────────────────────────────────────────

/**
 * Saves a letter the user is taking back to the real person.
 *
 * The text is the user's own words, copied exactly. Nothing here is
 * ever written by the app on their behalf.
 */
export async function createOutboundLetter(data: {
  userId: number;
  personaId: number;
  text: string;
  sourceMessageId?: number | null;
  status?: string;
}) {
  const db = await getDb();
  if (!db) return undefined;
  /**
   * The second copy of a sentence is not written.
   *
   * The router reads the list first and skips the lines that are
   * already on it — and a read is a read: two collects at once (a
   * double-click, two tabs) both read the same list, both decided the
   * message was new, and both inserted. That list exists so the user
   * can take their own words back, and twice is not a gift.
   *
   * So the database refuses the second copy, and the id comes back
   * undefined — which is how the caller knows nothing was written.
   */
  const [result] = await db
    .insert(outboundLetters)
    .values(encryptWriteValues("outbound_letters", data.userId, {
      userId: data.userId,
      personaId: data.personaId,
      text: data.text,
      sourceMessageId: data.sourceMessageId ?? null,
      status: data.status ?? "draft",
    }))
    .onConflictDoNothing()
    .returning({ id: outboundLetters.id });
  return result?.id;
}

/** The letters this user is taking back, newest first. */
export async function getOutboundLetters(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(outboundLetters).where(and(
    eq(outboundLetters.personaId, personaId),
    eq(outboundLetters.userId, userId),
  )).orderBy(desc(outboundLetters.id));
  return decryptRows("outbound_letters", rows);
}

/**
 * Moves a letter along: sent, or never mind.
 *
 * Both are recorded rather than deleted, because "I said it" and "I
 * decided not to" are the two endings worth remembering, and neither of
 * them is a failure.
 */
export async function setOutboundLetterStatus(
  id: number,
  userId: number,
  status: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  // The row count comes back so the caller can tell "done" from "there
  // was nothing there". A procedure that answers "yes" to a letter that
  // does not exist is a small lie, and the interface would show it.
  const rows = await db.update(outboundLetters).set({
    status,
    updatedAt: now,
    ...(status === "sent" ? { sentAt: now } : {}),
    ...(status === "dropped" ? { droppedAt: now } : {}),
  }).where(and(eq(outboundLetters.id, id), eq(outboundLetters.userId, userId)))
    .returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/**
 * Records that the letter was pointed out for having waited too long.
 *
 * The reminder is said once. The record is what makes "once" true
 * across sessions — without it the page would say it again every time
 * it was opened, and a reminder that repeats is a nag.
 */
export async function markOutboundLetterStaleNotified(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters)
    .set({ staleNotifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(outboundLetters.id, id), eq(outboundLetters.userId, userId)))
    .returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/**
 * Brings a letter back from "never mind".
 *
 * The words were never thrown away — the letter is recorded as one
 * the user decided not to say, and it stays in the list with its text
 * — so the decision has to be reversible. Otherwise the user is shown
 * their own words with no way to act on them again.
 */
export async function restoreOutboundLetter(
  id: number,
  userId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  /**
   * Only a letter that was dropped comes back.
   *
   * The update had no status filter, so it restored *any* letter — and
   * a letter the user had already marked as said could be flipped back
   * to "ready": the badge changed from "already said" to "ready to
   * take", the "I said it" button came back, and the row said at the
   * same time that it had been sent and that it had not.
   *
   * And the `sentAt` was left behind — so the row still claimed to have
   * been sent.
   */
  const rows = await db.update(outboundLetters)
    .set({
      status: "ready",
      droppedAt: null,
      sentAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(outboundLetters.id, id),
      eq(outboundLetters.userId, userId),
      eq(outboundLetters.status, "dropped"),
    ))
    .returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/** Changes the text of a letter the user is taking back. */
export async function updateOutboundLetterText(
  id: number,
  userId: number,
  text: string,
  assisted = false,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters).set(encryptWriteValues("outbound_letters", userId, {
    text,
    updatedAt: new Date(),
    // Only an adopted suggestion marks the sentence as assisted. Saving
    // a letter the user wrote themselves leaves the flag alone.
    ...(assisted ? { wordingAssisted: true } : {}),
  })).where(and(
    eq(outboundLetters.id, id),
    eq(outboundLetters.userId, userId),
  )).returning({ id: outboundLetters.id });
  return rows.length > 0;
}

/** One letter of the caller's own (C3.5). */
export async function getOutboundLetterById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(outboundLetters).where(and(
    eq(outboundLetters.id, id),
    eq(outboundLetters.userId, userId),
  )).limit(1);
  return decryptRowOf("outbound_letters", rows[0]) ?? null;
}

/**
 * Records how it went after the user said it (C3.5).
 *
 * The note is optional and it is the user's own words, so it is stored
 * exactly as written. A letter that is not the caller's, or is not marked
 * as said, gets nothing written.
 */
export async function setOutboundLetterOutcome(
  id: number,
  userId: number,
  note: string,
  at: Date,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters).set(encryptWriteValues("outbound_letters", userId, {
    outcomeNote: note,
    outcomeAt: at,
    updatedAt: at,
  })).where(and(
    eq(outboundLetters.id, id),
    eq(outboundLetters.userId, userId),
    eq(outboundLetters.status, "sent"),
  )).returning({ id: outboundLetters.id });
  return rows.length > 0;
}

// ─── The rehearsal room ────────────────────────────────────────────────────

/** One rehearsal, stored with its result so the page can list it again. */
export async function createRehearsal(data: {
  userId: number;
  personaId: number;
  line: string;
  result: unknown;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.insert(rehearsals).values(encryptWriteValues("rehearsals", data.userId, {
    userId: data.userId,
    personaId: data.personaId,
    line: data.line,
    result: data.result as any,
  })).returning({ id: rehearsals.id });
  return row?.id;
}

/** The rehearsals of one persona, newest first. */
export async function listRehearsals(personaId: number, userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(rehearsals).where(and(
    eq(rehearsals.personaId, personaId),
    eq(rehearsals.userId, userId),
  )).orderBy(desc(rehearsals.id)).limit(Math.max(1, Math.min(200, limit)));
  return decryptRows("rehearsals", rows);
}

export async function getRehearsalById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(rehearsals).where(and(
    eq(rehearsals.id, id),
    eq(rehearsals.userId, userId),
  )).limit(1);
  return decryptRowOf("rehearsals", rows[0]) ?? null;
}

/** Remembers which way-out letter a rehearsal's line was kept as. */
export async function setRehearsalOutboundLetter(
  id: number,
  userId: number,
  outboundLetterId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(rehearsals).set({ outboundLetterId }).where(and(
    eq(rehearsals.id, id),
    eq(rehearsals.userId, userId),
  )).returning({ id: rehearsals.id });
  return rows.length > 0;
}

export async function deleteRehearsal(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(rehearsals).where(and(
    eq(rehearsals.id, id),
    eq(rehearsals.userId, userId),
  )).returning({ id: rehearsals.id });
  return rows.length > 0;
}

/** How many rehearsals the user has run since an instant (the daily cap). */
export async function countRehearsalsSince(userId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: count() }).from(rehearsals).where(and(
    eq(rehearsals.userId, userId),
    gte(rehearsals.createdAt, since),
  ));
  return Number(row?.n ?? 0);
}

// ─── After a conversation ──────────────────────────────────────────────────

/** One answer about one session. The unique key refuses the second. */
export async function createSessionCheckin(data: {
  userId: number;
  personaId: number;
  sessionStartAt: Date;
  answer: string;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.insert(sessionCheckins).values({
    userId: data.userId,
    personaId: data.personaId,
    sessionStartAt: data.sessionStartAt,
    answer: data.answer,
  }).onConflictDoNothing().returning({ id: sessionCheckins.id });
  return row?.id;
}

export async function getSessionCheckin(
  userId: number,
  personaId: number,
  sessionStartAt: Date,
) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sessionCheckins).where(and(
    eq(sessionCheckins.userId, userId),
    eq(sessionCheckins.personaId, personaId),
    eq(sessionCheckins.sessionStartAt, sessionStartAt),
  )).limit(1);
  return rows[0] ?? null;
}

/** Whether the user was already asked today, for any persona. */
export async function countCheckinsSince(userId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: count() }).from(sessionCheckins).where(and(
    eq(sessionCheckins.userId, userId),
    gte(sessionCheckins.createdAt, since),
  ));
  return Number(row?.n ?? 0);
}

/**
 * Records that the after-chat question was shown (C4.2).
 *
 * The row is the difference between "asked" and "answered". It is
 * upserted on the session so the same session is never asked twice; the
 * update keeps `promptedAt` at the latest asking, which is what the
 * once-a-day check reads.
 */
export async function createSessionCheckinPrompt(data: {
  userId: number;
  personaId: number;
  sessionStartAt: Date;
  promptedAt?: Date;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const promptedAt = data.promptedAt ?? new Date();
  const [row] = await db.insert(sessionCheckinPrompts).values({
    userId: data.userId,
    personaId: data.personaId,
    sessionStartAt: data.sessionStartAt,
    promptedAt,
  }).onConflictDoUpdate({
    target: [
      sessionCheckinPrompts.userId,
      sessionCheckinPrompts.personaId,
      sessionCheckinPrompts.sessionStartAt,
    ],
    set: { promptedAt },
  }).returning({ id: sessionCheckinPrompts.id });
  return row?.id;
}

/** Whether this session's question has already been put on screen. */
export async function getSessionCheckinPrompt(
  userId: number,
  personaId: number,
  sessionStartAt: Date,
) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sessionCheckinPrompts).where(and(
    eq(sessionCheckinPrompts.userId, userId),
    eq(sessionCheckinPrompts.personaId, personaId),
    eq(sessionCheckinPrompts.sessionStartAt, sessionStartAt),
  )).limit(1);
  return rows[0] ?? null;
}

/** How many questions were put on screen for this user since an instant. */
export async function countCheckinPromptsSince(userId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: count() }).from(sessionCheckinPrompts).where(and(
    eq(sessionCheckinPrompts.userId, userId),
    gte(sessionCheckinPrompts.promptedAt, since),
  ));
  return Number(row?.n ?? 0);
}

/**
 * The most recent answers for one persona, newest first.
 *
 * The three-worse-in-a-row rule and the graduation veto both read this;
 * `skipped` is dropped before the streak is counted, because not
 * answering is not the same as answering "fine". `since` is optional so
 * the graduation veto can keep the manual's "last three answers" rule
 * while the pause card uses a fourteen-day window.
 */
export async function getRecentCheckinAnswers(
  userId: number,
  personaId: number,
  limit = 20,
  since?: Date | null,
) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ answer: sessionCheckins.answer, createdAt: sessionCheckins.createdAt })
    .from(sessionCheckins)
    .where(and(
      eq(sessionCheckins.userId, userId),
      eq(sessionCheckins.personaId, personaId),
      ...(since ? [gte(sessionCheckins.createdAt, since)] : []),
    ))
    .orderBy(desc(sessionCheckins.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
}

/** How many messages the user wrote since an instant. */
export async function countUserMessagesSince(
  personaId: number,
  userId: number,
  since: Date,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: count() }).from(messages).where(and(
    isNull(messages.deletedAt),
    eq(messages.personaId, personaId),
    eq(messages.userId, userId),
    eq(messages.role, "user"),
    gte(messages.createdAt, since),
  ));
  return Number(row?.n ?? 0);
}

// ─── The user's own diary ──────────────────────────────────────────────────

export async function createJournalEntry(data: {
  userId: number;
  personaId?: number | null;
  body: string;
  mood?: string | null;
  entryDate: string;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  const [row] = await db.insert(userJournal).values(encryptWriteValues("user_journal", data.userId, {
    userId: data.userId,
    personaId: data.personaId ?? null,
    body: data.body,
    mood: data.mood ?? null,
    entryDate: data.entryDate,
    createdAt: now,
    updatedAt: now,
  })).returning({ id: userJournal.id });
  return row?.id;
}

/** One page of the user's own entries, newest day first. */
export async function listJournalEntries(params: {
  userId: number;
  personaId?: number | null;
  cursor?: number | null;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.max(1, Math.min(100, params.limit ?? 30));
  const rows = await db.select().from(userJournal).where(and(
    eq(userJournal.userId, params.userId),
    ...(params.personaId != null ? [eq(userJournal.personaId, params.personaId)] : []),
    ...(params.cursor != null ? [lt(userJournal.id, params.cursor)] : []),
  )).orderBy(desc(userJournal.entryDate), desc(userJournal.id)).limit(limit);
  return decryptRows("user_journal", rows);
}

/** All of them, for the export. */
export async function getUserJournal(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(userJournal)
    .where(eq(userJournal.userId, userId))
    .orderBy(desc(userJournal.entryDate), desc(userJournal.id));
  return decryptRows("user_journal", rows);
}

export async function getJournalEntryById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userJournal).where(and(
    eq(userJournal.id, id),
    eq(userJournal.userId, userId),
  )).limit(1);
  return decryptRowOf("user_journal", rows[0]) ?? null;
}

export async function updateJournalEntry(
  id: number,
  userId: number,
  patch: { body?: string; mood?: string | null; entryDate?: string },
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(userJournal).set(encryptWriteValues("user_journal", userId, {
    ...(patch.body !== undefined ? { body: patch.body } : {}),
    ...(patch.mood !== undefined ? { mood: patch.mood } : {}),
    ...(patch.entryDate !== undefined ? { entryDate: patch.entryDate } : {}),
    updatedAt: new Date(),
  })).where(and(
    eq(userJournal.id, id),
    eq(userJournal.userId, userId),
  )).returning({ id: userJournal.id });
  return rows.length > 0;
}

export async function deleteJournalEntry(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.delete(userJournal).where(and(
    eq(userJournal.id, id),
    eq(userJournal.userId, userId),
  )).returning({ id: userJournal.id });
  return rows.length > 0;
}

/**
 * The answers after conversations since a moment, for the wellbeing
 * trend (C4.3). Newest first.
 */
export async function listCheckinAnswersSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    personaId: sessionCheckins.personaId,
    answer: sessionCheckins.answer,
    createdAt: sessionCheckins.createdAt,
  }).from(sessionCheckins)
    .where(and(eq(sessionCheckins.userId, userId), gte(sessionCheckins.createdAt, since)))
    .orderBy(desc(sessionCheckins.createdAt));
}

/** The user's own message times since a moment (C4.3). */
export async function listUserMessageTimesSince(userId: number, since: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ at: messages.createdAt }).from(messages)
    .where(and(isNull(messages.deletedAt), eq(messages.userId, userId), eq(messages.role, "user"), gte(messages.createdAt, since)))
    .orderBy(asc(messages.createdAt));
}

// ─── The role swap ─────────────────────────────────────────────────────────

export async function createRoleplaySession(data: {
  userId: number;
  personaId: number;
  startedAt: Date;
}) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.insert(roleplaySessions).values(encryptWriteValues("roleplay_sessions", data.userId, {
    userId: data.userId,
    personaId: data.personaId,
    startedAt: data.startedAt,
    turns: 0,
    transcript: [],
  })).returning({ id: roleplaySessions.id });
  return row?.id;
}

export async function getRoleplaySession(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(roleplaySessions).where(and(
    eq(roleplaySessions.id, id),
    eq(roleplaySessions.userId, userId),
  )).limit(1);
  return decryptRowOf("roleplay_sessions", rows[0]) ?? null;
}

/** How many practices the user has started since an instant. */
export async function countRoleplaySessionsSince(
  userId: number,
  since: Date,
  personaId?: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ n: count() }).from(roleplaySessions).where(and(
    eq(roleplaySessions.userId, userId),
    ...(personaId !== undefined ? [eq(roleplaySessions.personaId, personaId)] : []),
    gte(roleplaySessions.createdAt, since),
  ));
  return Number(row?.n ?? 0);
}

export async function updateRoleplaySession(
  id: number,
  userId: number,
  patch: { turns?: number; transcript?: unknown; endedAt?: Date | null },
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(roleplaySessions).set(encryptWriteValues("roleplay_sessions", userId, {
    ...(patch.turns !== undefined ? { turns: patch.turns } : {}),
    ...(patch.transcript !== undefined ? { transcript: patch.transcript as any } : {}),
    ...(patch.endedAt !== undefined ? { endedAt: patch.endedAt } : {}),
  })).where(and(
    eq(roleplaySessions.id, id),
    eq(roleplaySessions.userId, userId),
  )).returning({ id: roleplaySessions.id });
  return rows.length > 0;
}

// ─── Distillation blocks and cards ────────────────────────────────────────

export async function createDistillationChunk(data: InsertDistillationChunk) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .insert(distillationChunks)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: distillationChunks.id });
  return row?.id;
}

export async function createDistillationCard(data: InsertDistillationCard) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .insert(distillationCards)
    .values(data)
    .returning({ id: distillationCards.id });
  return row?.id;
}

export async function listDistillationChunks(
  personaId: number,
  userId: number,
  phase?: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(distillationChunks)
    .where(
      and(
        eq(distillationChunks.personaId, personaId),
        eq(distillationChunks.userId, userId),
        ...(phase ? [eq(distillationChunks.phase, phase)] : []),
      ),
    );
}

export async function listDistillationCards(
  personaId: number,
  userId: number,
  options: { kind?: string; chunkHash?: string } = {},
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(distillationCards)
    .where(
      and(
        eq(distillationCards.personaId, personaId),
        eq(distillationCards.userId, userId),
        ...(options.kind ? [eq(distillationCards.kind, options.kind)] : []),
        ...(options.chunkHash ? [eq(distillationCards.chunkHash, options.chunkHash)] : []),
      ),
    );
}

/**
 * Drops cards whose block is no longer in this cut.
 *
 * The last block's hash changes when new lines arrive. Its old cards
 * are then cited by nothing, and a later merge that read every stored
 * card would mix them back in.
 */
export async function deleteOrphanDistillationCards(
  personaId: number,
  userId: number,
  keepHashes: string[],
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (keepHashes.length === 0) return 0;
  const rows = await db
    .delete(distillationCards)
    .where(
      and(
        eq(distillationCards.personaId, personaId),
        eq(distillationCards.userId, userId),
        notInArray(distillationCards.chunkHash, keepHashes),
      ),
    )
    .returning({ id: distillationCards.id });
  return rows.length;
}

// ─── Persona versions ──────────────────────────────────────────────────────

/**
 * How many snapshots of a persona are kept.
 *
 * Distillation, a full edit, a correction, and a restore each store
 * one. Without a cap the table grew for every small save, and nothing
 * pruned it.
 */
export const MAX_PERSONA_VERSIONS = 20;

/**
 * Stores the persona as it is now, before the next write.
 *
 * The snapshot is the four columns that make the persona: its own
 * fields, the measurements, the behaviour, and the switches. A later
 * restore writes those four back as a set.
 */
export async function createPersonaVersion(
  personaId: number,
  userId: number,
  reason: string,
): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const persona = await getPersonaById(personaId, userId);
  if (!persona) return undefined;
  const [row] = await db
    .insert(personaVersions)
    .values(encryptWriteValues("persona_versions", userId, {
      userId,
      personaId,
      reason,
      personaData: persona.personaData,
      styleProfile: persona.styleProfile,
      behaviorProfile: persona.behaviorProfile,
      settings: persona.settings,
    }))
    .returning({ id: personaVersions.id });
  await prunePersonaVersions(personaId, userId);
  return row?.id;
}

/** The snapshots of a persona, newest first. */
export async function listPersonaVersions(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.personaId, personaId),
        eq(personaVersions.userId, userId),
      ),
    )
    .orderBy(desc(personaVersions.id));
  return decryptRows("persona_versions", rows);
}

/** One snapshot, scoped to its owner. */
export async function getPersonaVersion(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(personaVersions)
    .where(and(eq(personaVersions.id, id), eq(personaVersions.userId, userId)))
    .limit(1);
  return decryptRowOf("persona_versions", rows[0]) ?? undefined;
}

/** The newest snapshot of a persona. */
export async function getLatestPersonaVersion(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.personaId, personaId),
        eq(personaVersions.userId, userId),
      ),
    )
    .orderBy(desc(personaVersions.id))
    .limit(1);
  return decryptRowOf("persona_versions", rows[0]) ?? undefined;
}

/**
 * Drops every snapshot older than the twenty that are kept.
 *
 * Newest is by id: several writes in the same second share a
 * `createdAt`, and id is the order they were taken.
 */
export async function prunePersonaVersions(
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ id: personaVersions.id })
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.personaId, personaId),
        eq(personaVersions.userId, userId),
      ),
    )
    .orderBy(desc(personaVersions.id));
  const surplus = rows.slice(MAX_PERSONA_VERSIONS);
  if (surplus.length === 0) return 0;
  const deleted = await db
    .delete(personaVersions)
    .where(
      and(
        eq(personaVersions.userId, userId),
        inArray(
          personaVersions.id,
          surplus.map((row) => row.id),
        ),
      ),
    )
    .returning({ id: personaVersions.id });
  return deleted.length;
}

/** Hangs a later evaluation run on this snapshot. */
export async function setPersonaVersionEvalRun(
  id: number,
  userId: number,
  evalRunId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(personaVersions)
    .set({ evalRunId })
    .where(and(eq(personaVersions.id, id), eq(personaVersions.userId, userId)))
    .returning({ id: personaVersions.id });
  return rows.length > 0;
}

/** Open a sitting of the blind test. */
export async function createBlindSession(data: InsertBlindSession) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(blindSessions).values(data).returning();
  return row;
}

/** One sitting, scoped to its owner. */
export async function getBlindSession(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(blindSessions)
    .where(and(eq(blindSessions.id, id), eq(blindSessions.userId, userId)))
    .limit(1);
  return rows[0];
}

/** The sittings of a persona, newest first. */
export async function listBlindSessions(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(blindSessions)
    .where(and(eq(blindSessions.personaId, personaId), eq(blindSessions.userId, userId)))
    .orderBy(desc(blindSessions.id));
}

/** Write answers, the invite hash, or the summary of a sitting. */
export async function updateBlindSession(
  id: number,
  userId: number,
  patch: Partial<{
    groups: unknown;
    answers: unknown;
    summary: unknown;
    tokenHash: string | null;
    expiresAt: Date | null;
    finishedAt: Date | null;
  }>,
) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .update(blindSessions)
    .set(patch)
    .where(and(eq(blindSessions.id, id), eq(blindSessions.userId, userId)))
    .returning();
  return row;
}

/**
 * A sitting looked up by the invite hash, not by who owns it.
 *
 * A friend has the token and nothing else. The hash is how the sitting
 * is found; the owner is not in the request.
 */
export async function getBlindSessionByTokenHash(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select()
    .from(blindSessions)
    .where(eq(blindSessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

/** Write a friend's answers onto the sitting the token opened. */
export async function updateBlindSessionByTokenHash(
  tokenHash: string,
  patch: Partial<{
    answers: unknown;
    summary: unknown;
    finishedAt: Date | null;
  }>,
) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db
    .update(blindSessions)
    .set(patch)
    .where(eq(blindSessions.tokenHash, tokenHash))
    .returning();
  return row;
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * How much of the record each generation layer can stand on.
 *
 * Counts only. The thresholds live next to the layers themselves.
 * The queries are aggregates — a million-row import is not read into
 * memory as rows.
 */
export async function getMaterialCounts(
  personaId: number,
  userId: number,
): Promise<MaterialCounts> {
  const empty: MaterialCounts = {
    total: 0,
    theirs: 0,
    mine: 0,
    others: 0,
    from: null,
    to: null,
    withTimestamps: 0,
    byKind: {},
    byEmotion: {},
    theirsText: 0,
    theirsLabeledAct: 0,
    timedExchanges: 0,
    openings: 0,
    periodHave: 0,
    ritualHave: 0,
  };
  const db = await getDb();
  if (!db) return empty;
  const filter = recordsWhere(personaId, userId);
  const [totals] = await db
    .select({
      total: count(),
      theirs: sql<number>`count(*) FILTER (WHERE ${collectedMessages.role} = 'assistant')`,
      mine: sql<number>`count(*) FILTER (WHERE ${collectedMessages.role} = 'user')`,
      others: sql<number>`count(*) FILTER (WHERE ${collectedMessages.role} = 'other')`,
      from: min(collectedMessages.timestamp),
      to: max(collectedMessages.timestamp),
      withTimestamps: sql<number>`count(*) FILTER (WHERE ${collectedMessages.timestamp} IS NOT NULL)`,
      theirsText: sql<number>`count(*) FILTER (
        WHERE ${collectedMessages.role} = 'assistant'
          AND COALESCE(${collectedMessages.kind}, 'text') = 'text'
      )`,
      theirsLabeledAct: sql<number>`count(*) FILTER (
        WHERE ${collectedMessages.role} = 'assistant'
          AND ${collectedMessages.act} IS NOT NULL
          AND ${collectedMessages.act} <> ''
      )`,
    })
    .from(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        filter,
      ),
    );
  const kindRows = await db
    .select({
      kind: sql<string>`COALESCE(${collectedMessages.kind}, 'text')`,
      n: count(),
    })
    .from(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        filter,
      ),
    )
    .groupBy(sql`COALESCE(${collectedMessages.kind}, 'text')`);
  const emotionRows = await db
    .select({
      emotion: collectedMessages.emotion,
      n: count(),
    })
    .from(collectedMessages)
    .where(
      and(
        eq(collectedMessages.personaId, personaId),
        eq(collectedMessages.userId, userId),
        eq(collectedMessages.role, "assistant"),
        sql`${collectedMessages.emotion} IS NOT NULL AND ${collectedMessages.emotion} <> ''`,
        filter,
      ),
    )
    .groupBy(collectedMessages.emotion);
  const sceneBreakSec = DEFAULT_SCENE_BREAK_HOURS * 3600;
  const windowed = sql`
    (
      SELECT
        role,
        LAG(role) OVER (ORDER BY "timestamp", id) AS prev_role,
        LAG("timestamp") OVER (ORDER BY "timestamp", id) AS prev_at,
        EXTRACT(EPOCH FROM (
          "timestamp" - LAG("timestamp") OVER (ORDER BY "timestamp", id)
        )) AS gap_sec
      FROM collected_messages
      WHERE "personaId" = ${personaId}
        AND "userId" = ${userId}
        AND "timestamp" IS NOT NULL
        AND (
          meta IS NULL
          OR meta->>'register' IS NULL
          OR meta->>'register' = 'private'
        )
    ) AS material_windows
  `;
  const [windows] = await db
    .select({
      timedExchanges: sql<number>`count(*) FILTER (
        WHERE role = 'assistant'
          AND prev_role = 'user'
          AND gap_sec IS NOT NULL
          AND gap_sec >= ${BEHAVIOR_MIN_GAP_SEC}
          AND gap_sec <= ${BEHAVIOR_MAX_GAP_SEC}
      )`,
      openings: sql<number>`count(*) FILTER (
        WHERE role = 'assistant'
          AND (prev_at IS NULL OR gap_sec >= ${sceneBreakSec})
      )`,
    })
    .from(windowed);
  const silenceSec = PERIOD_SILENCE_DAYS * 86_400;
  const periodSub = sql`
    (
      SELECT COALESCE(MAX(LEAST(left_n, right_n)), 0) AS period_have
      FROM (
        SELECT
          (
            SELECT COUNT(*) FROM collected_messages m
            WHERE m."personaId" = ${personaId}
              AND m."userId" = ${userId}
              AND m.role = 'assistant'
              AND m."timestamp" IS NOT NULL
              AND m."timestamp" < g.gap_at
              AND (
                m.meta IS NULL
                OR m.meta->>'register' IS NULL
                OR m.meta->>'register' = 'private'
              )
          ) AS left_n,
          (
            SELECT COUNT(*) FROM collected_messages m
            WHERE m."personaId" = ${personaId}
              AND m."userId" = ${userId}
              AND m.role = 'assistant'
              AND m."timestamp" IS NOT NULL
              AND m."timestamp" >= g.gap_at
              AND (
                m.meta IS NULL
                OR m.meta->>'register' IS NULL
                OR m.meta->>'register' = 'private'
              )
          ) AS right_n
        FROM (
          SELECT at AS gap_at
          FROM (
            SELECT
              "timestamp" AS at,
              LAG("timestamp") OVER (ORDER BY "timestamp", id) AS prev_at
            FROM collected_messages
            WHERE "personaId" = ${personaId}
              AND "userId" = ${userId}
              AND "timestamp" IS NOT NULL
              AND (
                meta IS NULL
                OR meta->>'register' IS NULL
                OR meta->>'register' = 'private'
              )
          ) dated
          WHERE prev_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (at - prev_at)) >= ${silenceSec}
        ) g
      ) sides
    ) AS material_periods
  `;
  const [period] = await db
    .select({
      periodHave: sql<number>`period_have`,
    })
    .from(periodSub);
  const ritualWindow = sql`
    (
      SELECT
        role,
        COALESCE(kind, 'text') AS kind,
        char_length(trim(content)) AS len,
        LAG(role) OVER (ORDER BY "timestamp", id) AS prev_role,
        LAG(COALESCE(kind, 'text')) OVER (ORDER BY "timestamp", id) AS prev_kind,
        LAG(char_length(trim(content))) OVER (ORDER BY "timestamp", id) AS prev_len
      FROM collected_messages
      WHERE "personaId" = ${personaId}
        AND "userId" = ${userId}
        AND (
          meta IS NULL
          OR meta->>'register' IS NULL
          OR meta->>'register' = 'private'
        )
    ) AS material_rituals
  `;
  const [rituals] = await db
    .select({
      ritualHave: sql<number>`count(*) FILTER (
        WHERE role = 'assistant'
          AND kind = 'text'
          AND len > 0 AND len <= ${RITUAL_MAX_REPLY_CHARS}
          AND prev_role = 'user'
          AND prev_kind = 'text'
          AND prev_len > 0 AND prev_len <= ${RITUAL_MAX_TRIGGER_CHARS}
      )`,
    })
    .from(ritualWindow);
  const byKind: Record<string, number> = {};
  for (const row of kindRows) byKind[row.kind] = asCount(row.n);
  const byEmotion: Record<string, number> = {};
  for (const row of emotionRows) {
    if (row.emotion) byEmotion[row.emotion] = asCount(row.n);
  }
  return {
    total: asCount(totals?.total),
    theirs: asCount(totals?.theirs),
    mine: asCount(totals?.mine),
    others: asCount(totals?.others),
    from: totals?.from ?? null,
    to: totals?.to ?? null,
    withTimestamps: asCount(totals?.withTimestamps),
    byKind,
    byEmotion,
    theirsText: asCount(totals?.theirsText),
    theirsLabeledAct: asCount(totals?.theirsLabeledAct),
    timedExchanges: asCount(windows?.timedExchanges),
    openings: asCount(windows?.openings),
    periodHave: asCount(period?.periodHave),
    ritualHave: asCount(rituals?.ritualHave),
  };
}

/** The evaluation runs with these ids, scoped to their owner. */
export async function getEvalRunsByIds(ids: number[], userId: number) {
  const db = await getDb();
  if (!db) return [];
  if (ids.length === 0) return [];
  return db
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.userId, userId), inArray(evalRuns.id, ids)));
}

// ─── Scheduled items (C5.3) ────────────────────────────────────────────────

/**
 * How old a claim has to be before another sweep may take it.
 *
 * A claim is a lock, not a state: the row stays `scheduled` until the
 * delivery actually finishes. A process that died mid-delivery leaves a
 * claim behind, and after this long the next sweep tries again.
 */
const SCHEDULED_ITEM_CLAIM_STALE_MS = 5 * 60 * 1000;

export async function createScheduledItem(data: InsertScheduledItem): Promise<ScheduledItem> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db
    .insert(scheduledItems)
    .values(encryptWriteValues("scheduled_items", data.userId, { ...data }))
    .returning();
  if (!row) throw new Error("DB not available");
  return decryptRowOf("scheduled_items", row)!;
}

/** The scheduled items of one persona, oldest first. */
export async function listScheduledItems(
  personaId: number,
  userId: number,
  limit = 50,
): Promise<ScheduledItem[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(scheduledItems)
    .where(and(eq(scheduledItems.personaId, personaId), eq(scheduledItems.userId, userId)))
    .orderBy(asc(scheduledItems.dueAt), asc(scheduledItems.id))
    .limit(limit);
  return decryptRows("scheduled_items", rows);
}

/**
 * How many check-ins this persona is still holding (C9.4).
 *
 * The `set_reminder` tool allows one at a time; the count is what the
 * tool checks before it writes. A delivered or cancelled row does not
 * count — the reminder is over.
 */
export async function countPendingCheckIns(
  personaId: number,
  userId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledItems)
    .where(and(
      eq(scheduledItems.userId, userId),
      eq(scheduledItems.personaId, personaId),
      eq(scheduledItems.kind, "check_in"),
      eq(scheduledItems.status, "scheduled"),
    ));
  return row?.count ?? 0;
}

export async function getScheduledItem(
  id: number,
  userId: number,
): Promise<ScheduledItem | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(scheduledItems)
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, userId)))
    .limit(1);
  return decryptRowOf("scheduled_items", row) ?? null;
}

/** Cancels a still-scheduled item. Delivered items are left alone. */
export async function cancelScheduledItem(
  id: number,
  userId: number,
  reason: string | null = null,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(scheduledItems)
    .set({ status: "cancelled", cancelReason: reason, claimedAt: null })
    .where(and(
      eq(scheduledItems.id, id),
      eq(scheduledItems.userId, userId),
      eq(scheduledItems.status, "scheduled"),
    ))
    .returning({ id: scheduledItems.id });
  return rows.length > 0;
}

/** The items whose day has come and that nobody has delivered yet. */
export async function listDueScheduledItems(now: Date, limit = 20): Promise<ScheduledItem[]> {
  const db = await getDb();
  if (!db) return [];
  const staleBefore = new Date(now.getTime() - SCHEDULED_ITEM_CLAIM_STALE_MS);
  const rows = await db
    .select()
    .from(scheduledItems)
    .where(and(
      lte(scheduledItems.dueAt, now),
      eq(scheduledItems.status, "scheduled"),
      or(
        isNull(scheduledItems.claimedAt),
        lt(scheduledItems.claimedAt, staleBefore),
      ),
    ))
    .orderBy(asc(scheduledItems.dueAt))
    .limit(limit);
  return decryptRows("scheduled_items", rows);
}

export async function claimScheduledItem(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const staleBefore = new Date(Date.now() - SCHEDULED_ITEM_CLAIM_STALE_MS);
  const [row] = await db
    .update(scheduledItems)
    .set({ claimedAt: new Date() })
    .where(and(
      eq(scheduledItems.id, id),
      eq(scheduledItems.userId, userId),
      eq(scheduledItems.status, "scheduled"),
      or(
        isNull(scheduledItems.claimedAt),
        lt(scheduledItems.claimedAt, staleBefore),
      ),
    ))
    .returning({ id: scheduledItems.id });
  return Boolean(row);
}

export async function finishScheduledItem(
  id: number,
  userId: number,
  status: "delivered" | "cancelled",
  options: { reason?: string | null; at?: Date } = {},
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(scheduledItems)
    .set({
      status,
      cancelReason: status === "cancelled" ? options.reason ?? null : null,
      deliveredAt: status === "delivered" ? options.at ?? new Date() : null,
      claimedAt: null,
    })
    .where(and(eq(scheduledItems.id, id), eq(scheduledItems.userId, userId)))
    .returning({ id: scheduledItems.id });
  return rows.length > 0;
}

/** Gives a claimed item back to the next sweep after a failed delivery. */
export async function releaseScheduledItem(id: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .update(scheduledItems)
    .set({ claimedAt: null })
    .where(and(
      eq(scheduledItems.id, id),
      eq(scheduledItems.userId, userId),
      eq(scheduledItems.status, "scheduled"),
    ))
    .returning({ id: scheduledItems.id });
  return rows.length > 0;
}
