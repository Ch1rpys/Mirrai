import { sql } from "drizzle-orm";
import { bigint, boolean, customType, index, integer, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar, jsonb } from "drizzle-orm/pg-core";

/** Stored embedding vectors. Drizzle has no built-in bytea column. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * A PostgreSQL text-search vector (C8.6).
 *
 * Chinese has no word boundaries the built-in configurations could
 * use, so the application cuts the text into character bigrams and
 * writes them with `array_to_tsvector`. Reads only ask whether it
 * matches, so no decoding into a JavaScript value is needed.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const roleEnum = pgEnum("role", ["user", "admin"]);
export const analysisStatusEnum = pgEnum("analysis_status", ["pending", "analyzing", "ready", "error"]);
export const emotionalStateEnum = pgEnum("emotional_state", ["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]);
export const fileTypeEnum = pgEnum("file_type", ["chat_txt", "chat_csv", "image", "video", "collected", "chat_export", "archive"]);
export const processStatusEnum = pgEnum("process_status", ["uploaded", "processing", "done", "failed"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);
export const channelEnum = pgEnum("channel", [
  "web",
  "wechat",
  "feishu",
  // An OpenAI-compatible client (C9.2). PostgreSQL cannot remove an enum
  // value, so this one only ever gets added.
  "api",
  // The bot channels of C9.1.
  "telegram",
  "discord",
  "matrix",
]);
export const characterFamilyEnum = pgEnum("character_family", ["colleague", "relationship", "celebrity"]);
export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "intake", "collecting", "analyzing_persona", "analyzing_work",
  "building", "merging", "structuring", "correcting", "complete", "error",
  // The celebrity research flow. PostgreSQL cannot remove enum values, so
  // these only ever get added.
  "researching", "auditing", "synthesizing", "validating",
]);
export const botStatusEnum = pgEnum("bot_status", ["stopped", "scanning", "scaned", "need_verifycode", "logged_in", "error"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "voice", "image"]);
export const memoryCategoryEnum = pgEnum("memory_category", ["milestone", "memory", "anniversary", "anchor"]);
export const graduationStatusEnum = pgEnum("graduation_status", ["suggested", "graduated", "declined"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum().default("user").notNull(),
  /**
   * Bumped whenever the user logs out or changes their password. Sessions carry
   * the value they were minted with, so a mismatch invalidates the token —
   * this is what makes a logout actually revoke access.
   */
  tokenVersion: integer("tokenVersion").default(0).notNull(),
  /**
   * The instance-wide default for the graduation mechanism.
   *
   * "suggest" (the historical behaviour) has the app offer a graduation when
   * the thresholds are met; "manual" leaves the decision entirely to the
   * user; "off" switches the mechanism off. A persona may override this.
   */
  graduationMode: varchar("graduationMode", { length: 16 }).default("suggest").notNull(),
  /**
   * The user's own timezone, as an IANA name ("Asia/Shanghai").
   *
   * The app used the server's clock for everything, which meant a persona
   * in another timezone was greeted as if it were the user's own evening.
   */
  timezone: varchar("timezone", { length: 64 }),
  /**
   * The language this person reads.
   *
   * The interface asks for it on every request, but the things the app
   * sends on its own — a reminder at midnight, a reply in a chat window —
   * have to know it without being asked. So it is kept here.
   */
  locale: varchar("locale", { length: 8 }).default("zh").notNull(),
  /**
   * How the user wants to be addressed.
   *
   * The persona is rebuilt from the other person's chat history, so it
   * knows how *they* talk. It has no idea how the user wants to be
   * called — "宝贝" to someone who has just been through a breakup is
   * not a small thing.
   */
  addressStyle: varchar("addressStyle", { length: 64 }),
  /**
   * Whether the app may read the user's own messages to assess their
   * emotional trajectory.
   *
   * The trajectory is the one place where the app sends a month of raw
   * private conversation to the model. It is what lets the app notice a
   * user who is getting better — but it is also the app reading
   * something the user never wrote for anyone else.
   *
   * "auto" runs it when the graduation mechanism is in its suggesting
   * mode, because that is what the mechanism is for. "on" and "off" are
   * the user's own decision.
   */
  trajectoryAssessment: varchar("trajectoryAssessment", { length: 8 }).default("auto").notNull(),
  /**
   * Things the persona should not bring up.
   *
   * "别提我前任" or "别再提那家餐厅". A line the user can draw, which
   * the persona is told about and respects.
   */
  boundaries: text("boundaries"),
  /**
   * The monthly ceiling the user set (C8.9).
   *
   * `{ monthlyTokens?, monthlyCost? }`, both optional. When the month's
   * usage passes it, the optional expensive layers stop on their own —
   * ordinary replies, safety paths and memory extraction keep working.
   * Empty means no ceiling.
   */
  budget: jsonb("budget"),
  /**
   * Where the scheduled backups go (C8.3).
   *
   * `{ enabled, frequency, target, passphraseSecret, lastRunAt,
   * lastFileName, history }`. The passphrase that encrypts a backup is
   * wrapped by `encryptSecret`, so the unattended run can still encrypt
   * and a copy of the database does not hand over the backups.
   *
   * Empty means scheduled backups are off, which is the default: an app
   * that writes to somebody's disk every day should not decide to.
   */
  backupSettings: jsonb("backupSettings"),
  /**
   * The app lock's PIN, hashed with the same scrypt the password uses
   * (C8.4). Empty means no PIN has been set, which is also what the lock
   * needs before a persona may be locked on its own.
   *
   * The PIN itself is never stored, never returned by any route and
   * never put in a log.
   */
  lockPinHash: varchar("lockPinHash", { length: 255 }),
  /**
   * The app lock's settings (C8.4).
   *
   * `{ enabled, idleMinutes, passkeys: [{ id, publicKey, counter,
   * transports, createdAt, label }] }`, normalized by
   * `normalizeLockSettings`. Empty means the lock is off.
   */
  lockSettings: jsonb("lockSettings"),
  /**
   * The per-account key that encrypts the contents of the database
   * (C8.5): `{ enabled, wrappedKey, salt, kdf, recoveryWrappedKey? }`.
   *
   * The data key itself is never stored — only wrapped forms of it.
   * Empty means the account's content is plaintext.
   */
  encryption: jsonb("encryption"),
  /**
   * The experimental features this account has turned on (C9.8).
   *
   * `{ groupChat: boolean }`. They are per-account because they are the
   * person's own choice about their own app; defaults are "off", and the
   * whole column empty means nothing has been turned on.
   */
  features: jsonb("features"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const personas = pgTable("personas", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  avatarUrl: text("avatarUrl"),
  relationshipDesc: varchar("relationshipDesc", { length: 200 }),
  togetherFrom: varchar("togetherFrom", { length: 50 }),
  togetherTo: varchar("togetherTo", { length: 50 }),
  personaData: jsonb("personaData"),
  analysisStatus: analysisStatusEnum().default("pending").notNull(),
  analysisProgress: integer("analysisProgress").default(0).notNull(),
  analysisMessage: text("analysisMessage"),
  emotionalState: emotionalStateEnum().default("warm").notNull(),
  /**
   * When the current emotional state started.
   *
   * Inertia measures this stretch against how long that mood used to
   * last in the records. Empty means the stretch has not been timed yet.
   */
  emotionalStateSince: timestamp("emotionalStateSince"),
  chatCount: integer("chatCount").default(0).notNull(),
  lastChatAt: timestamp("lastChatAt"),
  /**
   * When the *user* last spoke to this persona.
   *
   * The same field was used for two different things: "the last time
   * anything was written" and "the last time the user spoke". The
   * app's own nightly message reset the second one — so "you have not
   * spoken for N days" read 0 while the user had not spoken for a
   * week, and the persona never reached out to a user who had gone
   * quiet.
   */
  lastUserMessageAt: timestamp("lastUserMessageAt"),
  /**
   * When the user last had this persona's chat page in front of them
   * (C8.2).
   *
   * A reply that arrived later — a deferred reply, or the answer to a
   * message the user scheduled — is something they have not seen. The
   * app had no way to tell "the user was looking" from "the user was
   * away", so it could not count what was waiting for them.
   */
  lastReadAt: timestamp("lastReadAt"),
  skillJobId: integer("skillJobId"),
  llmProvider: varchar("llmProvider", { length: 64 }),
  intimacyScore: integer("intimacyScore").default(0).notNull(),
  intimacyLevel: varchar("intimacyLevel", { length: 50 }).default("acquainted").notNull(),
  activeSceneId: integer("activeSceneId"),
  /**
   * Where this persona came from: "upload" (distilled from chat logs),
   * "questionnaire" (filled in by hand) or "card" (imported from a
   * SillyTavern character card).
   */
  source: varchar("source", { length: 32 }).default("upload").notNull(),
  /** Whether proactive reminders may be delivered for this persona. */
  remindersEnabled: boolean("remindersEnabled").default(true).notNull(),
  /**
   * A log of the corrections the user has made to this persona.
   *
   * Keeping it on the persona makes the changes auditable — a correction is
   * something the user decided, not something the model guessed.
   */
  correctionLog: jsonb("correctionLog"),
  /**
   * How this persona actually behaves over time: reply gaps, burst sizes,
   * how often it speaks first.
   *
   * The delays used to be product rules — a fixed hour, a fixed count.
   * But a person does not reply on a schedule; they reply the way they
   * have always replied, and that difference is the difference between a
   * schedule and a person. These numbers are sampled from the persona's
   * own history, so the uncertainty is theirs and not the app's.
   */
  behaviorProfile: jsonb("behaviorProfile"),
  graduationStatus: graduationStatusEnum(),
  graduatedAt: timestamp("graduatedAt"),
  farewellLetter: text("farewellLetter"),
  /**
   * Whether the letter is the simplified one.
   *
   * The letter is written in two passes — first the sentences they never
   * said, then the subtraction that leaves only what a last word needs.
   * When the two passes cannot finish in time the older single-pass
   * letter is used instead, which is the same letter as before but
   * plainer. The interface says so rather than passing one thing off as
   * another.
   */
  farewellDegraded: boolean("farewellDegraded").default(false).notNull(),
  /**
   * What the second pass kept, and what it cut.
   *
   * The letter is written in two passes: five sentences they never said,
   * then a subtraction that leaves only what a last word needs. Which
   * lines survived, and which were cut, is the part of that the person
   * reading it might want to see — so it is kept rather than discarded.
   */
  farewellDraft: jsonb("farewellDraft"),
  /**
   * When the graduation was first offered.
   *
   * The suggestion has to be made once, not on every turn — the app
   * nagging about a farewell is the opposite of what it promises.
   */
  graduationSuggestedAt: timestamp("graduationSuggestedAt"),
  /** When the user last declined it; a later suggestion may be made again. */
  graduationDeclinedAt: timestamp("graduationDeclinedAt"),
  /**
   * Whether the persona is around right now.
   *
   * This is separate from `graduationStatus`, which records the *ritual*
   * (has the user said goodbye?). Presence records the *company*:
   *
   *   active — the persona is reachable and the app may reach out
   *   quiet  — the user asked for some space; no outreach, no suggestions
   *   asleep — the persona has graduated and must not disturb anyone
   */
  presence: varchar("presence", { length: 16 }).default("active").notNull(),
  /**
   * Where this persona lives, as an IANA timezone name.
   *
   * The persona's time-of-day awareness is computed in *their* timezone,
   * not the server's — which matters for anyone whose partner is abroad.
   */
  timezone: varchar("timezone", { length: 64 }),
  /**
   * Whether the two of them can currently reach each other.
   *
   * It is a state of the *connection*, not of the relationship: the
   * relationship may be perfectly intact and the two of them simply not
   * be in touch. The app had no way to express that, so "we are apart"
   * and "we broke up" were the same thing, and a person who was simply
   * out of touch was treated as though it were over.
   */
  reachability: varchar("reachability", { length: 16 }).default("reachable").notNull(),
  /**
   * Pinned personas sit at the top of the lobby.
   *
   * A person with six personas and one they talk to every day should not
   * have to hunt for it every morning.
   */
  isPinned: boolean("isPinned").default(false).notNull(),
  /**
   * How often the persona may reach out on its own, in hours.
   *
   * Zero means never. It is the default, and it is a real value rather
   * than a missing one: the product's goal is to help the user finish a
   * relationship, so an app that speaks first is something the user has
   * to buy, not something they get by default.
   */
  proactiveFrequencyHours: integer("proactiveFrequencyHours").default(0).notNull(),
  /**
   * Whether this turn picks among four candidates.
   *
   * Default off: it is about four times the reply cost. Evaluation may
   * treat it as on even when the persona has it off.
   */
  rerankEnabled: boolean("rerankEnabled").default(false).notNull(),
  /**
   * Whether replies wait and split the way this person did.
   *
   * Default off, and separate from rerank. Off, phases 1–3 only change
   * the words.
   */
  timingEnabled: boolean("timingEnabled").default(false).notNull(),
  /**
   * This persona's own graduation mode. Null means "inherit the user's
   * instance default", so changing the default still reaches it.
   */
  graduationMode: varchar("graduationMode", { length: 16 }),
  /**
   * The distillation preset this persona was built with — "fast",
   * "standard", "deep", "colleague" or "celebrity". Null means the
   * standard preset, which is what the app used before the presets existed.
   */
  distillationMode: varchar("distillationMode", { length: 32 }),
  /**
   * Per-persona switches and small config for the sixth stage.
   *
   * Empty means every default. Existing columns such as `rerankEnabled`
   * and `timingEnabled` stay where they are; new switches go here.
   */
  settings: jsonb("settings"),
  /**
   * What was measured from the records.
   *
   * These are measurements, not user decisions, so they do not live in
   * `personaData` (that column has a lock and a merge of confirmations).
   */
  styleProfile: jsonb("styleProfile"),
  /**
   * The owner's persona this row shares (C7.2).
   *
   * A member's row keeps their own conversations, mood and settings;
   * the name, avatar, persona data, style profile and records come from
   * the owner's row and are read through it. Null means an ordinary,
   * fully owned persona.
   */
  sharedFromPersonaId: integer("sharedFromPersonaId"),
  /**
   * When the persona was put in the recycle bin (C8.11).
   *
   * Null means it is not deleted. A deleted persona is invisible to
   * every ordinary read, cannot be talked to, and is hard-deleted with
   * its files thirty days later.
   */
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The user's own personas.
   *
   * The lobby, the statistics and the account page all read them by
   * their owner, and the table had no index for it.
   */
  userIdx: index("personas_user_idx").on(table.userId),
  /** The recycle bin: one user's deleted personas, newest first. */
  userDeletedIdx: index("personas_user_deleted_idx").on(table.userId, table.deletedAt),
  /** The thirty-day sweep reads the oldest deleted personas. */
  deletedIdx: index("personas_deleted_idx").on(table.deletedAt),
}));

