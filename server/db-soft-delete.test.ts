import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  addMessageMark,
  clearMessagesByPersonaId,
  countMemories,
  createMemory,
  createMessage,
  createPersona,
  createPersonaFile,
  createUser,
  deleteUserAccount,
  exportUserData,
  getAllPersonasForReminders,
  getDb,
  getExportData,
  getMemoriesByPersonaId,
  getMessageById,
  getMessagesByPersonaId,
  getPersonaById,
  getPersonaByIdIncludingDeleted,
  getPersonasByUserId,
  getPersonasWithStats,
  getProactivePersonas,
  listDeletedPersonas,
  purgeExpiredPersonas,
  purgePersona,
  restoreMemory,
  restoreMessage,
  restorePersona,
  searchAllMessages,
  searchMessages,
  softDeleteMemory,
  softDeleteMessage,
  softDeletePersona,
} from "./db";
import { personas, messages, memories } from "../drizzle/schema";
import { storagePut } from "./storage";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Undo and the recycle bin (C8.11).
 *
 * Two kinds of test live here.
 *
 * The first kind runs everywhere: it reads `server/db.ts` and
 * `drizzle/schema.ts` and checks the structure that makes a forgotten
 * filter impossible to miss. Every read of `personas`, `messages` or
 * `memories` either carries a `deletedAt` condition or sits in a function
 * that says, in a comment, why it must see the bin. Without this, the
 * failure mode is a deleted persona that still appears in one screen
 * nobody thought of.
 *
 * The second kind needs a database, and is skipped without one.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const ROOT = path.resolve(__dirname, "..");
/** The marker a whitelisted read carries, in its enclosing function. */
const WHITELIST_MARKER = "soft-delete: include-deleted";

const dbSource = readFileSync(path.join(ROOT, "server", "db.ts"), "utf-8");
const schemaSource = readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
const migrationSource = readFileSync(
  path.join(ROOT, "drizzle", "0078_soft_delete.sql"),
  "utf-8",
);

// ─── The structural half ────────────────────────────────────────────────────

/** The source with comments blanked out, so a mention in prose is not a filter. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

/**
 * The exported function that contains a position in the file.
 *
 * The body is counted by braces, so the marker is looked for in the
 * whole function and not in the twenty lines around the read.
 */
