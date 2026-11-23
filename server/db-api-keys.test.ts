import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createApiKey,
  createUser,
  deleteUserAccount,
  findActiveApiKeyByHash,
  listApiKeys,
  revokeApiKey,
  touchApiKeyLastUsed,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The keys, against a real database (C9.2).
 *
 * Two rules are the reason this file exists: the plaintext key is never
 * stored, and a key belongs to exactly one account — including when that
 * account is deleted.
 */
describe.skipIf(!DATABASE_URL)("API keys, in the database (C9.2)", () => {
  function hashOf(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  it("stores a hash and a prefix, never the key", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `apikey-a-${stamp}`, passwordHash: "x", name: "阿树" });
    const key = "mk_" + "a".repeat(40);
    try {
      const row = await createApiKey({
        userId,
        name: "编辑器",
        keyHash: hashOf(key),
        prefix: key.slice(0, 12),
        scopes: ["chat"],
      });
      expect(row.id).toBeGreaterThan(0);
      // The row itself has no key in it.
      expect(JSON.stringify(row)).not.toContain(key.slice(4));
      const found = await findActiveApiKeyByHash(hashOf(key));
      expect(found?.userId).toBe(userId);
      expect(found?.prefix).toBe(key.slice(0, 12));
      // The hash is the only way to find it; a wrong key has no row.
      expect(await findActiveApiKeyByHash(hashOf("mk_" + "b".repeat(40)))).toBeNull();
      // A key of another user is not this user's.
      const other = await createUser({ username: `apikey-b-${stamp}`, passwordHash: "x", name: "路人" });
      try {
        expect(await listApiKeys(other)).toEqual([]);
        expect(await revokeApiKey(row.id, other)).toBe(false);
        expect(await findActiveApiKeyByHash(hashOf(key))).not.toBeNull();
      } finally {
        await deleteUserAccount(other);
      }
    } finally {
      await deleteUserAccount(userId);
    }
  });

  it("lists newest first and keeps revoked keys out of the lookup", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `apikey-c-${stamp}`, passwordHash: "x", name: "阿树" });
    const first = "mk_" + "c".repeat(40);
    const second = "mk_" + "d".repeat(40);
    try {
      const older = await createApiKey({
        userId, name: "先建的", keyHash: hashOf(first), prefix: first.slice(0, 12), scopes: ["chat"],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const newer = await createApiKey({
        userId, name: "后建的", keyHash: hashOf(second), prefix: second.slice(0, 12), scopes: ["chat", "read"],
      });
      const rows = await listApiKeys(userId);
      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(rows[0].scopes).toEqual(["chat", "read"]);

      expect(await revokeApiKey(newer.id, userId)).toBe(true);
      // A second revoke changes nothing and says so.
      expect(await revokeApiKey(newer.id, userId)).toBe(false);
      expect(await findActiveApiKeyByHash(hashOf(second))).toBeNull();
      // The other key is untouched.
      expect(await findActiveApiKeyByHash(hashOf(first))).not.toBeNull();
      const after = await listApiKeys(userId);
      expect(after.find((row) => row.id === newer.id)?.revokedAt).toBeInstanceOf(Date);
    } finally {
      await deleteUserAccount(userId);
    }
  });

  it("records when a key was last used", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `apikey-d-${stamp}`, passwordHash: "x", name: "阿树" });
    const key = "mk_" + "e".repeat(40);
    try {
      const row = await createApiKey({
        userId, name: "x", keyHash: hashOf(key), prefix: key.slice(0, 12), scopes: ["read"],
      });
      expect(row.lastUsedAt).toBeNull();
      expect(await touchApiKeyLastUsed(row.id, userId)).toBe(true);
      const [after] = await listApiKeys(userId);
      expect(after.lastUsedAt).toBeInstanceOf(Date);
      // Somebody else's id cannot touch it.
      const other = await createUser({ username: `apikey-e-${stamp}`, passwordHash: "x", name: "路人" });
      try {
        expect(await touchApiKeyLastUsed(row.id, other)).toBe(false);
      } finally {
        await deleteUserAccount(other);
      }
    } finally {
      await deleteUserAccount(userId);
    }
  });

  it("goes with the account when the account is deleted", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `apikey-f-${stamp}`, passwordHash: "x", name: "阿树" });
    const key = "mk_" + "f".repeat(40);
    await createApiKey({
      userId, name: "x", keyHash: hashOf(key), prefix: key.slice(0, 12), scopes: ["chat"],
    });
    expect(await findActiveApiKeyByHash(hashOf(key))).not.toBeNull();
    await deleteUserAccount(userId);
    expect(await findActiveApiKeyByHash(hashOf(key))).toBeNull();
    expect(await listApiKeys(userId)).toEqual([]);
  });
});
