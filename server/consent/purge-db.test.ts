import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  countConsentRemovals,
  createMessage,
  createMemory,
  createPersona,
  createPersonaFile,
  createUser,
  getDb,
  getPersonaById,
  listDeletedPersonas,
  purgePersona,
} from "../db";
import { storagePut } from "../storage";
import { ENV } from "../_core/env";
import { purgeForConsent } from "./purge";

const DATABASE_URL = process.env.DATABASE_URL;

const ROOT = path.resolve(__dirname, "..", "..");

interface TableInfo {
  tableName: string;
  hasPersonaId: boolean;
}

/** The tables in the schema, and whether they are scoped to a persona. */
function personaScopedTables(): TableInfo[] {
  const source = readFileSync(path.join(ROOT, "drizzle", "schema.ts"), "utf-8");
  const pattern = /export const (\w+) = pgTable\(\s*"([a-z_]+)",\s*\{/g;
  const out: TableInfo[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    let i = match.index + match[0].length - 1;
    let depth = 0;
    while (i < source.length) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = source.slice(match.index + match[0].length, i);
    out.push({
      tableName: match[2]!,
      hasPersonaId: /^\s{2,}personaId:\s/m.test(body),
    });
  }
  return out;
}

async function countRowsWithPersona(tableName: string, personaId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.execute(
    sql.raw(`SELECT count(*)::int AS n FROM "${tableName}" WHERE "personaId" = ${personaId}`),
  );
  return Number((result.rows[0] as { n: number }).n);
}

describe.skipIf(!DATABASE_URL)("removing a persona for consent", () => {
  it("deletes every row, every file and every folder, and leaves one tombstone", async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const userId = await createUser({
      username: `consent-purge-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const personaId = await createPersona({ userId, name: "小满" });
    const otherPersonaId = await createPersona({ userId, name: "另一个" });
    const fileKey = `personas/${userId}/${personaId}/chat.txt`;
    const chatKey = `chat/${userId}/${personaId}/photo.png`;
    try {
      // Rows in a representative spread of the persona-scoped tables.
      await createPersonaFile({
        personaId,
        userId,
        fileType: "chat_txt",
        originalName: "chat.txt",
        fileKey,
        fileUrl: `/uploads/${fileKey}`,
        fileSize: 12,
      });
      await createMessage({
        personaId,
        userId,
        role: "assistant",
        content: "在的呀",
      });
      await createMemory({
        personaId,
        userId,
        title: "生日：5 月 21 日",
        category: "anchor",
      });
      await storagePut(fileKey, "hello world");
      await storagePut(chatKey, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const outcome = await purgeForConsent({
        personaId,
        userId,
        confirmName: "小满",
      });
      expect(outcome.status).toBe("removed");

      // The persona is gone, not in the bin, and the tombstone exists.
      expect(await getPersonaById(personaId, userId)).toBeUndefined();
      const bin = await listDeletedPersonas(userId);
      expect(bin.map((row) => row.id)).not.toContain(personaId);
      expect(await countConsentRemovals(userId)).toBe(1);

      // Every persona-scoped table holds nothing of this persona.
      const tables = personaScopedTables().filter((table) => table.hasPersonaId);
      expect(tables.length).toBeGreaterThan(20);
      const leftovers: string[] = [];
      for (const table of tables) {
        const n = await countRowsWithPersona(table.tableName, personaId);
        if (n > 0) leftovers.push(`${table.tableName}: ${n}`);
      }
      expect(leftovers).toEqual([]);

      // The persona's own folders are gone from the uploads directory.
      expect(existsSync(path.join(ENV.uploadDir, "personas", String(userId), String(personaId)))).toBe(false);
      expect(existsSync(path.join(ENV.uploadDir, "chat", String(userId), String(personaId)))).toBe(false);

      // Another persona of the same owner is untouched.
      expect(await getPersonaById(otherPersonaId, userId)).toBeTruthy();
    } finally {
      await purgePersona(otherPersonaId, userId).catch(() => undefined);
      await purgePersona(personaId, userId).catch(() => undefined);
    }
  });

  it("refuses a wrong name and leaves everything in place", async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    const userId = await createUser({
      username: `consent-refuse-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const personaId = await createPersona({ userId, name: "小满" });
    try {
      await createMessage({ personaId, userId, role: "assistant", content: "在的呀" });
      const outcome = await purgeForConsent({
        personaId,
        userId,
        confirmName: "别人",
      });
      expect(outcome.status).toBe("name_mismatch");
      expect(await getPersonaById(personaId, userId)).toBeTruthy();
      expect(await countConsentRemovals(userId)).toBe(0);
    } finally {
      await purgePersona(personaId, userId).catch(() => undefined);
    }
  });
});
