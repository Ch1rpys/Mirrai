/**
 * The keys of the OpenAI-compatible endpoint (C9.2).
 *
 * A key is `mk_` followed by forty random characters. It is shown when it
 * is created and never again: the database keeps a sha256 of it and the
 * first characters, which is enough to tell two keys apart in the list
 * and useless to anybody who reads the table.
 *
 * None of this touches the database — `server/db.ts` owns the rows — so
 * every rule here can be tested on its own.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The prefix that says a string is a Mirrai key rather than a model name. */
export const API_KEY_PREFIX = "mk_";

/** Forty base64url characters: thirty random bytes, no padding. */
const BODY_BYTES = 30;
export const API_KEY_BODY_LENGTH = 40;

/** How much of the key the settings page may show. */
export const API_KEY_VISIBLE_PREFIX = 12;

/** The two things a key may be used for. */
export const API_KEY_SCOPES = ["chat", "read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** A fresh key. The caller shows it once and stores only `hashApiKey`. */
export function generateApiKey(): string {
  const body = randomBytes(BODY_BYTES).toString("base64url");
  return `${API_KEY_PREFIX}${body.slice(0, API_KEY_BODY_LENGTH)}`;
}

/** sha256, hexadecimal. What `api_keys.keyHash` holds. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** The first characters, for the list. Never the whole key. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_VISIBLE_PREFIX);
}

/** Looks like a key this app issues. */
export function looksLikeApiKey(value: string): boolean {
  return new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{${API_KEY_BODY_LENGTH}}$`).test(value);
}

/**
 * The token of an `Authorization: Bearer …` header.
 *
 * Returns null for anything that is not exactly that header: a session
 * cookie is deliberately not accepted (C9.2) — a cookie is something a
 * browser sends on its own, and this endpoint is for clients that were
 * given a key.
 */
export function bearerToken(header: string | undefined | null): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Constant-time comparison of two hashes, so a miss takes the same time. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
