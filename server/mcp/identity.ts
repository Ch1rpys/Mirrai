/**
 * Who the MCP server is reading for (C9.3).
 *
 * The server is a child process of the user's own AI client, so it has no
 * session: it is started with `MIRRAI_API_KEY`, one of the keys created in
 * the app (C9.2), and the key has to carry the `read` scope. A startup
 * failure says why, in a sentence, on standard error — a silent exit
 * would leave the client showing "server failed" and nothing else.
 */
import { hashApiKey, looksLikeApiKey } from "../_core/api-keys";
import type { Locale } from "@shared/copy";
import * as db from "../db";

export interface McpIdentity {
  userId: number;
  keyId: number;
  locale: Locale;
}

/** Why the process refused to start, in words a person can read. */
export class McpStartupError extends Error {}

function localeOf(value: unknown): Locale {
  if (value === "en") return "en";
  if (value === "zh-Hant") return "zh-Hant";
  return "zh";
}

/**
 * Turns the environment variable into the account.
 *
 * A missing key, a key that is not ours, a revoked key and a key without
 * the `read` scope are four different problems and four different
 * sentences: the person configuring the client has to know which one to
 * fix.
 */
export async function resolveMcpIdentity(
  apiKey: string | undefined | null,
): Promise<McpIdentity> {
  const token = (apiKey ?? "").trim();
  if (!token) {
    throw new McpStartupError(
      "MIRRAI_API_KEY is not set. Create a key with the read scope in Mirrai (Settings → AI → OpenAI-compatible endpoint) and put it in the client's environment.",
    );
  }
  if (!looksLikeApiKey(token)) {
    throw new McpStartupError(
      "MIRRAI_API_KEY does not look like a Mirrai key (they start with mk_).",
    );
  }
  const row = await db.findActiveApiKeyByHash(hashApiKey(token));
  if (!row) {
    throw new McpStartupError(
      "MIRRAI_API_KEY is not valid, or it has been revoked.",
    );
  }
  const scopes = Array.isArray(row.scopes)
    ? (row.scopes as unknown[]).filter((scope): scope is string => typeof scope === "string")
    : [];
  if (!scopes.includes("read")) {
    throw new McpStartupError(
      "MIRRAI_API_KEY has no read scope. Create the key with read ticked; a chat-only key cannot read records.",
    );
  }
  const user = await db.getUserById(row.userId);
  if (!user) {
    throw new McpStartupError("MIRRAI_API_KEY belongs to an account that no longer exists.");
  }
  return { userId: row.userId, keyId: row.id, locale: localeOf(user.locale) };
}
