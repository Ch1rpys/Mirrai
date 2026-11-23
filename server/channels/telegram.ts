/**
 * Telegram (C9.1).
 *
 * Bot API long polling — no public address, no webhook, no TLS
 * certificate: the app calls out, so it works behind a home router like
 * the WeChat and Feishu channels do.
 *
 * Protocol checked against the official Bot API documentation on
 * 2026-11-24:
 *   https://core.telegram.org/bots/api            (getUpdates, sendMessage)
 *   https://core.telegram.org/bots/api#getupdates  (offset / timeout)
 *   https://core.telegram.org/bots/api#sendmessage
 *
 * The credentials are the bot token, encrypted at rest like every other
 * secret. The binding rule is the shared one (`binding.ts`): an unbound
 * conversation is never answered.
 */
import { decryptSecret, encryptSecret } from "../_core/crypto";
import * as db from "../db";
import { handleChannelChat } from "./bridge";
import { sendChannelParts } from "./send-parts";
import { getActivePersonaId, handleCommand } from "./commands";
import {
  clearBindCode,
  ensureBindCode,
  handleBindAttempt,
  isBindableChannel,
  readChannelCursor,
  requireBoundChannel,
  writeChannelCursor,
} from "./binding";
import type { ChannelAdapter, ChannelId, ChannelStatus } from "./types";
import { copy, type Locale } from "@shared/copy";

const CHANNEL_ID = "telegram" as const;
const API_BASE = "https://api.telegram.org";
/** How long one getUpdates call may wait for a message. */
export const TELEGRAM_POLL_TIMEOUT_SEC = 25;
/** Backoff after a failed poll. */
export const TELEGRAM_RETRY_MS = 3_000;

interface TelegramCredentials {
  botToken: string;
  botUsername?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot?: boolean; username?: string; first_name?: string };
    chat?: { id: number; type?: string; title?: string; username?: string };
    text?: string;
  };
}

interface RunningPoll {
  controller: AbortController;
  done: Promise<void>;
  botUsername?: string;
}

const running = new Map<number, RunningPoll>();

async function readCredentials(userId: number): Promise<TelegramCredentials | null> {
  const state = await db.getChannelState(userId, CHANNEL_ID);
  if (!state?.credentialsEnc) return null;
  const plain = await decryptSecret(state.credentialsEnc);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as TelegramCredentials;
    return parsed?.botToken ? parsed : null;
  } catch {
    return null;
  }
}

/** Stores the bot token, encrypted. */
export async function setTelegramCredentials(
  userId: number,
  credentials: { botToken?: string; botUsername?: string },
): Promise<void> {
  const current = await readCredentials(userId);
  const next: TelegramCredentials = {
    botToken: credentials.botToken?.trim() || current?.botToken || "",
    botUsername: credentials.botUsername?.trim() || current?.botUsername,
  };
  if (!next.botToken) return;
  await db.upsertChannelState(userId, CHANNEL_ID, {
    credentialsEnc: await encryptSecret(JSON.stringify(next)),
  });
}

/**
 * What one update says, in the shape the handler needs.
 *
 * Pure: the interesting decisions (a bot's own message, a group, an
 * edit) are made here and tested without a bot.
 */
export function interpretTelegramUpdate(update: TelegramUpdate): {
  updateId: number;
  chatId: string;
  chatType: string;
  chatName: string | null;
  senderId: string | null;
  text: string | null;
  fromBot: boolean;
} | null {
  if (!update || typeof update.update_id !== "number") return null;
  const message = update.message;
  if (!message?.chat || typeof message.chat.id !== "number") return null;
  return {
    updateId: update.update_id,
    chatId: String(message.chat.id),
    chatType: String(message.chat.type ?? ""),
    chatName: message.chat.title ?? message.chat.username ?? message.from?.first_name ?? null,
    senderId: message.from ? String(message.from.id) : null,
    text: typeof message.text === "string" ? message.text : null,
    fromBot: Boolean(message.from?.is_bot),
  };
}

function localeOf(value: unknown): Locale {
  if (value === "en") return "en";
  if (value === "zh-Hant") return "zh-Hant";
  return "zh";
}

/**
 * Handles one Telegram update for one user.
 *
 * The order is the binding rule: a group is dropped, a bot's message is
 * dropped, an unbound conversation may only say `/bind`, and only a bound
 * direct conversation reaches the pipeline.
 */