function enclosingFunction(src: string, offset: number): { name: string; body: string } | null {
  const before = src.slice(0, offset);
  const match = /(?:export )?(?:async )?function (\w+)\(/g;
  let last: RegExpExecArray | null = null;
  for (const found of before.matchAll(match)) last = found;
  if (!last || last.index === undefined) return null;
  const open = src.indexOf("{", last.index);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return { name: last[1]!, body: src.slice(open, i + 1) };
}

type ReadSite = {
  line: number;
  table: string;
  functionName: string;
  statement: string;
  functionBody: string;
};

/**
 * Every read of the three tables in `server/db.ts`.
 *
 * A read is a `select` that names one of the tables — as its source or
 * as a join. Updates and deletes are not reads: the soft delete itself is
 * an update, and the purge deletes rows on purpose.
 */
function readSites(src: string): ReadSite[] {
  const stripped = withoutComments(src);
  const pattern = /\.(?:from|innerJoin|leftJoin)\(\s*(personas|messages|memories)\b/g;
  const out: ReadSite[] = [];
  for (const match of stripped.matchAll(pattern)) {
    const start = match.index ?? 0;
    // The end of the statement: the next `;` outside every paren.
    let depth = 1;
    let i = start + match[0].length;
    for (; i < stripped.length; i++) {
      const char = stripped[i];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === ";" && depth <= 0) break;
    }
    const fn = enclosingFunction(src, start);
    out.push({
      line: src.slice(0, start).split("\n").length,
      table: match[1]!,
      functionName: fn?.name ?? "?",
      statement: stripped.slice(start, i + 1),
      functionBody: fn?.body ?? "",
    });
  }
  return out;
}

const sites = readSites(dbSource);

describe("every read of the three tables leaves the bin out", () => {
  it("finds the reads it is supposed to look at", () => {
    expect(sites.length).toBeGreaterThan(70);
  });

  it("has a deletedAt condition or a written reason", () => {
    const offenders = sites
      .filter((site) => !site.statement.includes("deletedAt"))
      .filter((site) => !site.functionBody.includes(WHITELIST_MARKER))
      .map((site) => `${site.functionName} (line ${site.line}, from ${site.table})`);
    expect(offenders, "these reads can still see a deleted row").toEqual([]);
  });

  it("keeps the whitelist to the purge and restore paths", () => {
    // The only functions allowed to see the bin are the ones that have to:
    // the recycle bin's list, the two deletes that must find a soft-deleted
    // row, and the file collection before a hard delete.
    const whitelisted = [
      ...new Set(
        sites
          .filter((site) => !site.statement.includes("deletedAt"))
          .map((site) => site.functionName),
      ),
    ].sort();
    expect(whitelisted).toEqual([
      "collectStoredFiles",
      "deleteUserAccount",
      "getPersonaByIdIncludingDeleted",
      "purgePersona",
    ]);
  });

  it("gives each table its deletedAt column in the schema", () => {
    for (const [tableName, marker] of [
      ["personas", 'deletedAt: timestamp("deletedAt")'],
      ["messages", 'deletedAt: timestamp("deletedAt")'],
      ["memories", 'deletedAt: timestamp("deletedAt")'],
    ] as const) {
      const start = schemaSource.indexOf(`pgTable("${tableName}"`);
      expect(start, `${tableName} must be in the schema`).toBeGreaterThan(-1);
      const end = schemaSource.indexOf("}));", start);
      const body = schemaSource.slice(start, end);
      expect(body, `${tableName} must carry the deletion moment`).toContain(marker);
    }
  });

  it("ships the migration that adds the columns", () => {
    expect(migrationSource.startsWith("-- mirrai: idempotent-migration")).toBe(true);
    for (const table of ["personas", "messages", "memories"]) {
      expect(migrationSource).toContain(`ALTER TABLE "${table}"`);
      expect(migrationSource).toContain('ADD COLUMN IF NOT EXISTS "deletedAt"');
    }
    expect(migrationSource).toContain("-- mirrai: down");
    // Idempotent, so a re-run does nothing — the down half drops the
    // columns only if they are there.
    expect(migrationSource).toContain('DROP COLUMN IF EXISTS "deletedAt"');
    expect(migrationSource).not.toMatch(/DROP COLUMN "deletedAt"/);
  });

  it("keeps the hard deletes, and gives them the purge names", () => {
    for (const name of ["purgePersona", "purgeMessage", "purgeMemory"]) {
      expect(dbSource).toContain(`export async function ${name}(`);
    }
    for (const name of ["softDeletePersona", "restorePersona", "listDeletedPersonas"]) {
      expect(dbSource).toContain(`export async function ${name}(`);
    }
    // The account deletion is still immediate and total: it has no
    // soft-delete path of its own.
    expect(dbSource).toContain("export async function deleteUserAccount(");
  });

  it("does not keep a hard delete under the old name", () => {
    // A second `deletePersona` that still deletes rows would be called by
    // a caller that thinks it is a soft delete.
    expect(dbSource).not.toContain("export async function deletePersona(");
    expect(dbSource).not.toContain("export async function deleteMessage(");
    expect(dbSource).not.toContain("export async function deleteMemory(");
  });
});

// ─── The database half ──────────────────────────────────────────────────────

/**
 * The uploads directory of this test file.
 *
 * Set before `server/storage` is imported, so the persona's files land in
 * a directory that can be removed at the end.
 */
const uploadRoot = vi.hoisted(() => {
  const dir = `/tmp/mirrai-db-soft-delete-${Math.random().toString(36).slice(2)}`;
  process.env.UPLOAD_DIR = dir;
  return dir;
});

const DAY = 24 * 60 * 60 * 1000;

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `soft-delete-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

function uniqueBase(): number {
  return 9_960_000 + Math.floor(Math.random() * 10_000);
}

describe.skipIf(!DATABASE_URL)("undo and the recycle bin, in the database", () => {
  afterAll(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
  });

  it("hides a deleted persona everywhere, and gives every message back on restore", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({
      userId,
      name: "小满",
      analysisStatus: "ready",
      relationshipDesc: "朋友",
    });
    try {
      const first = await createMessage({ personaId, userId, role: "user", content: "海边的风" });
      const second = await createMessage({
        personaId,
        userId,
        role: "assistant",
        content: "海边的风很好",
      });
      const memoryId = await createMemory({
        personaId,
        userId,
        title: "海边",
        description: "你们说好要去看海。",
        category: "memory",
      });

      // Before: everything is there.
      expect(await getPersonaById(personaId, userId)).toBeTruthy();
      expect((await getPersonasByUserId(userId)).map((p) => p.id)).toContain(personaId);
      expect((await getPersonasWithStats(userId)).map((p) => p.id)).toContain(personaId);
      expect((await getMessagesByPersonaId(personaId, userId, 50)).length).toBe(2);
      expect(await searchMessages(personaId, userId, "海边的风")).toHaveLength(2);
      expect((await getMemoriesByPersonaId(personaId, userId)).map((m) => m.id)).toContain(
        memoryId,
      );
      const before = await exportUserData(userId);
      expect(before?.personas.map((p) => p.id)).toContain(personaId);
      expect(before?.messages.length).toBeGreaterThanOrEqual(2);
      const beforeChat = await appRouter
        .createCaller(ctxFor(userId))
        .chat.getHistory({ personaId });
      expect(beforeChat.length).toBe(2);

      // The delete.
      expect(await softDeletePersona(personaId, userId, new Date("2026-02-01T00:00:00Z"))).toBe(
        true,
      );

      // After: the persona is gone from every read, and so is what
      // belonged to it.
      expect(await getPersonaById(personaId, userId)).toBeUndefined();
      expect((await getPersonasByUserId(userId)).map((p) => p.id)).not.toContain(personaId);
      expect((await getPersonasWithStats(userId)).map((p) => p.id)).not.toContain(personaId);
      expect(await getMessagesByPersonaId(personaId, userId, 50)).toEqual([]);
      expect(await getMessageById(first, userId)).toBeNull();
      expect(await searchMessages(personaId, userId, "海边的风")).toEqual([]);
      expect(await getMemoriesByPersonaId(personaId, userId)).toEqual([]);
      expect(await countMemories(personaId, userId)).toBe(0);
      const after = await exportUserData(userId);
      expect(after?.personas.map((p) => p.id)).not.toContain(personaId);
      expect(after?.messages).toEqual([]);
      expect(await getExportData(personaId, userId)).toBeNull();
      await expect(
        appRouter.createCaller(ctxFor(userId)).chat.getHistory({ personaId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // The persona cannot be talked to either.
      await expect(
        appRouter.createCaller(ctxFor(userId)).persona.get({ id: personaId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // It is in the bin, not gone.
      const bin = await listDeletedPersonas(userId);
      expect(bin.map((row) => row.id)).toContain(personaId);
      expect(bin.find((row) => row.id === personaId)?.deletedAt).toBeTruthy();

      // The undo.
      expect(await restorePersona(personaId, userId)).toBe(true);
      expect(await getPersonaById(personaId, userId)).toBeTruthy();
      expect((await getPersonasByUserId(userId)).map((p) => p.id)).toContain(personaId);
      expect((await getMessagesByPersonaId(personaId, userId, 50)).map((m) => m.id)).toEqual([
        first,
        second,
      ]);
      expect(await searchMessages(personaId, userId, "海边的风")).toHaveLength(2);
      expect((await getMemoriesByPersonaId(personaId, userId)).map((m) => m.id)).toContain(
        memoryId,
      );
      expect((await getExportData(personaId, userId))?.messages.length).toBe(2);
      expect(await listDeletedPersonas(userId)).toEqual([]);
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("keeps a message that was deleted before the persona deleted", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-order-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    try {
      const kept = await createMessage({ personaId, userId, role: "user", content: "第一句" });
      const earlierGone = await createMessage({
        personaId,
        userId,
        role: "user",
        content: "第二句",
      });
      expect(await softDeleteMessage(earlierGone, userId, personaId)).toBe(true);
      const deletedAt = new Date("2026-03-01T00:00:00Z");
      await softDeletePersona(personaId, userId, deletedAt);
      await restorePersona(personaId, userId);

      // Restoring the persona takes back the persona's deletion, not the
      // message's own: the message the user had already thrown away stays
      // in the bin.
      expect((await getMessagesByPersonaId(personaId, userId, 50)).map((m) => m.id)).toEqual([
        kept,
      ]);
      expect(await restoreMessage(earlierGone, userId, personaId)).toBe(true);
      expect((await getMessagesByPersonaId(personaId, userId, 50)).map((m) => m.id)).toEqual([
        kept,
        earlierGone,
      ]);
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("soft-deletes one message and puts it back", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-message-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    try {
      const messageId = await createMessage({
        personaId,
        userId,
        role: "user",
        content: "海边的风",
      });
      expect(await softDeleteMessage(messageId, userId, personaId)).toBe(true);
      expect(await softDeleteMessage(messageId, userId, personaId)).toBe(false);
      expect(await getMessagesByPersonaId(personaId, userId, 50)).toEqual([]);
      expect(await getMessageById(messageId, userId)).toBeNull();
      expect(await searchMessages(personaId, userId, "海边的风")).toEqual([]);
      // The conversation is still there; only the line is in the bin.
      expect(await getPersonaById(personaId, userId)).toBeTruthy();

      expect(await restoreMessage(messageId, userId, personaId)).toBe(true);
      expect((await getMessagesByPersonaId(personaId, userId, 50)).map((m) => m.id)).toEqual([
        messageId,
      ]);
      expect(await getMessageById(messageId, userId)).toBeTruthy();
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("soft-deletes one memory and puts it back", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-memory-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    try {
      const memoryId = await createMemory({
        personaId,
        userId,
        title: "生日",
        description: "三月一日。",
        category: "anniversary",
      });
      expect(await countMemories(personaId, userId)).toBe(1);
      expect(await softDeleteMemory(memoryId, userId)).toBe(true);
      expect(await softDeleteMemory(memoryId, userId)).toBe(false);
      expect(await countMemories(personaId, userId)).toBe(0);
      expect(await getMemoriesByPersonaId(personaId, userId)).toEqual([]);
      const searched = await searchAllMessages(userId, "生日");
      expect(searched.filter((row) => row.kind === "memory")).toEqual([]);

      expect(await restoreMemory(memoryId, userId)).toBe(true);
      expect(await countMemories(personaId, userId)).toBe(1);
      expect((await getMemoriesByPersonaId(personaId, userId)).map((m) => m.id)).toContain(
        memoryId,
      );
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("keeps a deleted persona out of the scheduler's surveys", async () => {
    /**
     * The scheduler's own reads — the proactive survey and the reminder
     * survey — are what decide whether a persona speaks first, answers a
     * letter, or sends a reminder. A deleted persona has to be out of
     * them, or it goes on talking through the bin.
     */
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-scheduler-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({
      userId,
      name: "小满",
      analysisStatus: "ready",
      proactiveFrequencyHours: 5,
      remindersEnabled: true,
      timezone: "Asia/Shanghai",
    });
    try {
      expect((await getProactivePersonas()).map((row) => row.id)).toContain(personaId);
      expect((await getAllPersonasForReminders()).map((row) => row.id)).toContain(personaId);

      await softDeletePersona(personaId, userId, new Date("2026-07-01T00:00:00Z"));

      expect((await getProactivePersonas()).map((row) => row.id)).not.toContain(personaId);
      expect((await getAllPersonasForReminders()).map((row) => row.id)).not.toContain(personaId);
      // Every scheduler path checks the persona through this read first,
      // so the proactive, reply and scheduled-item sweeps all skip it.
      expect(await getPersonaById(personaId, userId)).toBeUndefined();
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("keeps the persona on day 29 and takes it and its files on day 31", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-purge-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    const fileKey = `personas/${userId}/${personaId}/files/soft-delete.txt`;
    const deletedAt = new Date("2026-04-01T00:00:00Z");
    try {
      await storagePut(fileKey, Buffer.from("the uploaded words"), "text/plain");
      await createPersonaFile({
        userId,
        personaId,
        fileType: "chat_txt",
        originalName: "soft-delete.txt",
        fileKey,
        fileUrl: `/uploads/${fileKey}`,
        fileSize: 18,
      });
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(true);

      await softDeletePersona(personaId, userId, deletedAt);
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(true);

      // Day 29: still in the bin, still on the disk.
      await purgeExpiredPersonas(new Date(deletedAt.getTime() + 29 * DAY));
      expect(await getPersonaByIdIncludingDeleted(personaId, userId)).toBeTruthy();
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(true);

      // Day 31: gone, with the file.
      expect(
        await purgeExpiredPersonas(new Date(deletedAt.getTime() + 31 * DAY)),
      ).toBeGreaterThanOrEqual(1);
      expect(await getPersonaByIdIncludingDeleted(personaId, userId)).toBeUndefined();
      expect(existsSync(`${uploadRoot}/${fileKey}`)).toBe(false);
      expect(await listDeletedPersonas(userId)).toEqual([]);
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("makes the account deletion remove even the rows in the bin", async () => {
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-account-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    const messageId = await createMessage({
      personaId,
      userId,
      role: "user",
      content: "海边的风",
    });
    const memoryId = await createMemory({ personaId, userId, title: "海边", category: "memory" });
    await softDeletePersona(personaId, userId, new Date("2026-05-01T00:00:00Z"));
    // The message and memory were cascaded into the bin, so all three
    // tables hold a row the ordinary reads cannot see.
    const db = await getDb();
    expect(
      await db!.select({ id: personas.id }).from(personas).where(eq(personas.userId, userId)),
    ).toHaveLength(1);
    expect(
      await db!.select({ id: messages.id }).from(messages).where(eq(messages.userId, userId)),
    ).toHaveLength(1);
    expect(
      await db!.select({ id: memories.id }).from(memories).where(eq(memories.userId, userId)),
    ).toHaveLength(1);

    await deleteUserAccount(userId);

    // Not just invisible: gone from the tables.
    expect(
      await db!.select({ id: personas.id }).from(personas).where(eq(personas.userId, userId)),
    ).toEqual([]);
    expect(
      await db!.select({ id: messages.id }).from(messages).where(eq(messages.userId, userId)),
    ).toEqual([]);
    expect(
      await db!.select({ id: memories.id }).from(memories).where(eq(memories.userId, userId)),
    ).toEqual([]);
    // The ids are not dangling either.
    const leftovers = [
      ...(await db!.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId))),
      ...(await db!.select({ id: messages.id }).from(messages).where(eq(messages.id, messageId))),
      ...(await db!.select({ id: memories.id }).from(memories).where(eq(memories.id, memoryId))),
    ];
    expect(leftovers).toEqual([]);
  });

  it("gives C10.3 a hard delete that also clears the bin", async () => {
    /**
     * C10.3 is not built yet (WP16). When it is, "TA 说不" has to be
     * immediate and total, like an account deletion. `purgePersona` is
     * the helper it should call: it takes a persona that is in the bin
     * and leaves no row of it behind.
     */
    const userId = uniqueBase();
    await createUser({ username: `soft-delete-consent-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    await createMessage({ personaId, userId, role: "user", content: "海边的风" });
    await createMemory({ personaId, userId, title: "海边", category: "memory" });
    await softDeletePersona(personaId, userId, new Date("2026-06-01T00:00:00Z"));

    await purgePersona(personaId, userId);

    const db = await getDb();
    expect(
      await db!.select({ id: personas.id }).from(personas).where(eq(personas.id, personaId)),
    ).toEqual([]);
    expect(
      await db!.select({ id: messages.id }).from(messages).where(eq(messages.personaId, personaId)),
    ).toEqual([]);
    expect(
      await db!.select({ id: memories.id }).from(memories).where(eq(memories.personaId, personaId)),
    ).toEqual([]);
    await deleteUserAccount(userId);
  });
});