export type Persona = typeof personas.$inferSelect;
export type InsertPersona = typeof personas.$inferInsert;

/**
 * One invitation to use somebody's persona (C7.2).
 *
 * The token is stored hashed and is good for one acceptance within
 * seven days. The member's own persona row is `memberPersonaId`; before
 * acceptance it is null.
 */
export const personaShares = pgTable("persona_shares", {
  id: serial("id").primaryKey(),
  /** The owner's persona. */
  personaId: integer("personaId").notNull(),
  ownerUserId: integer("ownerUserId").notNull(),
  memberUserId: integer("memberUserId"),
  memberPersonaId: integer("memberPersonaId"),
  /** `invited`, `active` or `revoked`. */
  status: varchar("status", { length: 16 }).default("invited").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt"),
}, (table) => ({
  tokenUnique: uniqueIndex("persona_shares_token_idx").on(table.tokenHash),
  personaIdx: index("persona_shares_persona_idx").on(table.personaId, table.ownerUserId),
  memberIdx: index("persona_shares_member_idx").on(table.memberPersonaId, table.memberUserId),
}));

export type PersonaShare = typeof personaShares.$inferSelect;
export type InsertPersonaShare = typeof personaShares.$inferInsert;

/**
 * What somebody remembers about the person (C7.4).
 *
 * The owner, or a family member who was let in through C7.2, writes or
 * speaks a passage about who the person was. A draft is the teller's
 * alone: it becomes visible to the persona's owner only when the teller
 * submits it, and the owner is told that before submitting.
 *
 * `personaId` is always the *owner's* row, so both sides' accounts meet
 * in one place. `userId` is the teller — it is not the owner for a
 * family member's account, which is why the read helpers check
 * ownership of the persona rather than matching `userId` blindly.
 */
export const oralAccounts = pgTable("oral_accounts", {
  id: serial("id").primaryKey(),
  /** The owner's persona row. */
  personaId: integer("personaId").notNull(),
  /** Who told it. */
  userId: integer("userId").notNull(),
  /** Their name, as it read on the day they submitted it. */
  tellerName: varchar("tellerName", { length: 64 }).notNull(),
  /** Up to 20,000 characters — enforced by the route, not by the column. */
  body: text("body").notNull(),
  /** Null until the teller submits; a draft is theirs alone. */
  submittedAt: timestamp("submittedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One teller's accounts on one persona.
   *
   * The list reads "mine" and "the family's" separately, so the two
   * columns are always used together.
   */
  personaUserIdx: index("oral_accounts_persona_idx").on(table.personaId, table.userId),
  /**
   * The accounts waiting to be turned into memories.
   *
   * The owner's extracts read only the submitted ones; the partial
   * condition is not expressible here, so the index covers both
   * columns and the query filters the null.
   */
  submittedIdx: index("oral_accounts_submitted_idx").on(table.personaId, table.submittedAt),
}));

export type OralAccount = typeof oralAccounts.$inferSelect;
export type InsertOralAccount = typeof oralAccounts.$inferInsert;

export const personaFiles = pgTable("persona_files", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  fileType: fileTypeEnum().notNull(),
  originalName: varchar("originalName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize").notNull(),
  extractedMemory: text("extractedMemory"),
  processStatus: processStatusEnum().default("uploaded").notNull(),
  parseStatus: varchar("parseStatus", { length: 16 }),
  parseReport: jsonb("parseReport"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The uploaded files of one persona.
   *
   * Every distillation reads them — including the extracted text, which
   * is the largest thing the app holds for one persona — and the table
   * had no index.
   */
  personaUserIdx: index("persona_files_persona_user_idx").on(table.personaId, table.userId),
}));

export type PersonaFile = typeof personaFiles.$inferSelect;
export type InsertPersonaFile = typeof personaFiles.$inferInsert;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  role: messageRoleEnum().notNull(),
  content: text("content").notNull(),
  /** Character bigrams for search (C8.6), written by `array_to_tsvector`. */
  searchTokens: tsvector("searchTokens"),
  messageType: messageTypeEnum().default("text").notNull(),
  mediaUrl: text("mediaUrl"),
  mediaDuration: integer("mediaDuration"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  /**
   * The message this one replies to.
   *
   * Without it, every reply is a reply to "whatever came last", and a
   * conversation that has been going for a while becomes impossible to
   * follow — which is the thing people are in these conversations to do.
   */
  replyToId: integer("replyToId"),
  /**
   * The memories that were injected into this turn, as a JSON array.
   *
   * The retrieval used to be entirely invisible: the persona would
   * bring up something from three months ago and there was no way to
   * know it had been recalled rather than invented. It has to be
   * written down, or the answer to that question disappears the moment
   * the page is reloaded.
   */
  recalledMemoryIds: text("recalledMemoryIds"),
  /**
   * Where this message came from, when it is not an ordinary turn.
   *
   * "letter" — the answer to a letter the user wrote. It landed in the
   * conversation, but without a marker it was just another message, and
   * the connection to the letter was lost the moment it arrived.
   * "proactive" — the persona spoke first.
   */
  origin: varchar("origin", { length: 16 }),
  /**
   * Per-turn notes that are not the message: the period that was
   * selected, the action that was drawn, which exemplars were used.
   * Evaluation reads this to reproduce a turn.
   */
  metadata: jsonb("metadata"),
  channel: channelEnum().default("web").notNull(),
  /** When the message was put in the bin (C8.11); null means it is not. */
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The conversations of one persona.
   *
   * The table had **no index at all** — and it is the one every turn
   * reads and writes. So loading a conversation, paging back through
   * it, and the daily counts were all sequential scans over every
   * message of every user on the instance.
   */
  personaUserCreatedIdx: index("messages_persona_user_created_idx").on(
    table.personaId,
    table.userId,
    table.createdAt,
  ),
  /**
   * The user's own messages, in the order they were said.
   *
   * The charts and the streak read them that way, and the "when did
   * the user last speak" question is asked on every lobby load.
   */
  userRoleCreatedIdx: index("messages_user_role_created_idx").on(
    table.userId,
    table.role,
    table.createdAt,
  ),
  /** The full-text index (C8.6). */
  searchTokensIdx: index("messages_search_tokens_idx").using("gin", table.searchTokens),
  /**
   * The few rows that still have no tokens (C8.6).
   *
   * The search keeps a fallback for rows imported before the token
   * column existed. Without an index for that branch the planner gives
   * up on the GIN index and scans the whole table; this partial index
   * is tiny, empty once the backfill has run, and lets the planner use
   * both indexes.
   */
  missingTokensIdx: index("messages_missing_tokens_idx")
    .on(table.personaId, table.userId)
    .where(sql`${table.searchTokens} IS NULL`),
  /** The thirty-day sweep of deleted messages. */
  deletedIdx: index("messages_deleted_idx").on(table.deletedAt),
}));

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

