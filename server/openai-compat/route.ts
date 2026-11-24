/**
 * The OpenAI-compatible endpoint (C9.2).
 *
 * Two routes, `/v1/models` and `/v1/chat/completions`, so that any OpenAI
 * client can talk to a persona. The key is the whole credential: a
 * `Bearer` token from `api_keys`, no session cookie — a cookie is
 * something a browser attaches by itself, and this endpoint exists for
 * programs that were given a key on purpose.
 *
 * **The server owns the conversation.** Only the last user turn of the
 * request is used; everything earlier — and every `system` message — is
 * ignored, because otherwise any client could rewrite the persona's
 * rules or skip the safety layer. The reply comes from `runConversation`,
 * the same function the chat page uses, so the crisis path, the daily
 * care note, the memories and the taper are all the ordinary ones.
 *
 * What this channel does not have: typing delays, split messages and
 * stickers/photos. Answers are one message.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ENV } from "../_core/env";
import { bearerToken, hashApiKey, looksLikeApiKey } from "../_core/api-keys";
import { RATE_LIMITS, rateLimiter, resolveRateLimitKey } from "../_core/rate-limit";
import * as db from "../db";
import { ChatClosedError, PersonaAsleepError, runConversation } from "../chat/service";
import { isEncryptionLocked } from "../encryption/lock";
import { copy, type Locale } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import type { Persona } from "../../drizzle/schema";

/** An error the endpoint answers with, in OpenAI's error shape. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "invalid_request_error",
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

interface ApiCaller {
  userId: number;
  keyId: number;
  scopes: string[];
  locale: Locale;
}

function localeOf(value: unknown): Locale {
  if (value === "en") return "en";
  if (value === "zh-Hant") return "zh-Hant";
  return "zh";
}

function errorBody(error: ApiError): Record<string, unknown> {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: null,
      code: error.code,
    },
  };
}

function sendError(res: Response, error: ApiError): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.status(error.status).json(errorBody(error));
}

/** The key's scopes, as stored. */
function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope);
}

/**
 * Who is calling.
 *
 * A missing header, a malformed token, an unknown hash and a revoked key
 * are all the same answer: 401. A wrong key must not tell the caller
 * whether it ever existed.
 */
async function authenticate(req: Request): Promise<ApiCaller> {
  const token = bearerToken(req.header("authorization"));
  if (!token) {
    // The header is what the client forgot, so the message says that.
    throw new ApiError(401, copy("zh", "errors.apiKeyMissing"), "invalid_request_error", "invalid_api_key");
  }
  if (!looksLikeApiKey(token)) {
    throw new ApiError(401, copy("zh", "errors.apiKeyInvalid"), "invalid_request_error", "invalid_api_key");
  }
  const row = await db.findActiveApiKeyByHash(hashApiKey(token));
  if (!row) {
    throw new ApiError(401, copy("zh", "errors.apiKeyInvalid"), "invalid_request_error", "invalid_api_key");
  }
  const user = await db.getUserById(row.userId);
  if (!user) {
    throw new ApiError(401, copy("zh", "errors.apiKeyInvalid"), "invalid_request_error", "invalid_api_key");
  }
  void db.touchApiKeyLastUsed(row.id, row.userId).catch(() => undefined);
  const scopes = Array.isArray(row.scopes)
    ? (row.scopes as unknown[]).filter((scope): scope is string => typeof scope === "string")
    : ["chat"];
  return { userId: row.userId, keyId: row.id, scopes, locale: localeOf(user.locale) };
}

async function enforceRateLimit(req: Request, caller: ApiCaller): Promise<void> {
  const limit = await rateLimiter.check(
    resolveRateLimitKey(req, RATE_LIMITS.llm, caller.userId),
    RATE_LIMITS.llm,
  );
  if (!limit.allowed) {
    throw new ApiError(
      429,
      copy(caller.locale, "errors.streamTooManyRequests"),
      "rate_limit_error",
      "rate_limit_exceeded",
    );
  }
}

/** One `messages` entry, as far as this endpoint reads it. */
const messageSchema = z.object({
  role: z.string(),
  content: z.unknown().nullish(),
});

const chatSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
});

