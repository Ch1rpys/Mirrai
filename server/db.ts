import { eq, desc, and, or, sql, count, sum, gte, ilike, asc, lt, lte, max, min, inArray, notInArray, isNull, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  InsertUser, users,
  personas, personaFiles, messages,
  wechatBindings, skillJobs, llmConfigs, wechatBotState,
  memories, emotionSnapshots, diaryEntries, scenes,
  chatSummaries, safetyEvents, graduationAssessments,
  channelBindings, channelStates, channelDefaultPersonas, personaTemplates, personaQuestionnaireAnswers,
  reminderDeliveries, researchProfiles, collectedMessages, collectionSources,
  collectionJobs,
  distillationChunks, distillationCards, personaVersions,
  evalCases, evalRuns, outboundLetters, fidelityFeedback, fidelityPairs, blindSessions,
  recordEmbeddings,
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
} from "../drizzle/schema";
import { BUILTIN_SCENE_DEFINITIONS } from "@shared/copy/scenes";
import { localDateKey, previousDateKey, zonedDateKey, zonedDayKeyWindowStart } from "@shared/timezone";
import { userDayColumn, userHourColumn } from "./_core/user-day";
import { dayShiftMinutes, zonedDayStart } from "@shared/timezone";
import {
  normalizePersonaSettings,
  type PersonaSettings,
} from "@shared/persona-settings";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";
import { RELATIONSHIP_PHASE_EVENTS } from "@shared/user-side";
import { BEHAVIOR_MAX_GAP_SEC, BEHAVIOR_MIN_GAP_SEC } from "@shared/behavior-profile";
import { DEFAULT_SCENE_BREAK_HOURS } from "@shared/scenes";
import { PERIOD_SILENCE_DAYS } from "@shared/periods";
import type { MaterialCounts } from "@shared/material-report";
import { RITUAL_MAX_REPLY_CHARS, RITUAL_MAX_TRIGGER_CHARS } from "@shared/ritual-table";

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

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
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
  return result[0];
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
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
    .where(sql`${personas.proactiveFrequencyHours} > 0`);
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
    channel?: "web" | "wechat" | "feishu";
    origin?: string;
  },
): Promise<typeof letters.$inferSelect> {
  return withTransaction(async (tx) => {
    const [row] = await tx.insert(letters).values(letter).returning();
    await tx.insert(messages).values({
      personaId: message.personaId,
      userId: message.userId,
      role: "user",
      content: message.content,
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
    return row;
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
    .values({
      userId: params.userId,
      personaId: params.personaId,
      body: params.body,
      kind: params.kind ?? "letter",
      mood: params.mood ?? null,
      status: params.status,
      replyAt: params.replyAt ?? null,
      createdAt: new Date(),
    })
    .returning();
  return row ?? null;
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
  return db.select().from(letters)
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
  return db.select().from(letters)
    .where(and(
      eq(letters.personaId, personaId),
      eq(letters.userId, userId),
      eq(letters.kind, "todo"),
    ))
    .orderBy(desc(letters.createdAt))
    .limit(20);
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
  return row ?? null;
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
  return db.select().from(letters)
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
    channel?: "web" | "wechat" | "feishu";
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
      .set({ status: "answered", replyText, repliedAt, claimedAt: null })
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
      content: message.content,
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
    .set({ status: "answered", replyText, repliedAt, claimedAt: null })
    .where(and(eq(letters.id, id), eq(letters.userId, userId)))
    .returning();
  return row ?? null;
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
  return row ?? null;
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
export async function getUserLocale(userId: number): Promise<"zh" | "en"> {
  const db = await getDb();
  if (!db) return "zh";
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId));
  return row?.locale === "en" ? "en" : "zh";
}

/** Remembers the language the user reads. */
export async function setUserLocale(userId: number, locale: "zh" | "en"): Promise<void> {
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
  const media = await db
    .select({ mediaUrl: messages.mediaUrl })
    .from(messages)
    .where(
      personaId === undefined
        ? eq(messages.userId, userId)
        : and(eq(messages.userId, userId), eq(messages.personaId, personaId)),
    );
  for (const message of media) {
    const url = message.mediaUrl;
    if (!url) continue;
    // The url is a path: "/uploads/chat/1/2/x.png".
    const marker = "/uploads/";
    const at = url.indexOf(marker);
    if (at === -1) continue;
    keys.add(url.slice(at + marker.length));
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
    await tx.delete(letters).where(eq(letters.userId, id));
    await tx.delete(memories).where(eq(memories.userId, id));
    await tx.delete(memoryExtractions).where(eq(memoryExtractions.userId, id));
    await tx.delete(messages).where(eq(messages.userId, id));
    await tx.delete(outboundLetters).where(eq(outboundLetters.userId, id));
    await tx.delete(personaFiles).where(eq(personaFiles.userId, id));
    await tx.delete(personaQuestionnaireAnswers).where(eq(personaQuestionnaireAnswers.userId, id));
    await tx.delete(personaTemplates).where(eq(personaTemplates.userId, id));
    await tx.delete(personaVersions).where(eq(personaVersions.userId, id));
    await tx.delete(recordEmbeddings).where(eq(recordEmbeddings.userId, id));
    await tx.delete(relationshipEvents).where(eq(relationshipEvents.userId, id));
    await tx.delete(reminderDeliveries).where(eq(reminderDeliveries.userId, id));
    await tx.delete(researchProfiles).where(eq(researchProfiles.userId, id));
    await tx.delete(safetyEvents).where(eq(safetyEvents.userId, id));
    await tx.delete(scenes).where(eq(scenes.userId, id));
    await tx.delete(skillJobs).where(eq(skillJobs.userId, id));
    await tx.delete(userMoods).where(eq(userMoods.userId, id));
    await tx.delete(wechatBindings).where(eq(wechatBindings.userId, id));
    await tx.delete(wechatBotState).where(eq(wechatBotState.userId, id));
    await tx.delete(personas).where(eq(personas.userId, id));
    await tx.delete(users).where(eq(users.id, id));
  });

  await removeStoredFiles(storedFiles);
}

export async function getAccountStats(userId: number) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, totalMessages: 0, totalFiles: 0, storageUsed: 0 };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
  const [msgCount] = await db.select({ c: count() }).from(messages).where(eq(messages.userId, userId));
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
  const personaList = await db.select().from(personas).where(eq(personas.userId, userId));
  // Bounded: the bundle is serialised into one string in memory, and an
  // unbounded query is an out-of-memory crash for the whole server.
  const messageList = await db.select().from(messages).where(eq(messages.userId, userId))
    .orderBy(messages.createdAt).limit(50_000);
  return { user, personas: personaList, messages: messageList };
}