export async function handleTelegramUpdate(params: {
  userId: number;
  update: TelegramUpdate;
  sendText: (chatId: string, text: string) => Promise<void>;
  locale?: Locale;
}): Promise<void> {
  const { userId, sendText } = params;
  const seen = interpretTelegramUpdate(params.update);
  if (!seen) return;
  const locale = params.locale ?? (await db.getUserLocale(userId).catch(() => "zh" as Locale));
  // Only private conversations. A group is ignored entirely.
  if (seen.chatType !== "private") return;
  // The bot's own messages are not answered.
  if (seen.fromBot) return;
  if (!seen.text || !seen.text.trim()) return;

  const binding = await requireBoundChannel({
    userId,
    channel: CHANNEL_ID,
    conversationKey: seen.chatId,
  });
  if (!binding) {
    const outcome = await handleBindAttempt({
      userId,
      channel: CHANNEL_ID,
      conversationKey: seen.chatId,
      conversationName: seen.chatName,
      text: seen.text,
      locale,
    });
    if (outcome.handled && outcome.reply) await sendText(seen.chatId, outcome.reply);
    return;
  }

  const defaultPersona = await db.getChannelDefaultPersona(userId, CHANNEL_ID);
  if (!defaultPersona) return;
  let commandResult: Awaited<ReturnType<typeof handleCommand>>;
  try {
    commandResult = await handleCommand({
      userId,
      conversationKey: seen.chatId,
      text: seen.text,
      defaultPersonaId: defaultPersona.personaId,
      channel: CHANNEL_ID,
      sendLetter: async (letter) => {
        await sendText(seen.chatId, letter);
        return true;
      },
    });
  } catch (error) {
    console.warn("[Telegram] The command failed:", (error as Error).message);
    await sendText(seen.chatId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (commandResult.handled) {
    if (commandResult.reply) await sendText(seen.chatId, commandResult.reply);
    return;
  }

  const personaId = getActivePersonaId(seen.chatId, binding.personaId, userId);
  let reply: Awaited<ReturnType<typeof handleChannelChat>> = null;
  try {
    reply = await handleChannelChat({
      userId,
      conversationKey: seen.chatId,
      personaId,
      messageText: seen.text,
      channel: CHANNEL_ID,
      locale,
    });
  } catch (error) {
    console.warn("[Telegram] Could not answer:", (error as Error).message);
    await sendText(seen.chatId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (!reply) return;
  try {
    await sendChannelParts(reply, (part) => sendText(seen.chatId, part));
  } catch (error) {
    console.warn("[Telegram] Could not send the reply:", (error as Error).message);
    await sendText(
      seen.chatId,
      copy(locale, "channels.messageFailed", { reason: (error as Error).message.slice(0, 200) }),
    );
  }
}

/** One sendMessage call. Exported so a test can drive it with a fake fetch. */
export async function sendTelegramMessage(
  fetchImpl: typeof fetch,
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const response = await fetchImpl(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram answered ${response.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * The long-poll loop.
 *
 * The offset is the last handled `update_id + 1`, exactly as the Bot API
 * documentation says; it is kept in the channel's cursor so a restart
 * does not answer the same message twice.
 */
export async function runTelegramPoll(params: {
  userId: number;
  token: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  onUpdate: (update: TelegramUpdate) => Promise<void>;
  initialOffset?: number;
  onError?: (error: Error) => void;
}): Promise<void> {
  // The scanner in `server/egress.test.ts` looks for a literal `fetch(`
  // call: the real request is this one, wrapped so a test can drive it.
  const fetchImpl: typeof fetch =
    params.fetchImpl ?? ((input, init) => fetch(input, init));
  let offset = params.initialOffset ?? 0;
  for (;;) {
    if (params.signal.aborted) return;
    try {
      const url = new URL(`${API_BASE}/bot${params.token}/getUpdates`);
      url.searchParams.set("timeout", String(TELEGRAM_POLL_TIMEOUT_SEC));
      url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
      if (offset > 0) url.searchParams.set("offset", String(offset));
      const response = await fetchImpl(url.toString(), { signal: params.signal });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: TelegramUpdate[];
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (response.status === 429) {
        const wait = Math.max(1, Number(body.parameters?.retry_after ?? 3)) * 1000;
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (!response.ok || body.ok === false) {
        throw new Error(body.description || `Telegram answered ${response.status}`);
      }
      for (const update of body.result ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        await writeChannelCursor(params.userId, CHANNEL_ID, { cursor: String(offset) });
        await params.onUpdate(update);
      }
    } catch (error) {
      if (params.signal.aborted) return;
      params.onError?.(error as Error);
      await new Promise((resolve) => setTimeout(resolve, TELEGRAM_RETRY_MS));
    }
  }
}

function cancelRunning(userId: number): void {
  const poll = running.get(userId);
  if (!poll) return;
  poll.controller.abort();
  running.delete(userId);
}

export const telegramAdapter: ChannelAdapter = {
  id: CHANNEL_ID,
  label: "Telegram",
  requiresCredentials: true,

  async start(userId: number, locale: Locale = "zh"): Promise<void> {
    const credentials = await readCredentials(userId);
    if (!credentials) {
      throw new Error(copy(locale, "errors.channelCredentialsMissing"));
    }
    cancelRunning(userId);
    const controller = new AbortController();
    const code = await ensureBindCode(userId, CHANNEL_ID);
    const cursor = await readChannelCursor(userId, CHANNEL_ID);
    const offset = Number(cursor.cursor ?? 0) || 0;
    await db.upsertChannelState(userId, CHANNEL_ID, {
      status: "running",
      lastError: null,
    });
    const done = runTelegramPoll({
      userId,
      token: credentials.botToken,
      signal: controller.signal,
      initialOffset: offset,
      onUpdate: (update) =>
        handleTelegramUpdate({
          userId,
          update,
          sendText: (chatId, text) =>
            sendTelegramMessage(fetch, credentials.botToken, chatId, text),
          locale,
        }),
      onError: (error) => {
        void db
          .upsertChannelState(userId, CHANNEL_ID, { lastError: error.message.slice(0, 500) })
          .catch(() => undefined);
      },
    }).catch((error) => {
      console.warn("[Telegram] The poll loop stopped:", (error as Error).message);
    });
    running.set(userId, { controller, done, botUsername: credentials.botUsername });
    void code;
  },

  async stop(userId: number): Promise<void> {
    cancelRunning(userId);
    await db.upsertChannelState(userId, CHANNEL_ID, { status: "stopped" }).catch(() => undefined);
  },

  async stopAll(): Promise<void> {
    for (const userId of [...running.keys()]) cancelRunning(userId);
  },

  async status(userId: number): Promise<ChannelStatus> {
    const state = await db.getChannelState(userId, CHANNEL_ID).catch(() => undefined);
    const poll = running.get(userId);
    const connected = Boolean(poll) || state?.status === "running";
    const cursor = await readChannelCursor(userId, CHANNEL_ID);
    const bindingCount = (await db.getChannelBindingsByUserId(userId, CHANNEL_ID).catch(() => []))
      .filter((row) => row.isActive).length;
    return {
      channel: CHANNEL_ID,
      connected,
      status: state?.status ?? (connected ? "running" : "stopped"),
      detail: {
        ...(state?.lastError ? { error: state.lastError } : {}),
        ...(cursor.bindCode && bindingCount === 0 ? { bindCode: cursor.bindCode } : {}),
        ...(cursor.bindCode && bindingCount === 0
          ? { bindNoteKey: "channels.bindCodeNote" }
          : {}),
      },
    };
  },

  async send(userId: number, targetId: string, text: string, locale: Locale = "zh"): Promise<void> {
    const credentials = await readCredentials(userId);
    if (!credentials) throw new Error(copy(locale, "errors.channelCredentialsMissing"));
    await sendTelegramMessage(fetch, credentials.botToken, targetId, text);
  },

  async setDefaultPersona(userId: number, personaId: number): Promise<void> {
    await db.setChannelDefaultPersona({ userId, channel: CHANNEL_ID, personaId });
  },

  async restore(userId: number): Promise<boolean> {
    const credentials = await readCredentials(userId);
    if (!credentials) return false;
    const state = await db.getChannelState(userId, CHANNEL_ID).catch(() => undefined);
    if (state?.status !== "running") return false;
    await telegramAdapter.start(userId);
    return true;
  },
};

/** The channel id as the enum knows it. Kept next to the adapter. */
export const TELEGRAM_CHANNEL: ChannelId = CHANNEL_ID;

/** Whether this module is a bindable channel — the structural test reads it. */
export const TELEGRAM_IS_BINDABLE = isBindableChannel(CHANNEL_ID);

/** Uses the code up after a bind; exported for the tests. */
export { clearBindCode as clearTelegramBindCode };