export const wechatBindings = pgTable("wechat_bindings", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  /**
   * The Weixin conversation counterpart id (`ilink_user_id`).
   *
   * In the official ClawBot model the bot is a dedicated "微信ClawBot" contact
   * in the account owner's own WeChat, so this is the owner's own id — not a
   * third-party friend. The row records "this WeChat account talks to this
   * persona by default".
   */
  wechatUserId: varchar("wechatUserId", { length: 255 }).notNull(),
  wechatName: varchar("wechatName", { length: 255 }),
  wechatAlias: varchar("wechatAlias", { length: 255 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // One active default persona per (user, WeChat account).
  // Partial: inactive legacy rows may share the same counterpart id.
  userWechatUnique: uniqueIndex("wechat_bindings_user_wechat_idx")
    .on(table.userId, table.wechatUserId)
    .where(sql`${table.isActive} = true`),
}));

export type WechatBinding = typeof wechatBindings.$inferSelect;
export type InsertWechatBinding = typeof wechatBindings.$inferInsert;

export const skillJobs = pgTable("skill_jobs", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  characterFamily: characterFamilyEnum().default("relationship").notNull(),
  /** The research profile used by the celebrity family, e.g. "budget-unfriendly". */
  researchProfile: varchar("researchProfile", { length: 32 }),
  pipelineStage: pipelineStageEnum().default("intake").notNull(),
  stageProgress: integer("stageProgress").default(0).notNull(),
  stageMessage: text("stageMessage"),
  inputMeta: jsonb("inputMeta"),
  analysisResult: jsonb("analysisResult"),
  generatedSkillPath: varchar("generatedSkillPath", { length: 500 }),
  /** How many times this job has been retried after a failure. */
  retryCount: integer("retryCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The distillation runs of one persona.
   *
   * The upload page polls the run that is happening, and the table
   * had no index to find it by.
   */
  personaUserIdx: index("skill_jobs_persona_user_idx").on(table.personaId, table.userId),
}));

export type SkillJob = typeof skillJobs.$inferSelect;
export type InsertSkillJob = typeof skillJobs.$inferInsert;

export const llmConfigs = pgTable("llm_configs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  providerName: varchar("providerName", { length: 64 }).notNull(),
  isDefault: boolean("isDefault").default(false).notNull(),
  apiKey: varchar("apiKey", { length: 512 }),
  /** Last 4 characters of the API key, so the UI can show which key is set without revealing it. */
  apiKeyHint: varchar("apiKeyHint", { length: 16 }),
  baseUrl: varchar("baseUrl", { length: 512 }),
  model: varchar("model", { length: 128 }),
  systemMessage: text("systemMessage"),
  extraConfig: jsonb("extraConfig"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmConfig = typeof llmConfigs.$inferSelect;
export type InsertLlmConfig = typeof llmConfigs.$inferInsert;

export const wechatBotState = pgTable("wechat_bot_state", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  status: botStatusEnum().default("stopped").notNull(),
  qrCodeUrl: text("qrCodeUrl"),
  loggedInUser: varchar("loggedInUser", { length: 255 }),
  lastError: text("lastError"),
  /**
   * The iLink bot token, encrypted with a key derived from JWT_SECRET.
   * Equivalent to a WeChat login session — never store this in plaintext.
   */
  botTokenEnc: text("botTokenEnc"),
  /** The iLink bot account id (`ilink_bot_id`). */
  accountId: varchar("accountId", { length: 255 }),
  /** API base URL; may be redirected to another IDC host by the backend. */
  baseUrl: text("baseUrl"),
  /** The account owner's Weixin id (`ilink_user_id`). */
  wechatUserId: varchar("wechatUserId", { length: 255 }),
  /** `get_updates_buf` cursor — must persist or messages are lost on restart. */
  syncBuf: text("syncBuf"),
  /** Timestamp of the last inbound message, used for the 24h keep-alive check. */
  lastInboundAt: timestamp("lastInboundAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One state row per user.
   *
   * The row holds the encrypted bot token and the long-poll cursor, and
   * it was written by a read-then-insert with nothing to stop two of
   * them at once: so two concurrent first writes left the user with two
   * rows — and the read, which took the first row the database felt
   * like returning, did not necessarily return the one that had the
   * token in it.
   *
   * So the button said "connected" — the chip comes from the process's
   * memory — and the monitor said "no credentials, cannot start" and
   * the bot never polled.
   */
  userUniqueIdx: uniqueIndex("wechat_bot_state_user_unique_idx").on(table.userId),
}));

export type WechatBotState = typeof wechatBotState.$inferSelect;
export type InsertWechatBotState = typeof wechatBotState.$inferInsert;

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  category: memoryCategoryEnum().default("memory").notNull(),
  date: varchar("date", { length: 50 }),
  messageId: integer("messageId"),
  /** Retrieval weight — higher means the memory surfaces more readily. */
  importance: integer("importance").default(1).notNull(),
  /** Pinned memories are always injected into the prompt. */
  isPinned: boolean("isPinned").default(false).notNull(),
  /** When the memory was last surfaced, used to damp repeats. */
  lastRecalledAt: timestamp("lastRecalledAt"),
  /** Structured fact key for anchor memories (e.g. `birthday`). */
  factKey: varchar("factKey", { length: 120 }),
  /**
   * Whether this memory still counts.
   *
   * A conflict is not merged. The losing row is marked superseded
   * rather than deleted, so the record of what was said remains.
   */
  status: varchar("status", { length: 16 }).default("active").notNull(),
  /** The memory that won, when this one lost a conflict. */
  supersededBy: integer("supersededBy"),
  /**
   * Whose memory this is.
   *
   * "them" is about the persona; "me" is about the user; "said" is
   * something the persona said inside the app, kept so later turns
   * stay consistent, not as a fact from the records.
   */
  subject: varchar("subject", { length: 8 }).default("them").notNull(),
  /** The record this memory was taken from. */
  recordId: integer("recordId"),
  /** Where the memory came from: `chat`, `records`, or `manual`. */
  source: varchar("source", { length: 16 }).default("chat").notNull(),
  /** How often the title's character bigrams appear in the records. */
  mentionCount: integer("mentionCount").default(0).notNull(),
  /**
   * People, places, and things named in this memory.
   *
   * Each string has to have appeared in the line the memory cites, so
   * retrieval can hop to a related memory without inventing a link.
   */
  entities: jsonb("entities"),
  /** When the memory was put in the bin (C8.11); null means it is not. */
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The memories of one persona.
   *
   * The table had no index, and every turn reads it — the retrieval,
   * the memory panel and the anchors.
   */
  personaUserIdx: index("memories_persona_user_idx").on(table.personaId, table.userId),
  /** The thirty-day sweep of deleted memories. */
  deletedIdx: index("memories_deleted_idx").on(table.deletedAt),
}));

/**
 * When the memories were last extracted.
 *
 * The extraction is a fact about a conversation, so it is kept with the
 * conversation rather than in a settings row.
 */
export const memoryExtractions = pgTable("memory_extractions", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  extractedAt: timestamp("extractedAt").defaultNow().notNull(),
  /**
   * When the extraction last *tried*.
   *
   * `extractedAt` moves only when the answer could be read — so a
   * model that answers with prose instead of JSON left it where it
   * was, and the next turn paid for another call. The attempt is
   * recorded separately, so a failing extraction is retried at most
   * once per interval.
   */
  lastAttemptAt: timestamp("lastAttemptAt").defaultNow().notNull(),
  /**
   * When an extraction last *started*.
   *
   * The extraction is a read and then a write: the window of messages
   * is read, the model is asked about it, and what it says is stored.
   * Two of them running at once read the same window — so the model
   * was asked the same question twice (the user paid twice), and both
   * stored what they were told, so the same memory was in the panel
   * twice.
   *
   * The mark is on the row that already records the extraction, so it
   * is shared by every process: a set in one process's memory would
   * not be.
   *
   * It is cleared when the run ends. A run that never ends — a
   * process that died in the middle of it — leaves the mark behind,
   * and a mark that is old enough belongs to a process that has gone.
   */
  runningAt: timestamp("runningAt"),
}, (table) => ({
  /**
   * The index the migration creates.
   *
   * It was not declared here, so `drizzle-kit push` wanted to drop it
   * on every start — harmless, but a schema and its SQL that disagree
   * are a schema and its SQL that disagree.
   */
  personaIdx: index("memory_extractions_persona_idx").on(table.personaId, table.userId),
  /**
   * One row per persona and user.
   *
   * The row records when the last extraction ran, so there is only
   * ever one of them — and the write says "do nothing on a conflict",
   * which without this constraint could never fire, so a row was
   * added every time and the log grew for ever.
   */
  personaUserUnique: uniqueIndex("memory_extractions_persona_user_unique").on(
    table.personaId,
    table.userId,
  ),
}));

export type Memory = typeof memories.$inferSelect;
export type InsertMemory = typeof memories.$inferInsert;

export const emotionSnapshots = pgTable("emotion_snapshots", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  emotionalState: varchar("emotionalState", { length: 50 }).notNull(),
  messageCount: integer("messageCount").default(0).notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One snapshot per persona, user and day.
   *
   * The row was written by a read and then a write — so two requests
   * that passed the read together both wrote, and the day had two
   * snapshots. The reader took one of them and the other stayed for
   * ever.
   */
  dayUnique: uniqueIndex("emotion_snapshots_persona_user_date_idx")
    .on(table.personaId, table.userId, table.date),
}));

export type EmotionSnapshot = typeof emotionSnapshots.$inferSelect;
export type InsertEmotionSnapshot = typeof emotionSnapshots.$inferInsert;

export const diaryEntries = pgTable("diary_entries", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights"),
  emotionalArc: jsonb("emotionalArc"),
  quotes: jsonb("quotes"),
  reflection: text("reflection"),
  messageCount: integer("messageCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One diary per day.
   *
   * The generation read the day and then wrote it, in two steps — so
   * two requests that passed the read together both wrote, and the user
   * was billed twice for one day and found two entries for it.
   *
   * The database is what should prevent it, not the interface.
   */
  personaUserDateUnique: uniqueIndex("diary_entries_persona_user_date_idx")
    .on(table.personaId, table.userId, table.date),
}));

export type DiaryEntry = typeof diaryEntries.$inferSelect;
export type InsertDiaryEntry = typeof diaryEntries.$inferInsert;

/**
 * The user's own emotional state, recorded by the user.
 *
 * The app modelled the persona and never the person. Everything the user
 * felt was inferred from what they said *to* the persona and stored as the
 * persona's mood — so the analytics page charted the AI's feelings on the
 * user's own dashboard, and a user in the middle of a breakup had nowhere
 * to put how they were actually doing.
 *
 * One row per day. Checking in again replaces the day's entry, so the
 * act of recording is cheap and repeatable.
 */