/** Text of one message, OpenAI's string or content-parts shape. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("\n");
}

/**
 * The one thing the user said this turn.
 *
 * Everything before the last user message is history the server already
 * has — sending it again would only let the client rewrite it. The
 * manual's rule is "the last `user` message", so a request that ends with
 * an assistant message (a client asking the persona to continue) still
 * has its last user line used; the trailing assistant text is not the
 * user's turn. A burst of consecutive user messages is one message: they
 * were sent together, so they are joined with a newline.
 */
export function turnTextFrom(messages: Array<{ role: string; content?: unknown }>): string {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return "";
  const parts: string[] = [];
  for (let i = lastUser; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") break;
    const text = messageText(message.content).trim();
    if (!text) break;
    parts.push(text);
  }
  return parts.reverse().join("\n");
}

function modelIdOf(personaId: number): string {
  return `persona-${personaId}`;
}

function personaIdOf(model: unknown): number | null {
  if (typeof model !== "string") return null;
  const match = /^persona-(\d+)$/.exec(model);
  if (!match) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A completion, in the shape an OpenAI client parses. */
function completionBody(params: {
  id: string;
  created: number;
  model: string;
  text: string;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: "chat.completion",
    created: params.created,
    model: params.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: params.text },
      finish_reason: "stop",
    }],
    /**
     * The endpoint does not report the provider's token counts.
     *
     * An OpenAI client only needs the field to exist; inventing a number
     * here would be worse than a zero. The app's own ledger has the real
     * numbers.
     */
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function writeChunk(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamBody(params: {
  id: string;
  created: number;
  model: string;
  text: string;
}): string[] {
  const base = {
    id: params.id,
    object: "chat.completion.chunk",
    created: params.created,
    model: params.model,
  };
  return [
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    }),
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { content: params.text }, finish_reason: null }],
    }),
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    }),
  ];
}

/**
 * Writes the answer, either as one body or as OpenAI's SSE chunks.
 *
 * The chunks carry the whole text in one of them: this route is not a
 * token stream (the words come from the ordinary pipeline, which already
 * finished), and an OpenAI client is happy with a single content delta.
 */