// ─── Persona helpers ────────────────────────────────────────────────────────

export async function createPersona(data: InsertPersona) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [result] = await db.insert(personas).values(data).returning({ id: personas.id });
  return result.id;
}

export async function getPersonasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
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
  const list = await db.select().from(personas).where(eq(personas.userId, userId)).orderBy(desc(personas.updatedAt));
  if (list.length === 0) return [];
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
      eq(messages.userId, userId),
      inArray(messages.personaId, ids),
    ))
    // Postgres insists that the ordering starts with the distinct-on
    // columns.
    .orderBy(messages.personaId, desc(messages.createdAt));

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
      content: (row.content || "").slice(0, 60),
      createdAt: row.createdAt,
    });
  }
  const filesByPersona = new Map(fileCounts.map((r) => [r.personaId, Number(r.c)]));
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

  return list.map((p) => {
    const lastPhase = phaseByPersona.get(p.id);
    const togetherEnded = Boolean((p.togetherTo ?? "").trim());
    const relationshipEnded = togetherEnded || lastPhase === "breakup" || lastPhase === "apart";
    return {
      ...p,
      lastMessage: lastByPersona.get(p.id) ?? null,
      fileCount: filesByPersona.get(p.id) ?? 0,
      wechatBound: (bindingsByPersona.get(p.id) ?? 0) > 0,
      relationshipEnded,
    };
  });
}

export async function getUserStats(userId: number, timezone?: string | null) {
  const db = await getDb();
  if (!db) return { totalPersonas: 0, totalChats: 0, todayChats: 0, memberSince: new Date() };
  const [personaCount] = await db.select({ c: count() }).from(personas).where(eq(personas.userId, userId));
  const [chatSum] = await db.select({ s: sum(personas.chatCount) }).from(personas).where(eq(personas.userId, userId));
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
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, today)));
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
      eq(personas.userId, userId),
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
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map(r => ({
    ...r,
    content: (r.content || "").slice(0, 80),
  }));
}