export const userMoods = pgTable(
  "user_moods",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    /** The day, as "YYYY-MM-DD" in the user's own time zone. */
    date: varchar("date", { length: 10 }).notNull(),
    mood: varchar("mood", { length: 16 }).notNull(),
    /** A word or two, if the user felt like writing one. */
    note: text("note"),
    /** "manual" when the user recorded it, "inferred" when the app did. */
    source: varchar("source", { length: 16 }).default("manual").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userDateIdx: uniqueIndex("user_moods_user_date_idx").on(table.userId, table.date),
  }),
);

export type UserMood = typeof userMoods.$inferSelect;
export type InsertUserMood = typeof userMoods.$inferInsert;

/**
 * What actually happened in the relationship.
 *
 * The app simulated a conversation and remembered the other person's
 * milestones, but it had no place to record reality: that the two of them
 * fought last week, that they got back together, that they broke up, that
 * they are simply out of touch. Without that, the persona's sense of the
 * relationship was frozen at whatever the distillation pipeline decided on
 * the day it ran.
 *
 * The events are the user's own record. The app does not guess them.
 */
export const relationshipEvents = pgTable(
  "relationship_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    personaId: integer("personaId").notNull().references(() => personas.id),
    /**
     * What kind of event it is: "together", "apart", "reunion",
     * "breakup", "conflict", "reconciliation", "news", "meetup",
     * "triggered".
     */
    kind: varchar("kind", { length: 24 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    detail: text("detail"),
    /** When it happened, which is not necessarily when it was recorded. */
    happenedAt: timestamp("happenedAt").defaultNow().notNull(),
    recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  },
  (table) => ({
    personaTimeIdx: index("relationship_events_persona_time_idx").on(
      table.personaId,
      table.happenedAt,
    ),
  }),
);

export type RelationshipEvent = typeof relationshipEvents.$inferSelect;
export type InsertRelationshipEvent = typeof relationshipEvents.$inferInsert;

/**
 * A letter the user wrote to the persona.
 *
 * The app had exactly one way to say something: talk to it, and get an
 * answer. But the things people most want to say to somebody they cannot
 * reach are the things they cannot say *to* them — and the reply is
 * sometimes the problem. Writing a letter that is never delivered, and
 * one that is, are two different acts, and both are missing here.
 *
 * A delivered letter is answered late. Instant replies are the one thing
 * that gives the game away, and a person who has waited a day for
 * someone to answer them would not get an answer in three seconds.
 */
export const letters = pgTable(
  "letters",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().references(() => users.id),
    personaId: integer("personaId").notNull().references(() => personas.id),
    body: text("body").notNull(),
    /**
     * "letter" — something written to the persona.
     * "todo"   — 「等 TA 回来再说」: a note to yourself, kept for the
     *   moment the two of you are in touch again.
     */
    kind: varchar("kind", { length: 16 }).default("letter").notNull(),
    /** How the user was feeling when they wrote it. */
    mood: varchar("mood", { length: 16 }),
    /**
     * "private" — kept, never answered.
     * "waiting" — delivered, the reply is not due yet.
     * "answered" — the persona has replied.
     */
    status: varchar("status", { length: 16 }).default("private").notNull(),
    /** When a note-to-say-later was ticked off (C3.7). */
    doneAt: timestamp("doneAt"),
    /** When the reply is due. */
    replyAt: timestamp("replyAt"),
    repliedAt: timestamp("repliedAt"),
    replyText: text("replyText"),
    /**
     * When the user read this reply (C8.2).
     *
     * The answer is written a day after the letter, when the user is
     * not looking — so an answered letter used to look exactly like one
     * they had already read.
     */
    readAt: timestamp("readAt"),
    /**
     * When a sweep claimed this letter for answering.
     *
     * The claim is a lock, not a state: the letter stays "waiting"
     * until the answer is actually written, so a claim that is never
     * completed — because the process was stopped, or the database
     * hiccuped — does not leave the letter answered with nothing in it.
     *
     * A claim that is older than `LETTER_CLAIM_STALE_MS` is taken to
     * have belonged to a process that is no longer running, and the
     * letter is answered again.
     */
    claimedAt: timestamp("claimedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    personaTimeIdx: index("letters_persona_time_idx").on(table.personaId, table.createdAt),
    dueIdx: index("letters_reply_due_idx").on(table.status, table.replyAt),
    /**
     * The claim lock.
     *
     * The migration created it, and the schema did not declare it —
     * and `drizzle-kit push` drops the objects the schema does not
     * declare, on every boot. So the index that stops the sweep from
     * answering the same letter twice was created and dropped over
     * and over, and the table was scanned in full every minute.
     */
    claimedIdx: index("letters_claimed_idx").on(table.status, table.claimedAt),
    /** The mailbox's "answered but not read" count (C8.2). */
    userReadIdx: index("letters_user_read_idx").on(table.userId, table.status, table.readAt),
  }),
);

export type Letter = typeof letters.$inferSelect;
export type InsertLetter = typeof letters.$inferInsert;

export const scenes = pgTable("scenes", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 10 }),
  systemPromptOverlay: text("systemPromptOverlay"),
  emotionalState: varchar("emotionalState", { length: 50 }),
  starters: jsonb("starters"),
  isBuiltin: boolean("isBuiltin").default(false).notNull(),
  /**
   * The stretch of the record this scene was drawn from (C8.13).
   *
   * `{ personaId, fromId, toId, from, to }`: the two records that end
   * the stretch, the persona it was taken from, and the two days the
   * interface names. Null for an ordinary scene.
   *
   * The lines themselves are not stored — they are read out of the
   * record each time the scene is used, so deleting a record or
   * filtering a harmful one reaches the prompt instead of being frozen
   * into the scene.
   */
  recordRange: jsonb("recordRange"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // A built-in scene is identified by its name, and the seeding routine
  // fills in whatever is missing by name — so two rows with the same name
  // would be indistinguishable. Custom scenes are not covered: the user
  // may name them whatever they like.
  builtinNameUnique: uniqueIndex("scenes_builtin_name_idx")
    .on(table.name).where(sql`${table.isBuiltin} = true`),
}));

export type Scene = typeof scenes.$inferSelect;
export type InsertScene = typeof scenes.$inferInsert;

/**
 * Applied-schema bookkeeping for `scripts/migrate.mjs`.
 *
 * The project ships hand-written idempotent SQL files rather than a Drizzle
 * journal (`drizzle/meta/` is gitignored, so `drizzle-kit migrate` cannot work
 * on a fresh clone). This table records which of those files have run.
 */
export const schemaMigrations = pgTable("schema_migrations", {
  version: varchar("version", { length: 64 }).primaryKey(),
  appliedAt: timestamp("appliedAt").defaultNow().notNull(),
});

export type SchemaMigration = typeof schemaMigrations.$inferSelect;

// ─── Conversation context compaction ────────────────────────────────────────

/**
 * Rolling summaries of conversations that fell out of the context window.
 *
 * Without these the oldest turns are simply dropped, and the persona forgets
 * everything that happened before the last few dozen messages.
 */
export const chatSummaries = pgTable("chat_summaries", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  summary: text("summary").notNull(),
  fromMessageId: integer("fromMessageId"),
  toMessageId: integer("toMessageId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * The summary of one conversation.
   *
   * It is read on every turn — it is the part of the conversation the
   * model does not see — and the table had no index.
   */
  personaUserCreatedIdx: index("chat_summaries_persona_user_created_idx").on(
    table.personaId,
    table.userId,
    table.createdAt,
  ),
}));

export type ChatSummary = typeof chatSummaries.$inferSelect;
export type InsertChatSummary = typeof chatSummaries.$inferInsert;

// ─── Channels ───────────────────────────────────────────────────────────────

/**
 * A conversation channel the user can talk to a persona through.
 *
 * The WeChat ClawBot channel keeps its own tables for one more release; these
 * are the channel-neutral ones that new channels use.
 */
export const channelBindings = pgTable("channel_bindings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Channel identifier, e.g. "wechat" or "feishu". */
  channel: varchar("channel", { length: 32 }).notNull(),
  /** The conversation on the channel — a chat id, not a user id. */
  targetId: varchar("targetId", { length: 255 }).notNull(),
  targetName: varchar("targetName", { length: 255 }),
  personaId: integer("personaId").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // One active default persona per (user, channel, conversation).
  channelTargetUnique: uniqueIndex("channel_bindings_user_channel_target_idx")
    .on(table.userId, table.channel, table.targetId)
    .where(sql`${table.isActive} = true`),
}));

export type ChannelBinding = typeof channelBindings.$inferSelect;
export type InsertChannelBinding = typeof channelBindings.$inferInsert;

/**
 * The persona a channel talks to when a conversation has no binding of
 * its own.
 *
 * A Feishu conversation only learns its id when the first message
 * arrives, so the choice cannot be made per conversation from the
 * interface — and the interface had no choice to make at all, so the
 * channel could never answer.
 *
 * This is the channel-level answer: "the persona Feishu talks to".
 */
export const channelDefaultPersonas = pgTable("channel_default_personas", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Channel identifier, e.g. "wechat" or "feishu". */
  channel: varchar("channel", { length: 32 }).notNull(),
  personaId: integer("personaId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userChannelUnique: uniqueIndex("channel_default_personas_user_channel_idx")
    .on(table.userId, table.channel),
}));

export type ChannelDefaultPersona = typeof channelDefaultPersonas.$inferSelect;

/**
 * Per-user channel state: connection status and encrypted credentials.
 */
export const channelStates = pgTable("channel_states", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  channel: varchar("channel", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("stopped").notNull(),
  /** Credentials, encrypted with a key derived from JWT_SECRET. */
  credentialsEnc: text("credentialsEnc"),
  /** Channel-specific cursor, e.g. the iLink long-poll position. */
  cursor: text("cursor"),
  lastInboundAt: timestamp("lastInboundAt"),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  userChannelUnique: uniqueIndex("channel_states_user_channel_idx")
    .on(table.userId, table.channel),
}));

export type ChannelState = typeof channelStates.$inferSelect;
export type InsertChannelState = typeof channelStates.$inferInsert;

// ─── Persona templates ─────────────────────────────────────────────────────

/**
 * Reusable persona templates.
 *
 * A template is a generalised persona a user can start from. Built-in
 * templates ship as JSON files; these rows hold the user's own.
 */