describe.skipIf(!DATABASE_URL)("pins on messages that are gone", () => {
  it("stop holding a slot while the message is in the bin, and come back with the undo", async () => {
    const userId = uniqueBase();
    await createUser({ username: `pin-bin-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    try {
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await createMessage({ personaId, userId, role: "user", content: `第${i}句` });
        ids.push(id);
        await addMessageMark({ userId, personaId, messageId: id, kind: "pin", label: null });
      }
      const fourth = await createMessage({ personaId, userId, role: "user", content: "第四句" });
      const caller = appRouter.createCaller(ctxFor(userId));

      // Three pins are the limit.
      await expect(
        caller.mark.add({ personaId, messageId: fourth, kind: "pin" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // Deleting one pinned message takes its pin out of the count, so a
      // fourth pin is possible again — the pin row is only hidden until
      // the undo.
      await softDeleteMessage(ids[0]!, userId, personaId);
      await caller.mark.add({ personaId, messageId: fourth, kind: "pin" });
      const visible = await caller.mark.list({ personaId, kind: "pin" });
      expect(visible.marks).toHaveLength(3);

      // The undo brings the message back. There are three pins visible
      // and the conversation only keeps three in front (C8.10), so the
      // restored message's pin is the one that does not come back: the
      // pin was created before the one that filled its slot.
      await restoreMessage(ids[0]!, userId, personaId);
      const afterUndo = await caller.mark.list({ personaId, kind: "pin" });
      expect(afterUndo.marks).toHaveLength(3);
      expect(afterUndo.marks.map((row) => row.messageId).sort()).toEqual(
        [...ids.slice(1), fourth].sort(),
      );
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });

  it("does not leave marks behind when a conversation is cleared", async () => {
    const userId = uniqueBase();
    await createUser({ username: `pin-clear-${userId}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    try {
      const id = await createMessage({ personaId, userId, role: "user", content: "一句" });
      await addMessageMark({ userId, personaId, messageId: id, kind: "star" });
      await clearMessagesByPersonaId(personaId, userId);
      const caller = appRouter.createCaller(ctxFor(userId));
      const list = await caller.mark.list({ personaId });
      expect(list.marks).toEqual([]);
    } finally {
      await deleteUserAccount(userId).catch(() => undefined);
    }
  });
});