function sendAnswer(
  res: Response,
  params: { model: string; text: string; stream: boolean },
): void {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  if (!params.stream) {
    res.status(200).json(completionBody({ id, created, model: params.model, text: params.text }));
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  for (const chunk of streamBody({ id, created, model: params.model, text: params.text })) {
    res.write(`data: ${chunk}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Runs one turn through the ordinary pipeline and returns the words.
 *
 * Sealed, tapered, asleep and revoked-share personas answer with their
 * own sentence, exactly as the chat page shows it — the API is not a way
 * around the state the user asked for.
 */
async function answerTurn(params: {
  caller: ApiCaller;
  persona: Persona;
  text: string;
}): Promise<string> {
  let reply = "";
  try {
    for await (const event of runConversation({
      persona: params.persona,
      userId: params.caller.userId,
      message: params.text,
      providerName: (params.persona as { llmProvider?: string | null }).llmProvider || undefined,
      mode: "once",
      // The API channel: no delays, no split messages, no stickers (C9.2).
      channel: "api",
      locale: params.caller.locale,
    })) {
      if (event.type === "delta") {
        reply += event.text;
      } else if (event.type === "burst") {
        reply = event.texts.filter((line) => line.length > 0).join("\n");
      } else if (event.type === "silence") {
        reply = event.notice;
      } else if (event.type === "replace") {
        reply = event.text;
      } else if (event.type === "done") {
        // The turn was stored; anything before this is already collected.
      } else if (event.type === "error") {
        throw new ApiError(
          500,
          copy(params.caller.locale, "errors.replyFailed"),
          "server_error",
          "generation_failed",
        );
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof PersonaAsleepError || error instanceof ChatClosedError) {
      // The persona said goodbye, the day is closed, or the seal is on:
      // that is an answer, not a failure of the endpoint.
      return error.message;
    }
    throw new ApiError(
      500,
      copy(params.caller.locale, "errors.replyFailed"),
      "server_error",
      "generation_failed",
    );
  }
  return reply;
}

async function handleModels(req: Request, res: Response): Promise<void> {
  const caller = await authenticate(req);
  await enforceRateLimit(req, caller);
  if (!hasScope(caller.scopes, "chat") && !hasScope(caller.scopes, "read")) {
    throw new ApiError(403, copy(caller.locale, "errors.apiKeyNoChat"), "permission_error", "insufficient_scope");
  }
  /**
   * The account's content is encrypted and its key is not in this
   * process: every read answers 423 with a sentence, listing included
   * (the persona rows carry names the account asked to encrypt, and the
   * list would be stale until the owner unlocks).
   */
  if (await isEncryptionLocked(caller.userId)) {
    throw new ApiError(423, copy(caller.locale, "errors.apiEncryptionLocked"), "invalid_request_error", "encryption_locked");
  }
  const personas = await db.getPersonasByUserId(caller.userId);
  res.status(200).json({
    object: "list",
    data: personas.map((persona) => ({
      id: modelIdOf(persona.id),
      object: "model",
      created: persona.createdAt ? Math.floor(new Date(persona.createdAt).getTime() / 1000) : 0,
      owned_by: "mirrai",
    })),
  });
}

async function handleChatCompletions(req: Request, res: Response): Promise<void> {
  const caller = await authenticate(req);
  await enforceRateLimit(req, caller);
  if (!hasScope(caller.scopes, "chat")) {
    throw new ApiError(403, copy(caller.locale, "errors.apiKeyNoChat"), "permission_error", "insufficient_scope");
  }

  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, copy(caller.locale, "errors.apiMessageMissing"));
  }
  const personaId = personaIdOf(parsed.data.model);
  if (personaId === null) {
    throw new ApiError(404, copy(caller.locale, "errors.apiModelUnknown"), "invalid_request_error", "model_not_found");
  }

  /**
   * An encrypted account whose key is not in this process: the rows would
   * come out as ciphertext, so nothing is answered until it is unlocked.
   */
  if (await isEncryptionLocked(caller.userId)) {
    throw new ApiError(423, copy(caller.locale, "errors.apiEncryptionLocked"), "invalid_request_error", "encryption_locked");
  }

  const persona = await db.getPersonaById(personaId, caller.userId);
  if (!persona) {
    throw new ApiError(404, copy(caller.locale, "errors.apiModelUnknown"), "invalid_request_error", "model_not_found");
  }

  /**
   * A locked persona is hidden from the person who locked it until they
   * enter the PIN; the API has no PIN, so it refuses rather than
   * answering for a persona the app itself would not show.
   */
  if (normalizePersonaSettings((persona as { settings?: unknown }).settings).locked) {
    throw new ApiError(403, copy(caller.locale, "errors.apiPersonaLocked"), "permission_error", "persona_locked");
  }

  const text = turnTextFrom(parsed.data.messages);
  if (!text) {
    throw new ApiError(400, copy(caller.locale, "errors.apiMessageMissing"));
  }
  if (text.length > 2000) {
    throw new ApiError(
      400,
      copy(caller.locale, "errors.apiMessageTooLong", { max: 2000 }),
      "invalid_request_error",
      "message_too_long",
    );
  }
  if (persona.analysisStatus !== "ready") {
    throw new ApiError(400, copy(caller.locale, "errors.personaNotReady"));
  }

  const reply = await answerTurn({ caller, persona, text });
  sendAnswer(res, {
    model: parsed.data.model,
    text: reply,
    stream: parsed.data.stream === true,
  });
}

/**
 * Whether the endpoint is switched off for this process (C9.2).
 *
 * It can be: an operator who does not want another way in sets
 * `OPENAI_COMPAT_ENABLED=false`. With no key created the endpoint is
 * already unusable, so this is a second lock, not the only one.
 */
export function apiCompatEnabled(): boolean {
  return ENV.openaiCompatEnabled;
}

function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    if (!apiCompatEnabled()) {
      sendError(
        res,
        new ApiError(404, copy("zh", "errors.apiCompatDisabled"), "invalid_request_error", "endpoint_disabled"),
      );
      return;
    }
    handler(req, res).catch((error: unknown) => {
      if (error instanceof ApiError) {
        sendError(res, error);
        return;
      }
      console.error("[OpenAICompat] The request failed:", error);
      sendError(
        res,
        new ApiError(500, copy("zh", "errors.replyFailed"), "server_error", "internal_error"),
      );
    });
  };
}

export function registerOpenAiCompatRoutes(app: Express): void {
  // codeql[js/missing-rate-limiting]
  app.get("/v1/models", route(handleModels));
  // codeql[js/missing-rate-limiting]
  app.post("/v1/chat/completions", route(handleChatCompletions));
}