export const personaTemplates = pgTable("persona_templates", {
  id: serial("id").primaryKey(),
  /** Null for a template that belongs to the installation rather than a user. */
  userId: integer("userId"),
  templateId: varchar("templateId", { length: 100 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  family: varchar("family", { length: 32 }).notNull(),
  description: text("description"),
  tags: jsonb("tags"),
  personaData: jsonb("personaData").notNull(),
  scenePack: jsonb("scenePack"),
  author: varchar("author", { length: 100 }),
  license: varchar("license", { length: 64 }),
  schemaVersion: integer("schemaVersion").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaTemplateRow = typeof personaTemplates.$inferSelect;
export type InsertPersonaTemplate = typeof personaTemplates.$inferInsert;

// ─── Multi-source collection ───────────────────────────────────────────────

/**
 * A platform a chat history can be collected from.
 *
 * The credentials live in `config`, encrypted — they are API tokens for
 * someone else's account.
 */
export const collectionSources = pgTable("collection_sources", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Which platform: "feishu", "dingtalk", "slack", "email", "wechat_export". */
  source: varchar("source", { length: 32 }).notNull(),
  label: varchar("label", { length: 100 }),
  /** The result of the last authorisation check. */
  authState: jsonb("authState"),
  /** Encrypted credentials. */
  config: jsonb("config"),
  status: varchar("status", { length: 32 }).default("stopped").notNull(),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One row per source and user.
   *
   * The authorisation read the table and then wrote to it — so two
   * presses of the button wrote two rows, and the reader took the
   * first of an unordered select: possibly the older credentials.
   */
  userSourceUnique: uniqueIndex("collection_sources_user_source_idx")
    .on(table.userId, table.source),
}));

export type CollectionSource = typeof collectionSources.$inferSelect;
export type InsertCollectionSource = typeof collectionSources.$inferInsert;

/**
 * One collection run.
 *
 * The Python collectors are long-running, so a run is tracked rather than
 * waited on.
 */
export const collectionJobs = pgTable("collection_jobs", {
  id: serial("id").primaryKey(),
  /**
   * The job's own identifier.
   *
   * The job runner uses a UUID, which has to survive a restart — the client
   * polls by it. The serial id stays an internal sequence.
   */
  jobKey: varchar("jobKey", { length: 64 }).notNull(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId"),
  source: varchar("source", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  progress: integer("progress").default(0).notNull(),
  messageCount: integer("messageCount").default(0).notNull(),
  /**
   * How many messages the collector found, before the limit.
   *
   * The count that was kept was the same as the count that was found,
   * so a collection that was cut short said it had found exactly as
   * many as it kept.
   */
  foundCount: integer("foundCount").default(0).notNull(),
  /**
   * How many messages the collection held.
   *
   * It is not the same as the message count, which is how many rows
   * were *new*: re-collecting a history the user already imported
   * writes nothing, and the message count says zero — while the
   * collection still held every message it found.
   *
   * The interface needs both: "how many are in the persona" and "how
   * many were there".
   *
   * It is nullable on purpose. A row that was collected before this
   * column existed has no kept count, and that is not the same as
   * having kept zero — so the column says nothing, and the reader
   * falls back to the message count. `NOT NULL DEFAULT 0` would turn
   * "we do not know" into a number the user reads.
   */
  keptCount: integer("keptCount"),
  /** Whether the collection was cut short at the limit. */
  truncated: boolean("truncated").default(false).notNull(),
  error: text("error"),
  /** Where the raw collector output was written. */
  rawPath: text("rawPath"),
  startedAt: timestamp("startedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  jobKeyUnique: uniqueIndex("collection_jobs_job_key_idx").on(table.jobKey),
}));

export type CollectionJob = typeof collectionJobs.$inferSelect;
export type InsertCollectionJob = typeof collectionJobs.$inferInsert;

/**
 * Messages collected from another platform.
 *
 * Kept separate from the chat history so a collection can be reviewed before
 * it is imported.
 */
export const collectedMessages = pgTable("collected_messages", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /**
   * The key that says "this message is already here".
   *
   * The guarantee that the same sentence is stored once used to rest
   * entirely on a read: the importer read the keys that were there,
   * worked out which of the new ones were new, and wrote the rest.
   * Nothing in the database stopped two of those from running at once —
   * so two instances of the app, or a second copy of the app on the
   * same database, both read the same empty table and both wrote the
   * same history. And the history was duplicated for ever after.
   *
   * So the key is stored, and the database refuses the second copy.
   *
   * It is nullable, and the index only covers the rows that have one:
   * the rows that were collected before this column existed have none,
   * and giving them one would mean guessing at which of two identical
   * messages came first.
   */
  idempotencyKey: text("idempotencyKey"),
  /**
   * The source's own id for this message.
   *
   * The timestamp is what tells two messages apart — and a message
   * without one can only be told apart by its text and by how many
   * times that text has been seen. The collectors return a *window*,
   * not the whole history, so the window moves: the new message gets
   * the occurrence number of one that is already stored, and it is
   * never imported.
   *
   * This is the source's own identifier — Feishu's `message_id`,
   * Slack's `ts`, the page's `data-message-id` — and it does not
   * change. It is nullable: the rows collected before this column
   * existed have none, and giving them one would mean guessing.
   */
  sourceMessageId: text("sourceMessageId"),
  /**
   * What kind of message this is.
   *
   * Text is the default so rows collected before this column existed
   * stay ordinary chat lines. The closed set lives in `shared/records.ts`.
   */
  kind: varchar("kind", { length: 16 }).default("text").notNull(),
  /** The name the export file wrote for this speaker. */
  speaker: varchar("speaker", { length: 100 }),
  /** The `persona_files` row this line was parsed from. Collectors leave it empty. */
  fileId: integer("fileId"),
  /** The line or sequence number in the source file. */
  lineNo: integer("lineNo"),
  /** Kind-specific extras, and the register (`private` / `public` / `written` / `group`). */
  meta: jsonb("meta"),
  /** Speech-act label on this line (B1.4). */
  act: varchar("act", { length: 16 }),
  /** `rule` or `model`. */
  actSource: varchar("actSource", { length: 8 }),
  /** Six-state emotion on this line (B1.5). */
  emotion: varchar("emotion", { length: 16 }),
  /** `rule` or `model`. */
  emotionSource: varchar("emotionSource", { length: 8 }),
  /** Character bigrams for search (C8.6), written by `array_to_tsvector`. */
  searchTokens: tsvector("searchTokens"),
}, (table) => ({
  /**
   * The collected history of one persona.
   *
   * The table holds up to twenty thousand rows a persona, and every
   * distillation reads all of them — with no index, that was a
   * sequential scan of every row of every user on the instance.
   */
  personaUserIdx: index("collected_messages_persona_user_idx").on(table.personaId, table.userId),
  /**
   * One copy of each message, enforced by the database.
   */
  idempotencyUniqueIdx: uniqueIndex("collected_messages_idempotency_unique_idx")
    .on(table.personaId, table.userId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  personaTimeIdx: index("collected_messages_persona_time_idx").on(table.personaId, table.userId, table.timestamp),
  fileIdx: index("collected_messages_file_idx").on(table.personaId, table.userId, table.fileId),
  /** The full-text index (C8.6). */
  searchTokensIdx: index("collected_messages_search_tokens_idx").using("gin", table.searchTokens),
  /** The still-unindexed rows, so the fallback does not force a full scan. */
  missingTokensIdx: index("collected_messages_missing_tokens_idx")
    .on(table.personaId, table.userId)
    .where(sql`${table.searchTokens} IS NULL`),
}));

export type CollectedMessage = typeof collectedMessages.$inferSelect;
export type InsertCollectedMessage = typeof collectedMessages.$inferInsert;

/**
 * One hashed block of records read during distillation.
 *
 * The map stage writes a row even when the block produced no card, so
 * a later run can skip the same hash.
 */
export const distillationChunks = pgTable("distillation_chunks", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  chunkHash: varchar("chunkHash", { length: 64 }).notNull(),
  phase: varchar("phase", { length: 16 }).notNull(),
  cardCount: integer("cardCount").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  hashPhaseUnique: uniqueIndex("distillation_chunks_hash_phase_idx").on(
    table.personaId,
    table.userId,
    table.chunkHash,
    table.phase,
  ),
}));

export type DistillationChunk = typeof distillationChunks.$inferSelect;
export type InsertDistillationChunk = typeof distillationChunks.$inferInsert;

/**
 * One observation, fact, person, or stance taken from a block.
 *
 * The quoted record ids live in `payload`. They stay on this machine;
 * the exported skill package must not carry them.
 */
export const distillationCards = pgTable("distillation_cards", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  chunkHash: varchar("chunkHash", { length: 64 }).notNull(),
  periodId: varchar("periodId", { length: 32 }),
  kind: varchar("kind", { length: 16 }).notNull(),
  dimension: varchar("dimension", { length: 16 }),
  claim: text("claim").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  kindIdx: index("distillation_cards_kind_idx").on(table.personaId, table.userId, table.kind),
}));

export type DistillationCard = typeof distillationCards.$inferSelect;
export type InsertDistillationCard = typeof distillationCards.$inferInsert;

/**
 * A snapshot of the persona taken before a rewrite.
 *
 * Distillation, a full edit, a correction, and a restore each store
 * one. The last twenty are kept.
 */
export const personaVersions = pgTable("persona_versions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  reason: varchar("reason", { length: 32 }).notNull(),
  personaData: jsonb("personaData"),
  styleProfile: jsonb("styleProfile"),
  behaviorProfile: jsonb("behaviorProfile"),
  settings: jsonb("settings"),
  evalRunId: integer("evalRunId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaCreatedIdx: index("persona_versions_persona_created_idx").on(
    table.personaId,
    table.userId,
    table.createdAt,
  ),
}));

export type PersonaVersion = typeof personaVersions.$inferSelect;
export type InsertPersonaVersion = typeof personaVersions.$inferInsert;

// ─── Celebrity research ────────────────────────────────────────────────────

/**
 * The artefacts of the celebrity research flow.
 *
 * One row per persona and profile, holding what each of the four stages
 * produced.
 */
export const researchProfiles = pgTable("research_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The research profile, e.g. "budget-unfriendly". */
  profile: varchar("profile", { length: 32 }).notNull(),
  /** Stage 1: the structured research notes. */
  notes: jsonb("notes"),
  /** Stage 2: the audit verdict and the gaps it found. */
  audit: jsonb("audit"),
  /** Stage 3: the mental models and known-answer questions. */
  synthesis: jsonb("synthesis"),
  /** Stage 4: the validation result. */
  validation: jsonb("validation"),
  /** The code-level quality gate's report. */
  qualityReport: jsonb("qualityReport"),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  /**
   * One row per persona and profile.
   *
   * The table says so — but the write was a plain insert, so every
   * celebrity distillation added another row, and the table grew for
   * the life of the instance.
   */
  personaProfileUnique: uniqueIndex("research_profiles_persona_profile_idx")
    .on(table.personaId, table.userId, table.profile),
}));

export type ResearchProfile = typeof researchProfiles.$inferSelect;
export type InsertResearchProfile = typeof researchProfiles.$inferInsert;