export async function getPersonaById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId))).limit(1);
  return result[0];
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
    .set(patch)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .returning({ id: personas.id });
  return rows.length > 0;
}

/**
 * Deletes a persona and everything that hangs off it, in one transaction.
 *
 * Ownership is checked *before* anything is deleted. The row deletes are
 * scoped to the persona's owner as well as the persona itself, so a caller
 * who guessed another user's persona id cannot wipe their history — and
 * cannot even delete the rows that belong to it.
 *
 * Covers every table with a `personaId` — the same completeness rule as
 * `deleteUserAccount`, and checked by `server/db-delete-coverage.test.ts`.
 */
export async function deletePersona(id: number, userId: number) {
  // The ownership check comes first: without it, a caller who passed
  // somebody else's persona id would still delete that persona's messages
  // and memories.
  const owned = await getPersonaById(id, userId);
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
    await tx.delete(memories).where(and(eq(memories.personaId, id), eq(memories.userId, userId)));
    await tx.delete(memoryExtractions).where(and(eq(memoryExtractions.personaId, id), eq(memoryExtractions.userId, userId)));
    await tx.delete(messages).where(and(eq(messages.personaId, id), eq(messages.userId, userId)));
    await tx.delete(outboundLetters).where(and(eq(outboundLetters.personaId, id), eq(outboundLetters.userId, userId)));
    await tx.delete(personaFiles).where(and(eq(personaFiles.personaId, id), eq(personaFiles.userId, userId)));
    await tx.delete(personaQuestionnaireAnswers).where(and(eq(personaQuestionnaireAnswers.personaId, id), eq(personaQuestionnaireAnswers.userId, userId)));
    await tx.delete(personaVersions).where(and(eq(personaVersions.personaId, id), eq(personaVersions.userId, userId)));
    await tx.delete(relationshipEvents).where(and(eq(relationshipEvents.personaId, id), eq(relationshipEvents.userId, userId)));
    await tx.delete(reminderDeliveries).where(and(eq(reminderDeliveries.personaId, id), eq(reminderDeliveries.userId, userId)));
    await tx.delete(researchProfiles).where(and(eq(researchProfiles.personaId, id), eq(researchProfiles.userId, userId)));
    await tx.delete(safetyEvents).where(and(eq(safetyEvents.personaId, id), eq(safetyEvents.userId, userId)));
    await tx.delete(skillJobs).where(and(eq(skillJobs.personaId, id), eq(skillJobs.userId, userId)));
    await tx.delete(letters).where(and(eq(letters.personaId, id), eq(letters.userId, userId)));
    await tx.delete(wechatBindings).where(and(eq(wechatBindings.personaId, id), eq(wechatBindings.userId, userId)));
    await tx.delete(personas).where(and(eq(personas.id, id), eq(personas.userId, userId)));
  });

  await removeStoredFiles(storedFiles);
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
    .where(and(eq(messages.userId, userId), eq(messages.mediaUrl, mediaUrl)))
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
  const [result] = await db.insert(messages).values(data).returning({ id: messages.id });
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
    .innerJoin(messages, eq(messages.id, fidelityFeedback.messageId))
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
  return rows.filter((row): row is FidelityRewritePair => typeof row.rewrite === "string" && row.rewrite.trim().length > 0);
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
): Promise<RecordEmbeddingRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
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
    );
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
  channel: "web" | "wechat" | "feishu",
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
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
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
    collected.push(...rows);
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
      eq(messages.id, messageId),
      eq(messages.userId, userId),
      ...(personaId === undefined ? [] : [eq(messages.personaId, personaId)]),
    ))
    .limit(1);
  return rows[0] ?? null;
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
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      lt(messages.id, beforeId),
    ))
    .orderBy(desc(messages.id)).limit(limit);
  return rows.reverse();
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
    await tx.update(personas)
      .set({ chatCount: 0 })
      .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  });
}

