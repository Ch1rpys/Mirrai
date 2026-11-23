/**
 * The key format (C9.2).
 *
 * The point of these rules is that a key is shown once and never stored:
 * what the database keeps is a hash and a prefix. A test that only
 * checked "a string came back" would not notice the day the key itself
 * started being written to a column.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_KEY_BODY_LENGTH,
  API_KEY_PREFIX,
  API_KEY_VISIBLE_PREFIX,
  apiKeyPrefix,
  bearerToken,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "./api-keys";

describe("a key", () => {
  it("is mk_ followed by forty random characters", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.slice(API_KEY_PREFIX.length)).toHaveLength(API_KEY_BODY_LENGTH);
    expect(looksLikeApiKey(key)).toBe(true);
  });

  it("is different every time", () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateApiKey()));
    expect(keys.size).toBe(20);
  });

  it("is stored as its sha256, and the hash is reproducible", () => {
    const key = "mk_" + "a".repeat(API_KEY_BODY_LENGTH);
    expect(hashApiKey(key)).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hashApiKey(key)).toHaveLength(64);
    expect(hashApiKey(key)).not.toContain(key.slice(3));
  });

  it("shows only its first twelve characters", () => {
    const key = generateApiKey();
    expect(apiKeyPrefix(key)).toHaveLength(API_KEY_VISIBLE_PREFIX);
    expect(key.startsWith(apiKeyPrefix(key))).toBe(true);
    expect(apiKeyPrefix(key)).not.toBe(key);
  });

  it("is not confused with other strings", () => {
    expect(looksLikeApiKey("sk-1234567890")).toBe(false);
    expect(looksLikeApiKey("mk_short")).toBe(false);
    expect(looksLikeApiKey("mk_" + "a".repeat(API_KEY_BODY_LENGTH + 1))).toBe(false);
    expect(looksLikeApiKey("mk_" + "!".repeat(API_KEY_BODY_LENGTH))).toBe(false);
  });
});

describe("the Bearer header", () => {
  it("takes the token out of a well-formed header", () => {
    expect(bearerToken("Bearer mk_abc")).toBe("mk_abc");
    expect(bearerToken("bearer   mk_abc  ")).toBe("mk_abc");
  });

  it("refuses anything else", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic mk_abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    // A cookie session is not a key and must not be accepted here.
    expect(bearerToken("session=abc")).toBeNull();
  });
});