// ─── Questionnaire answers ─────────────────────────────────────────────────

/**
 * The raw answers from the guided questionnaire.
 *
 * Kept so the user can revisit and edit what they wrote, and so the answers
 * can be re-run through the distillation pipeline later.
 */
export const personaQuestionnaireAnswers = pgTable("persona_questionnaire_answers", {
  id: serial("id").primaryKey(),
  personaId: integer("personaId").notNull(),
  userId: integer("userId").notNull(),
  answers: jsonb("answers").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PersonaQuestionnaireAnswer = typeof personaQuestionnaireAnswers.$inferSelect;
export type InsertPersonaQuestionnaireAnswer = typeof personaQuestionnaireAnswers.$inferInsert;

// ─── Proactive reminders ───────────────────────────────────────────────────

/**
 * A reminder that was (or was about to be) delivered.
 *
 * The row is what stops the same reminder going out twice — "today is your
 * anniversary" should arrive once, not once per scheduler tick.
 */
export const reminderDeliveries = pgTable("reminder_deliveries", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The channel it was delivered on: "wechat", "feishu" or "web". */
  channel: varchar("channel", { length: 32 }).notNull(),
  /** What kind of reminder it was. */
  kind: varchar("kind", { length: 32 }).notNull(),
  /** The text that was delivered, so the web client can show it too. */
  text: text("text"),
  /** A stable key for this reminder on this day, used to deduplicate. */
  dedupeKey: varchar("dedupeKey", { length: 200 }).notNull(),
  scheduledFor: timestamp("scheduledFor").notNull(),
  deliveredAt: timestamp("deliveredAt"),
  dismissedAt: timestamp("dismissedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  dedupeUnique: uniqueIndex("reminder_deliveries_dedupe_idx")
    .on(table.userId, table.dedupeKey),
}));

export type ReminderDelivery = typeof reminderDeliveries.$inferSelect;
export type InsertReminderDelivery = typeof reminderDeliveries.$inferInsert;

// ─── Emotional safety ───────────────────────────────────────────────────────

export const safetyEventTypeEnum = pgEnum("safety_event_type", [
  "crisis", "usage", "dependency", "graduation_trajectory",
  /**
   * Ordinary distress.
   *
   * The safety layer notices it — the wording of a message says the
   * person is worn out — and it changes what the persona says. But
   * nothing was written down, so the panel that shows what the app
   * noticed did not show it.
   */
  "distress",
]);

export const safetyEventSeverityEnum = pgEnum("safety_event_severity", ["info", "warning", "critical"]);

/**
 * Records of safety interventions.
 *
 * These never leave the machine — the product's privacy promise is that user
 * data is not shipped anywhere.
 */
export const safetyEvents = pgTable("safety_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId"),
  type: safetyEventTypeEnum().notNull(),
  severity: safetyEventSeverityEnum().default("info").notNull(),
  /** Short, non-identifying note about what triggered the event. */
  excerpt: text("excerpt"),
  handled: boolean("handled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
}, (table) => ({
  /**
   * The safety record of one user, newest first.
   *
   * The panel reads it and the lobby counts it, and the table had no
   * index.
   */
  userCreatedIdx: index("safety_events_user_created_idx").on(table.userId, table.createdAt),
}));

export type SafetyEvent = typeof safetyEvents.$inferSelect;
export type InsertSafetyEvent = typeof safetyEvents.$inferInsert;

/**
 * Weekly emotional-trajectory assessments, used to notice that a user is
 * moving towards closure even before the hard graduation thresholds are met.
 */
export const graduationAssessments = pgTable("graduation_assessments", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  windowStart: timestamp("windowStart").notNull(),
  windowEnd: timestamp("windowEnd").notNull(),
  trajectory: varchar("trajectory", { length: 32 }).notNull(),
  regretRatio: integer("regretRatio").default(0).notNull(),
  gratitudeRatio: integer("gratitudeRatio").default(0).notNull(),
  assessment: jsonb("assessment"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GraduationAssessment = typeof graduationAssessments.$inferSelect;
export type InsertGraduationAssessment = typeof graduationAssessments.$inferInsert;

// ─── Fidelity evaluation ────────────────────────────────────────────────────

/**
 * One held-out exchange, used to answer the only question that matters
 * when the persona is rebuilt: does it still sound like them?
 *
 * Every existing test checks a *mechanism* — that the schema is shaped
 * right, that the prompt is assembled, that the state machine switches.
 * None of them check whether the persona still sounds like the person.
 * These cases are that ruler: a stretch of real conversation with the
 * person's real reply removed, so the rebuilt persona has to produce it.
 */
export const evalCases = pgTable("eval_cases", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The messages that led up to the held-out reply. */
  contextJson: jsonb("contextJson").notNull(),
  /** What the person actually said. The ground truth. */
  expectedJson: jsonb("expectedJson").notNull(),
  /** The emotion the real reply carried, for the per-state buckets. */
  expectedState: varchar("expectedState", { length: 32 }),
  /** The speech act of the held-out line, cached so evaluation does not relabel. */
  expectedAct: varchar("expectedAct", { length: 32 }),
  /** `rule` or `model` — where the cached act came from. */
  expectedActSource: varchar("expectedActSource", { length: 16 }),
  /** Where the case came from, so a case can be traced back to the record. */
  source: varchar("source", { length: 32 }).default("collected").notNull(),
  /** The timestamp of the held-out reply in the original conversation. */
  occurredAt: timestamp("occurredAt"),
  /** Which stretch of the record the held-out line sat in. */
  periodId: varchar("periodId", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaIdx: index("eval_cases_persona_idx").on(table.personaId),
}));

export type EvalCase = typeof evalCases.$inferSelect;
export type InsertEvalCase = typeof evalCases.$inferInsert;

/**
 * What the rebuilt persona said, and what it was scored against.
 *
 * The metrics need somewhere to live, because a ruler that has to be
 * recalculated by hand is a ruler nobody uses.
 */
export const evalRuns = pgTable("eval_runs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The metrics this run produced. */
  metricsJson: jsonb("metricsJson").notNull(),
  /** What the persona looked like when the run happened. */
  personaSnapshot: jsonb("personaSnapshot"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaIdx: index("eval_runs_persona_idx").on(table.personaId),
}));

export type EvalRun = typeof evalRuns.$inferSelect;
export type InsertEvalRun = typeof evalRuns.$inferInsert;

// ─── The way out ────────────────────────────────────────────────────────────

/**
 * The letters the user takes back to the real person.
 *
 * The graduation ritual ends with a farewell written in the persona's
 * voice. But the thing that was actually unfinished was never the
 * persona's sentence — it was the user's. They said things here that they
 * never said to the person they were talking about, and the app's whole
 * promise is that saying them here was the useful part.
 *
 * So graduation has an exit as well as a door: the words that were only
 * ever said to the persona, collected and handed back. Nothing is sent.
 * The app never speaks for the person who is not in the room.
 */
export const outboundLetters = pgTable("outbound_letters", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The user's own words. Never the persona's. */
  text: text("text").notNull(),
  /** Where in the conversation this came from, so it can be traced. */
  sourceMessageId: integer("sourceMessageId"),
  /** draft — the user is still writing; ready — offered to be sent. */
  status: varchar("status", { length: 16 }).default("draft").notNull(),
  /** When the user decided to keep it. */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  /** When the user sent it — to the real person, themselves. */
  sentAt: timestamp("sentAt"),
  /**
   * What happened after the user said it (C3.5).
   *
   * The list used to end at "I said it" — the app recorded the fact
   * and then had nothing to say. Optionally, the user can write down
   * how it went; that note becomes a relationship event. It is never
   * asked for twice, and nothing is required.
   */
  outcomeNote: text("outcomeNote"),
  /** When the note was written. */
  outcomeAt: timestamp("outcomeAt"),
  /**
   * Whether the words came from the wording assistant (C3.6).
   *
   * The suggestion is never saved on its own: the user has to pick it
   * and save. This column records that the sentence that ended up here
   * started as a suggestion — it is shown next to the letter, so the
   * user can always tell which of their words the model helped with.
   */
  wordingAssisted: boolean("wordingAssisted").default(false).notNull(),
  /** When the user decided it would never be sent. */
  droppedAt: timestamp("droppedAt"),
  /**
   * When the letter was pointed out for having waited too long.
   *
   * A letter that has been sitting for a month is not going to be sent
   * by accident, and saying so once is useful. Saying it every time the
   * page is opened is the app nagging — which is the one thing this
   * product promises not to do. So the reminder is recorded, and it is
   * said once.
   */
  staleNotifiedAt: timestamp("staleNotifiedAt"),
}, (table) => ({
  personaIdx: index("outbound_letters_persona_idx").on(table.personaId),
  statusIdx: index("outbound_letters_status_idx").on(table.status),
  /**
   * The same sentence is offered once.
   *
   * The list whose whole purpose is to hand the user back their own
   * words, without duplicates. The duplicate was prevented by a read —
   * the router read the list, saw the message was already there, and
   * skipped it — and a read is a read: two collects at once (a
   * double-click, two tabs) both read the same list, both decided the
   * message was new, and both inserted.
   *
   * So the database refuses the second copy.
   *
   * It is partial: a letter the user wrote themselves has no source
   * message, and two of those are two different letters.
   */
  sourceUniqueIdx: uniqueIndex("outbound_letters_source_unique_idx")
    .on(table.personaId, table.sourceMessageId)
    .where(sql`${table.sourceMessageId} IS NOT NULL`),
}));

export type OutboundLetter = typeof outboundLetters.$inferSelect;
export type InsertOutboundLetter = typeof outboundLetters.$inferInsert;

/**
 * A turn in the rehearsal room (C3.2).
 *
 * The user says a sentence they are afraid to say, and the app shows a
 * few of the ways the person might take it. The rehearsal is practice,
 * not a conversation: it never becomes a message, a memory, a mood, or a
 * chat count. Only the line and the result are kept, so the user can
 * find the sentence again and take it to the way-out list.
 */
export const rehearsals = pgTable("rehearsals", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The sentence the user was practising. Their own words. */
  line: text("line").notNull(),
  /** The variants that were generated: act, share, text, silent. */
  result: jsonb("result").notNull(),
  /** Set when the line was kept for the way-out list. */
  outboundLetterId: integer("outboundLetterId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaTimeIdx: index("rehearsals_persona_time_idx").on(table.personaId, table.createdAt),
  userTimeIdx: index("rehearsals_user_time_idx").on(table.userId, table.createdAt),
}));

export type Rehearsal = typeof rehearsals.$inferSelect;
export type InsertRehearsal = typeof rehearsals.$inferInsert;

