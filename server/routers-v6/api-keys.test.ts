/**
 * The key management routes (C9.2).
 *
 * The settings page creates a key, sees it once, and can revoke it. What
 * is asserted here is the part a program would otherwise trust: the key
 * is not in the row, the list never carries a hash, and one account's key
 * cannot be revoked by another account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const createApiKey = vi.fn();
const listApiKeys = vi.fn();
const revokeApiKey = vi.fn();

vi.mock("../db", () => ({
  createApiKey: (...args: unknown[]) => createApiKey(...args),
  listApiKeys: (...args: unknown[]) => listApiKeys(...args),
  revokeApiKey: (...args: unknown[]) => revokeApiKey(...args),
}));

import { apiKeyRouter } from "./api-keys";

const ctx = { user: { id: 7, role: "user" }, locale: "zh" } as any;

function caller() {
  return apiKeyRouter.createCaller(ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apiKey.list", () => {
  it("returns the prefix and never the hash or the key", async () => {
    listApiKeys.mockResolvedValue([
      {
        id: 3,
        userId: 7,
        name: "编辑器",
        keyHash: "a".repeat(64),
        prefix: "mk_abcd1234",
        scopes: ["chat"],
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    const result = await caller().list();
    expect(listApiKeys).toHaveBeenCalledWith(7);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).toMatchObject({
      id: 3,
      name: "编辑器",
      prefix: "mk_abcd1234",
      scopes: ["chat"],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("keyHash");
    expect(serialized).not.toContain("a".repeat(64));
  });

  it("gives a bad scopes column a usable value", async () => {
    listApiKeys.mockResolvedValue([{
      id: 1,
      name: "x",
      prefix: "mk_x",
      scopes: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    }]);
    const result = await caller().list();
    expect(result.keys[0].scopes).toEqual(["chat"]);
  });
});

describe("apiKey.create", () => {
  it("stores a sha256 of the key and a prefix, and returns the key once", async () => {
    createApiKey.mockImplementation(async (data: Record<string, unknown>) => ({
      id: 9,
      ...data,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    }));
    const result = await caller().create({ name: "我的编辑器" });
    expect(result.key).toMatch(/^mk_[A-Za-z0-9_-]{40}$/);
    expect(result.prefix).toBe(result.key.slice(0, 12));
    expect(createApiKey).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      name: "我的编辑器",
      keyHash: createHash("sha256").update(result.key).digest("hex"),
      prefix: result.key.slice(0, 12),
      scopes: ["chat"],
    }));
    // The row that was stored has no key in it.
    const stored = createApiKey.mock.calls[0][0] as Record<string, unknown>;
    expect(stored.key).toBeUndefined();
    expect(Object.values(stored)).not.toContain(result.key);
  });

  it("keeps the scopes the user asked for", async () => {
    createApiKey.mockImplementation(async (data: Record<string, unknown>) => ({
      id: 9,
      ...data,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    }));
    const result = await caller().create({ name: "只读", scopes: ["read"] });
    expect(result.scopes).toEqual(["read"]);
    expect(createApiKey).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["read"] }));
  });

  it("refuses an empty name", async () => {
    await expect(caller().create({ name: "   " })).rejects.toThrow();
    expect(createApiKey).not.toHaveBeenCalled();
  });
});

describe("apiKey.revoke", () => {
  it("revokes one of this account's keys", async () => {
    revokeApiKey.mockResolvedValue(true);
    const result = await caller().revoke({ id: 3 });
    expect(revokeApiKey).toHaveBeenCalledWith(3, 7);
    expect(result).toEqual({ success: true });
  });

  it("says not found for somebody else's key", async () => {
    revokeApiKey.mockResolvedValue(false);
    await expect(caller().revoke({ id: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