export async function searchMessages(personaId: number, userId: number, query: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  // The wildcards are escaped, so a search for "50%" does not match
  // everything that contains a digit.
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), ilike(messages.content, `%${escaped}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
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
  const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;

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
      .where(and(eq(messages.userId, userId), ilike(messages.content, pattern)))
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
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
  if (!persona[0]) return { chatCount: 0, totalMessages: 0, memoryCount: 0, emotionVariety: 0, daysSinceCreation: 0, consecutiveDays: 0 };
  const [msgCount] = await db.select({ c: count() }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)));
  const [memCount] = await db.select({ c: count() }).from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)));
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
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
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
  const [result] = await db.insert(memories).values(data).returning({ id: memories.id });
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
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)));
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
  return db.select({
    id: memories.id,
    title: memories.title,
    date: memories.date,
  })
    .from(memories)
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.category, "anniversary"),
    ))
    .orderBy(asc(memories.date));
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
  return db.select().from(memories)
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
    .orderBy(desc(memories.isPinned), desc(memories.importance), desc(memories.createdAt))
    .limit(limit);
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
    .innerJoin(messages, eq(memories.messageId, messages.id))
    .where(and(
      eq(memories.personaId, personaId),
      eq(memories.userId, userId),
      eq(memories.status, "active"),
      eq(messages.userId, userId),
      eq(messages.personaId, personaId),
      eq(messages.role, "assistant"),
    ))
    .orderBy(desc(memories.id));
  return rows;
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
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.personaId, personaId),
        eq(memories.userId, userId),
        eq(memories.factKey, factKey),
      ),
    )
    .orderBy(desc(memories.createdAt));
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
export async function getMemoryTitles(ids: number[], userId: number) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, string>();
  const unique = Array.from(new Set(ids));
  const rows = await db.select({
    id: memories.id,
    title: memories.title,
    subject: memories.subject,
  }).from(memories).where(and(inArray(memories.id, unique), eq(memories.userId, userId)));
  return new Map(rows.map((r) => [r.id, r.title]));
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
    /** Whose memory this is: "them" or "me". */
    subject?: "them" | "me";
    /**
     * Clearing the source line means the user has looked at it.
     *
     * A memory extracted from the persona's own speech keeps its
     * messageId until the user says to keep it — then the link is
     * dropped so it is no longer on the review list.
     */
    messageId?: number | null;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.update(memories)
    .set(data)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Removes a memory.
 *
 * It says whether a row was actually removed — see `deleteWechatBinding`.
 */
export async function deleteMemory(id: number, userId: number): Promise<boolean> {
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
    .innerJoin(personas, eq(messages.personaId, personas.id))
    .where(and(eq(messages.userId, userId), gte(messages.createdAt, since)))
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
  const [result] = await db.insert(diaryEntries).values(data).returning({ id: diaryEntries.id });
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
    .innerJoin(personas, eq(diaryEntries.personaId, personas.id))
    .where(and(...conditions))
    .orderBy(desc(diaryEntries.date))
    .limit(limit);
  return rows;
}

export async function getDiaryByDate(personaId: number, userId: number, date: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(diaryEntries)
    .where(and(eq(diaryEntries.personaId, personaId), eq(diaryEntries.userId, userId), eq(diaryEntries.date, date)))
    .limit(1);
  return rows[0];
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
  return db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId), sql`${day} = ${date}`))
    .orderBy(asc(messages.createdAt));
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)));
  if (!persona) return null;
  const allMessages = await db.select().from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
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
    .where(and(eq(memories.personaId, personaId), eq(memories.userId, userId)))
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
    persona,
    messages: allMessages,
    memories: allMemories,
    emotionSnapshots: allSnapshots,
    diaryEntries: allDiaries,
    letters: allLetters,
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
    .set({ content })
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
 * Deletes a single message.
 *
 * The chat history is the user's, and a single message in the middle of it
 * can be something they would rather not have written down.
 */
export async function deleteMessage(
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
  return deleted.length > 0;
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
  return db.select({
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
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.id, messageId),
    ))
    .orderBy(asc(messages.id));
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
        content: row.content,
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
      eq(messages.id, messageId),
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
    ))
    .limit(1);
  if (target.length === 0) return 0;

  // The ids are a sequence, so "this message and everything after it" is
  // `id >= this one`. Cutting by time instead would take the messages
  // that share the millisecond with it as well.
  const deleted = await db.delete(messages)
    .where(and(
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.id, target[0].id),
    ))
    .returning({ id: messages.id });
  return deleted.length;
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
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      ...(role ? [eq(messages.role, role)] : []),
      sql`"createdAt" < (SELECT "createdAt" FROM "messages" WHERE "id" = ${messageId} AND "personaId" = ${personaId} AND "userId" = ${userId})`,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0] ?? null;
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
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
  const [result] = await db.insert(collectedMessages).values(data)
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
        .values(chunk)
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
  return db.select({
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
  options: { limit?: number; source?: string | null; newest?: boolean } = {},
) {
  const db = await getDb();
  if (!db) return [];
  // Ordered by when the message was *said*, not by when it was
  // imported. Two imports of two different conversations used to be
  // laid end to end, and the ruler cut cases across the seam — a case
  // whose context was half of one conversation and half of another.
  const query = db.select().from(collectedMessages).where(and(
    eq(collectedMessages.personaId, personaId),
    eq(collectedMessages.userId, userId),
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
    return newest.reverse();
  }
  return query
    .orderBy(asc(sql`COALESCE(${collectedMessages.timestamp}, ${collectedMessages.createdAt})`))
    .limit(options.limit ?? MAX_COLLECTED_MESSAGES);
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
    for (const row of page) yield row;
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

export async function getRecordsByIds(
  ids: number[],
  userId: number,
): Promise<CollectedMessage[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db
    .select()
    .from(collectedMessages)
    .where(and(inArray(collectedMessages.id, ids), eq(collectedMessages.userId, userId)))
    .orderBy(asc(spokenAtColumn()), asc(collectedMessages.id));
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
  return { target, before: earlier.reverse(), after: later };
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
 * commits, the same way `deletePersona` waits.
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
    // The time zone the reminders are timed in. Without it the scheduler
    // counted the days in the server's calendar, which is not the day the
    // anniversary is.
    timezone: personas.timezone,
  }).from(personas).where(eq(personas.remindersEnabled, true));
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
  }).from(messages)
    .where(and(
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
  return limit === undefined ? query : query.limit(limit);
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
      eq(messages.personaId, personaId),
      eq(messages.userId, userId),
      gte(messages.createdAt, since),
      role ? eq(messages.role, role) : undefined,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  // The caller reads it as a conversation, so it is turned round.
  return rows.reverse();
}

/** The timestamp of the most recent message, used for session-duration checks. */
export async function getLastMessageAt(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ createdAt: messages.createdAt }).from(messages)
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
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
    .where(and(eq(messages.personaId, personaId), eq(messages.userId, userId)))
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId))).limit(1);
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
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
    .where(and(eq(personas.id, personaId), eq(personas.userId, userId)))
    .limit(1);
  if (!rows[0]) return null;
  if (rows[0].styleProfile == null) return null;
  return normalizeStyleProfile(rows[0].styleProfile);
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
    .set({ styleProfile: normalizeStyleProfile(profile) })
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
    .values({
      userId: data.userId,
      personaId: data.personaId,
      text: data.text,
      sourceMessageId: data.sourceMessageId ?? null,
      status: data.status ?? "draft",
    })
    .onConflictDoNothing()
    .returning({ id: outboundLetters.id });
  return result?.id;
}

/** The letters this user is taking back, newest first. */
export async function getOutboundLetters(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(outboundLetters).where(and(
    eq(outboundLetters.personaId, personaId),
    eq(outboundLetters.userId, userId),
  )).orderBy(desc(outboundLetters.id));
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
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.update(outboundLetters).set({ text, updatedAt: new Date() }).where(and(
    eq(outboundLetters.id, id),
    eq(outboundLetters.userId, userId),
  )).returning({ id: outboundLetters.id });
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
    .values({
      userId,
      personaId,
      reason,
      personaData: persona.personaData,
      styleProfile: persona.styleProfile,
      behaviorProfile: persona.behaviorProfile,
      settings: persona.settings,
    })
    .returning({ id: personaVersions.id });
  await prunePersonaVersions(personaId, userId);
  return row?.id;
}

/** The snapshots of a persona, newest first. */
export async function listPersonaVersions(personaId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.personaId, personaId),
        eq(personaVersions.userId, userId),
      ),
    )
    .orderBy(desc(personaVersions.id));
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
  return rows[0];
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
  return rows[0];
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