/**
 * How the user felt after a conversation (C4.2).
 *
 * The app measured the persona's mood and never asked the person how
 * the conversation left them. One answer per session, in four words;
 * skipped is an answer too. Nothing here is a score: it is what the user
 * said, kept so that three "worse" in a row can be noticed and so the
 * trend can be read back to them.
 */
export const sessionCheckins = pgTable("session_checkins", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The start of the session the answer is about. */
  sessionStartAt: timestamp("sessionStartAt").notNull(),
  /** better / same / worse / skipped. */
  answer: varchar("answer", { length: 8 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  sessionUnique: uniqueIndex("session_checkins_session_idx")
    .on(table.userId, table.personaId, table.sessionStartAt),
  userTimeIdx: index("session_checkins_user_time_idx").on(table.userId, table.createdAt),
  personaTimeIdx: index("session_checkins_persona_time_idx").on(table.personaId, table.createdAt),
}));

export type SessionCheckin = typeof sessionCheckins.$inferSelect;
export type InsertSessionCheckin = typeof sessionCheckins.$inferInsert;

/**
 * That the after-chat question was *shown* (C4.2).
 *
 * The question is allowed once a day. Counting answers is not enough:
 * a person who sees the question and ignores it has not answered it,
 * and without a record of having asked, the next session that day asked
 * again. This row is the record of the asking, separate from the answer.
 *
 * It is unique per session: the same session is not asked twice.
 */
export const sessionCheckinPrompts = pgTable("session_checkin_prompts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  /** The session the question was about. */
  sessionStartAt: timestamp("sessionStartAt").notNull(),
  /** When the question was put on the screen. */
  promptedAt: timestamp("promptedAt").defaultNow().notNull(),
}, (table) => ({
  sessionUnique: uniqueIndex("session_checkin_prompts_session_idx")
    .on(table.userId, table.personaId, table.sessionStartAt),
  userTimeIdx: index("session_checkin_prompts_user_time_idx").on(table.userId, table.promptedAt),
  personaTimeIdx: index("session_checkin_prompts_persona_time_idx").on(table.personaId, table.promptedAt),
}));

export type SessionCheckinPrompt = typeof sessionCheckinPrompts.$inferSelect;
export type InsertSessionCheckinPrompt = typeof sessionCheckinPrompts.$inferInsert;

/**
 * The user's own diary (C4.5).
 *
 * `diary_entries` is the app's summary of a conversation. This is the
 * other thing: what the person wrote themselves. It is not sent to a
 * model, not extracted for memories, and not part of the persona — it
 * exists for the user to read back, and in the export.
 */
export const userJournal = pgTable("user_journal", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** Optional: a note can belong to one persona or to no one. */
  personaId: integer("personaId"),
  body: text("body").notNull(),
  mood: varchar("mood", { length: 16 }),
  /** The day, in the writer's own time zone. */
  entryDate: varchar("entryDate", { length: 10 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  userDateIdx: index("user_journal_user_date_idx").on(table.userId, table.entryDate),
  personaDateIdx: index("user_journal_persona_date_idx").on(table.personaId, table.entryDate),
}));

export type UserJournalEntry = typeof userJournal.$inferSelect;
export type InsertUserJournalEntry = typeof userJournal.$inferInsert;

/**
 * One "swap places" practice (C4.4).
 *
 * The user plays the person, and the app plays the user, rebuilt from
 * their own lines. It is a practice, bounded to fifteen minutes and
 * thirty turns, once a day. Nothing here is a message, a memory, a mood
 * or a chat count — the transcript is the whole of it.
 */
export const roleplaySessions = pgTable("roleplay_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  startedAt: timestamp("startedAt").notNull(),
  endedAt: timestamp("endedAt"),
  turns: integer("turns").default(0).notNull(),
  transcript: jsonb("transcript"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userTimeIdx: index("roleplay_sessions_user_time_idx").on(table.userId, table.createdAt),
  personaTimeIdx: index("roleplay_sessions_persona_time_idx").on(table.personaId, table.createdAt),
}));

export type RoleplaySession = typeof roleplaySessions.$inferSelect;
export type InsertRoleplaySession = typeof roleplaySessions.$inferInsert;

/**
 * A reply the user marked as not sounding like them.
 *
 * The reason is a closed set: the action was wrong, it was too
 * complete, it asked, it used a word they would not, it invented, the
 * mood was off, or the timing was. Free text is not collected — a
 * reason that cannot be aggregated cannot be fed back.
 */
export const fidelityFeedback = pgTable("fidelity_feedback", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  messageId: integer("messageId").notNull(),
  reason: varchar("reason", { length: 16 }).notNull(),
  /** What they would have said. Empty until the reader fills it in. */
  rewrite: text("rewrite"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaUserIdx: index("fidelity_feedback_persona_user_idx").on(table.personaId, table.userId),
  messageIdx: index("fidelity_feedback_message_idx").on(table.messageId),
}));

export type FidelityFeedback = typeof fidelityFeedback.$inferSelect;
export type InsertFidelityFeedback = typeof fidelityFeedback.$inferInsert;

/**
 * One A/B choice from the web chat.
 *
 * Every eight turns the persona offers two unreplied lines. The one
 * the user picks is stored as the reply; this row keeps both lines and
 * the scoring features so thirty of them can train rerank weights.
 */
export const fidelityPairs = pgTable("fidelity_pairs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  messageId: integer("messageId").notNull(),
  chosenText: text("chosenText").notNull(),
  rejectedText: text("rejectedText").notNull(),
  features: jsonb("features"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaUserIdx: index("fidelity_pairs_persona_user_idx").on(table.personaId, table.userId),
}));

export type FidelityPair = typeof fidelityPairs.$inferSelect;
export type InsertFidelityPair = typeof fidelityPairs.$inferInsert;

/**
 * One sitting of the in-app blind test.
 *
 * A real line and a rebuilt one are shown without saying which is which.
 * The groups keep the truth; the answers do not see it until the sitting
 * is finished. A friend gets a hashed token, not an account.
 */
export const blindSessions = pgTable("blind_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  subject: varchar("subject", { length: 8 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }),
  expiresAt: timestamp("expiresAt"),
  groups: jsonb("groups").notNull(),
  answers: jsonb("answers"),
  summary: jsonb("summary"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaUserIdx: index("blind_sessions_persona_user_idx").on(table.personaId, table.userId),
  tokenHashIdx: uniqueIndex("blind_sessions_token_hash_idx").on(table.tokenHash),
}));

export type BlindSession = typeof blindSessions.$inferSelect;
export type InsertBlindSession = typeof blindSessions.$inferInsert;

/**
 * One embedding of a record, for the optional second exemplar scorer.
 *
 * The vector is the previous user burst of a TA turn, L2-normalised and
 * stored as int8. The model name is part of the key so a later embed
 * model does not mix with an older one.
 */
export const recordEmbeddings = pgTable("record_embeddings", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  recordId: integer("recordId").notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  dim: integer("dim").notNull(),
  vec: bytea("vec").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  personaRecordModelIdx: uniqueIndex("record_embeddings_persona_record_model_idx")
    .on(table.personaId, table.recordId, table.model),
  personaUserIdx: index("record_embeddings_persona_user_idx").on(table.personaId, table.userId),
}));

export type RecordEmbedding = typeof recordEmbeddings.$inferSelect;
export type InsertRecordEmbedding = typeof recordEmbeddings.$inferInsert;

/**
 * A browser push subscription.
 *
 * The endpoint is the browser vendor's address. There is no persona on
 * the row: a subscription belongs to the account, and one browser can
 * only be subscribed once.
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: varchar("userAgent", { length: 255 }),
  showPreview: boolean("showPreview").default(false).notNull(),
  failCount: integer("failCount").default(0).notNull(),
  lastSuccessAt: timestamp("lastSuccessAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  endpointIdx: uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
  userIdx: index("push_subscriptions_user_idx").on(table.userId),
}));

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

/**
 * A reply that will be written later.
 *
 * The row is the moment they look at their phone, not a pre-written
 * answer. When it comes due, the turn answers every user message that
 * is still waiting. One persona has at most one pending reply.
 */
export const replyJobs = pgTable("reply_jobs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  reason: varchar("reason", { length: 16 }).notNull(),
  dueAt: timestamp("dueAt").notNull(),
  channel: varchar("channel", { length: 16 }).notNull(),
  targetId: varchar("targetId", { length: 255 }),
  locale: varchar("locale", { length: 8 }).notNull(),
  periodId: varchar("periodId", { length: 64 }),
  attempts: integer("attempts").default(0).notNull(),
  claimedAt: timestamp("claimedAt"),
  payload: jsonb("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({
  onePendingReply: uniqueIndex("reply_jobs_one_pending_reply_idx")
    .on(table.userId, table.personaId)
    .where(sql`${table.status} IN ('pending', 'running') AND ${table.kind} = 'reply'`),
  dueIdx: index("reply_jobs_due_idx")
    .on(table.dueAt)
    .where(sql`${table.status} = 'pending'`),
}));

export type ReplyJob = typeof replyJobs.$inferSelect;
export type InsertReplyJob = typeof replyJobs.$inferInsert;

/**
 * The stickers they actually used.
 *
 * A persona that sent `[sticker:狗狗探头]` six times can send it again —
 * and only it. The library is measured from the record, never invented,
 * so a persona who never used a sticker never sends one.
 *
 * `key` is the content hash when there is an image and `label:<name>`
 * when there is only a name, so two imports of the same pack keep one
 * row. `fileKey` points at a copy under `personas/<userId>/<personaId>/stickers/`,
 * made because the import directory can be deleted.
 */
export const stickers = pgTable("stickers", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  key: varchar("key", { length: 128 }).notNull(),
  label: varchar("label", { length: 64 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }),
  mime: varchar("mime", { length: 64 }),
  usesByThem: integer("usesByThem").default(0).notNull(),
  usesByMe: integer("usesByMe").default(0).notNull(),
  firstUsedAt: timestamp("firstUsedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  oneKey: uniqueIndex("stickers_persona_key_idx").on(
    table.personaId,
    table.userId,
    table.key,
  ),
  personaIdx: index("stickers_persona_idx").on(table.personaId, table.userId),
}));

export type Sticker = typeof stickers.$inferSelect;
export type InsertSticker = typeof stickers.$inferInsert;

/**
 * The recordings, photographs and videos the record carries.
 *
 * A row points at the original file inside the import directory — the
 * audio is not copied, because it can be large and the import is where
 * the user put it. `hash` is the file's content, so importing the same
 * export twice registers the same recording once.
 */
