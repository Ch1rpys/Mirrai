import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, getUserLockRow, setUserLock } from "./db";
import { hashPassword, verifyPassword } from "./_core/password";

/**
 * The app lock's stored half, in a real database (C8.4).
 *
 * The manual asks for two things this test can only check against
 * Postgres: the PIN is a scrypt hash and not the PIN, and the JSON
 * settings survive the column. It runs only with `DATABASE_URL` set —
 * the rest of the suite skips it — and the workflow only ever points
 * that at a disposable database.
 */

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

describe.skipIf(!process.env.DATABASE_URL)("the app lock in postgres", () => {
  it("stores a scrypt hash of the PIN, never the PIN itself", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const username = `lock-probe-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    try {
      await db.execute(sql`INSERT INTO "users" ("username") VALUES (${username})`);
      const found = await db.execute(
        sql`SELECT "id" FROM "users" WHERE "username" = ${username}`,
      );
      const userId = Number(rowsOf(found)[0]?.id);

      const pinHash = await hashPassword("4821");
      await setUserLock(userId, {
        lockPinHash: pinHash,
        lockSettings: { enabled: true, idleMinutes: 7, passkeys: [] },
      });

      const raw = rowsOf(
        await db.execute(
          sql`SELECT "lockPinHash", "lockSettings" FROM "users" WHERE "id" = ${userId}`,
        ),
      )[0];
      const stored = String(raw?.lockPinHash ?? "");
      expect(stored).not.toBe("4821");
      expect(stored.startsWith("scrypt$")).toBe(true);
      expect(await verifyPassword("4821", stored)).toBe(true);
      expect(await verifyPassword("9999", stored)).toBe(false);

      const lock = await getUserLockRow(userId);
      expect(lock?.lockSettings).toMatchObject({ enabled: true, idleMinutes: 7 });
      expect(lock?.lockSettings.passkeys).toEqual([]);
    } finally {
      await db.execute(sql`DELETE FROM "users" WHERE "username" = ${username}`);
    }
  });

  it("clamps a hand-written idle window to the rules", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const username = `lock-clamp-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    try {
      await db.execute(sql`INSERT INTO "users" ("username") VALUES (${username})`);
      const found = await db.execute(
        sql`SELECT "id" FROM "users" WHERE "username" = ${username}`,
      );
      const userId = Number(rowsOf(found)[0]?.id);
      await db.execute(
        sql`UPDATE "users" SET "lockSettings" = ${JSON.stringify({ enabled: true, idleMinutes: 999 })}::jsonb WHERE "id" = ${userId}`,
      );
      const lock = await getUserLockRow(userId);
      expect(lock?.lockSettings.idleMinutes).toBe(60);
    } finally {
      await db.execute(sql`DELETE FROM "users" WHERE "username" = ${username}`);
    }
  });
});