export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  kind: varchar("kind", { length: 8 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mime: varchar("mime", { length: 64 }),
  bytes: integer("bytes"),
  hash: varchar("hash", { length: 64 }).notNull(),
  at: timestamp("at"),
  recordId: integer("recordId"),
  fileId: integer("fileId"),
  fromThem: boolean("fromThem").default(false).notNull(),
  durationSec: integer("durationSec"),
  width: integer("width"),
  height: integer("height"),
  transcript: text("transcript"),
  transcriptEngine: varchar("transcriptEngine", { length: 32 }),
  exif: jsonb("exif"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  oneHash: uniqueIndex("media_persona_hash_idx").on(
    table.personaId,
    table.userId,
    table.hash,
  ),
  personaIdx: index("media_persona_idx").on(table.personaId, table.userId),
  recordIdx: index("media_record_idx").on(table.recordId),
}));

export type Media = typeof media.$inferSelect;
export type InsertMedia = typeof media.$inferInsert;

/**
 * A photograph the user attached to a memory (B7.8).
 *
 * The photo lives in `media`; this table only says which memory it
 * belongs to. A photo can belong to more than one memory and a memory
 * can carry more than one photo.
 */
export const memoryMedia = pgTable("memory_media", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  memoryId: integer("memoryId").notNull(),
  mediaId: integer("mediaId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  onePair: uniqueIndex("memory_media_pair_idx").on(table.memoryId, table.mediaId),
  personaIdx: index("memory_media_persona_idx").on(table.personaId, table.userId),
  mediaIdx: index("memory_media_media_idx").on(table.mediaId),
}));

export type MemoryMedia = typeof memoryMedia.$inferSelect;
export type InsertMemoryMedia = typeof memoryMedia.$inferInsert;

/**
 * A bookmark or a note on one record (C2.10).
 *
 * The reader lets the user keep a line. It is their own copy of the
 * archive, so the mark is scoped to both the persona and the user; a
 * line can have one bookmark and one note.
 */
export const recordMarks = pgTable("record_marks", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  recordId: integer("recordId").notNull(),
  /** `bookmark` or `note`. */
  kind: varchar("kind", { length: 8 }).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  onePerKind: uniqueIndex("record_marks_pair_idx").on(
    table.personaId,
    table.userId,
    table.recordId,
    table.kind,
  ),
  personaIdx: index("record_marks_persona_idx").on(table.personaId, table.userId),
  recordIdx: index("record_marks_record_idx").on(table.recordId),
}));

export type RecordMark = typeof recordMarks.$inferSelect;
export type InsertRecordMark = typeof recordMarks.$inferInsert;

/**
 * The cached numbers of one persona's report (C2.4).
 *
 * A full pass over the record is not something to do every time the
 * page is opened, so the report is kept with the records version it was
 * built from. A new import changes the version and the next read
 * rebuilds it.
 */
export const recordReports = pgTable("record_reports", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  recordsVersion: varchar("recordsVersion", { length: 64 }).notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  onePerPersona: uniqueIndex("record_reports_persona_idx").on(table.personaId, table.userId),
  userIdx: index("record_reports_user_idx").on(table.userId),
}));

export type RecordReportRow = typeof recordReports.$inferSelect;
export type InsertRecordReport = typeof recordReports.$inferInsert;

/**
 * Something the user scheduled to arrive later (C5.3).
 *
 * Three kinds, one table:
 *
 *   - `capsule` — a letter to the user's own future self. Its body is
 *     not returned before the day; after it, the letter box can open it.
 *   - `message` — a line to the persona, sent at that moment. It enters
 *     the conversation as the user's own message and the persona answers
 *     as usual.
 *   - `letter` — a letter to the persona, written now and delivered on
 *     the day. It becomes a normal letter and gets a normal answer.
 *
 * `claimedAt` is the lock that keeps two sweeps from delivering the same
 * thing twice, the same way `reply_jobs` does it.
 */
export const scheduledItems = pgTable("scheduled_items", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  body: text("body").notNull(),
  dueAt: timestamp("dueAt").notNull(),
  /** `scheduled`, `delivered` or `cancelled`. */
  status: varchar("status", { length: 16 }).default("scheduled").notNull(),
  /**
   * Why a scheduled item was called off.
   *
   * `asleep`, `sealed`, `closed` (the taper says no chat that day) or
   * `deleted`. The interface says the reason instead of an empty state.
   */
  cancelReason: varchar("cancelReason", { length: 16 }),
  claimedAt: timestamp("claimedAt"),
  deliveredAt: timestamp("deliveredAt"),
  /**
   * When a capsule was opened, on or after its day (C8.2).
   *
   * The inbox counts the due capsules that were not opened; without
   * this column it can only see that the day came, and a capsule that
   * was read on the morning of the day kept counting as waiting.
   */
  openedAt: timestamp("openedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userDueIdx: index("scheduled_items_user_due_idx").on(table.userId, table.status, table.dueAt),
  personaIdx: index("scheduled_items_persona_idx").on(table.personaId, table.userId),
  dueIdx: index("scheduled_items_due_idx").on(table.dueAt),
  /** The mailbox's "due but not opened" count (C8.2). */
  userOpenedIdx: index("scheduled_items_user_opened_idx").on(
    table.userId,
    table.kind,
    table.status,
    table.openedAt,
  ),
}));

export type ScheduledItem = typeof scheduledItems.$inferSelect;
export type InsertScheduledItem = typeof scheduledItems.$inferInsert;

// ─── The cost panel (C8.9) ──────────────────────────────────────────────────

/**
 * One row per model call.
 *
 * The app spends the user's money (or the operator's) on every reply,
 * and there was no record of it: not which feature was expensive, not
 * how many tokens a distillation read, not what a month of chatting
 * cost. A row says which call it was, how many tokens it used, and —
 * when the user has filled in a price — what it cost.
 *
 * `estimated` is true when the provider did not report usage and the
 * numbers were counted locally. An estimate is not a measurement and it
 * says so, so a total can be read correctly.
 */
export const llmUsage = pgTable("llm_usage", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  /** The persona the call was for, when it was for one. */
  personaId: integer("personaId"),
  provider: varchar("provider", { length: 64 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  purpose: varchar("purpose", { length: 16 }).notNull(),
  promptTokens: integer("promptTokens").notNull(),
  completionTokens: integer("completionTokens").notNull(),
  estimated: boolean("estimated").default(false).notNull(),
  /** Millionths of the configured currency; empty when no price is set. */
  costMicros: bigint("costMicros", { mode: "number" }),
  /** The distillation or evaluation job the calls belong to. */
  jobId: varchar("jobId", { length: 64 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userCreatedIdx: index("llm_usage_user_created_idx").on(table.userId, table.createdAt),
  jobIdx: index("llm_usage_job_idx").on(table.jobId),
}));

export type LlmUsageRow = typeof llmUsage.$inferSelect;
export type InsertLlmUsage = typeof llmUsage.$inferInsert;

// ─── Conversation management (C8.10) ──────────────────────────────────────

/**
 * A star, a pin, or a topic marker on one message.
 *
 * A conversation is long, and the three things a person wants from a
 * long conversation were all missing: the message they want to find
 * again ("star"), the few they keep in front of them ("pin"), and a
 * named point they can return to ("topic"). All three point at one
 * message — a topic is a signpost inside the same conversation, not a
 * second conversation.
 */
export const messageMarks = pgTable("message_marks", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  messageId: integer("messageId").notNull(),
  /** "star", "pin" or "topic". */
  kind: varchar("kind", { length: 8 }).notNull(),
  /** The name of a topic; empty for a star or a pin. */
  label: varchar("label", { length: 60 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  onePerKind: uniqueIndex("message_marks_user_message_kind_idx").on(
    table.userId,
    table.messageId,
    table.kind,
  ),
  personaIdx: index("message_marks_persona_idx").on(
    table.personaId,
    table.userId,
    table.kind,
  ),
}));

export type MessageMark = typeof messageMarks.$inferSelect;
export type InsertMessageMark = typeof messageMarks.$inferInsert;

/**
 * An API key for the OpenAI-compatible endpoint (C9.2).
 *
 * Only the hash of the key is stored — the key itself is shown once, when
 * it is created, and never again. `prefix` is the first characters, which
 * is enough for the settings page to name the key without knowing it.
 */
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  /** sha256 of the whole key, hexadecimal. */
  keyHash: varchar("keyHash", { length: 64 }).notNull(),
  /** The first characters, for the list. */
  prefix: varchar("prefix", { length: 12 }).notNull(),
  /** `["chat"]`, `["read"]` or both. */
  scopes: jsonb("scopes").default(["chat"]).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  revokedAt: timestamp("revokedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  hashIdx: uniqueIndex("api_keys_hash_idx").on(table.keyHash),
  userIdx: index("api_keys_user_idx").on(table.userId),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;


// ─── Group chat (C9.8) ─────────────────────────────────────────────────────
//
// The user unlocks group chat themselves (users.features). A room holds
// two to five of their own personas; the personas only speak after the
// user does, and their words stay here — they never enter `messages`, the
// pair's memories, the mood, the intimacy or the graduation mechanism.

/** One group room: a name and the user it belongs to. */
export const groupRooms = pgTable("group_rooms", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 60 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("group_rooms_user_idx").on(table.userId),
}));

export type GroupRoom = typeof groupRooms.$inferSelect;
export type InsertGroupRoom = typeof groupRooms.$inferInsert;

/**
 * One persona in one room.
 *
 * `(roomId, personaId)` is unique: a persona can be in a room once. The
 * `userId` is on the row as well, so every read can filter by owner
 * without a join.
 */
export const groupRoomMembers = pgTable("group_room_members", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  userId: integer("userId").notNull(),
  personaId: integer("personaId").notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
}, (table) => ({
  onePerRoom: uniqueIndex("group_room_members_room_persona_idx").on(
    table.roomId,
    table.personaId,
  ),
  roomIdx: index("group_room_members_room_idx").on(table.roomId, table.userId),
  personaIdx: index("group_room_members_persona_idx").on(table.personaId, table.userId),
}));

export type GroupRoomMember = typeof groupRoomMembers.$inferSelect;
export type InsertGroupRoomMember = typeof groupRoomMembers.$inferInsert;

/**
 * One line in a group room.
 *
 * `role` is the same two values the pair's conversation uses: `user` is
 * the person, `assistant` is a persona (named by `personaId`). The room's
 * history is the only place these rows go.
 */
export const groupMessages = pgTable("group_messages", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  userId: integer("userId").notNull(),
  role: messageRoleEnum().notNull(),
  /** The persona that said it; empty for the user's own lines. */
  personaId: integer("personaId"),
  content: text("content").notNull(),
  /** Which personas were named, and the reply's timing, when relevant. */
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  roomTimeIdx: index("group_messages_room_time_idx").on(table.roomId, table.createdAt),
  userIdx: index("group_messages_user_idx").on(table.userId),
  personaIdx: index("group_messages_persona_idx").on(table.personaId, table.userId),
}));

export type GroupMessage = typeof groupMessages.$inferSelect;
export type InsertGroupMessage = typeof groupMessages.$inferInsert;
