/**
 * Discord (C9.1).
 *
 * A bot user connected to the Gateway over a WebSocket, receiving direct
 * messages and answering over REST. No public address is needed: like the
 * Telegram channel, the app dials out.
 *
 * Protocol checked against the official documentation on 2026-11-24:
 *   https://discord.com/developers/docs/topics/gateway
 *   https://discord.com/developers/docs/topics/gateway-events#message-create
 *   https://discord.com/developers/docs/resources/message#create-message
 *
 * The bot does not need the privileged Message Content intent: direct
 * messages arrive with their text when the DIRECT_MESSAGES intent is
 * requested. It is marked unverified in the progress file because there
 * is no real Discord account on this machine to try it with.
 *
 * "Only private messages" needs two checks: a guild id rules out server
 * channels, and a group DM has no guild id either. The channel's own type
 * (DM = 1, group DM = 3) is therefore fetched over REST and cached for
 * the connection; only type 1 is answered.
 */
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "../_core/crypto";
import * as db from "../db";
import { handleChannelChat } from "./bridge";
import { sendChannelParts } from "./send-parts";
import { getActivePersonaId, handleCommand } from "./commands";
import {
  clearBindCode,
  ensureBindCode,
  handleBindAttempt,
  readChannelCursor,
  requireBoundChannel,
  writeChannelCursor,
} from "./binding";
import type { ChannelAdapter, ChannelStatus } from "./types";
import { copy, type Locale } from "@shared/copy";

const CHANNEL_ID = "discord" as const;
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const REST_BASE = "https://discord.com/api/v10";
/**
 * DIRECT_MESSAGES (4096).
 *
 * The privileged MESSAGE_CONTENT intent is not needed for direct
 * messages: Discord delivers their content to an app that has the DM
 * intent. Asking for the privileged one would make the bot impossible to
 * start until the operator enabled it in the developer portal.
 */
export const DISCORD_INTENTS = 1 << 12;
export const DISCORD_RECONNECT_MS = 2_000;

interface DiscordCredentials {
  botToken: string;
}

/** The WebSocket surface the loop needs; tests pass a fake. */
export interface DiscordSocket {
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "message" | "close" | "error" | "open", handler: (event: any) => void): void;
}

export type DiscordSocketFactory = (url: string) => DiscordSocket;

export interface DiscordMessage {
  channelId: string;
  messageId: string;
  authorId: string | null;
  text: string;
}

const running = new Map<number, { controller: AbortController; done: Promise<void> }>();

async function readCredentials(userId: number): Promise<DiscordCredentials | null> {
  const state = await db.getChannelState(userId, CHANNEL_ID);
  if (!state?.credentialsEnc) return null;
  const plain = await decryptSecret(state.credentialsEnc);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as DiscordCredentials;
    return parsed?.botToken ? parsed : null;
  } catch {
    return null;
  }
}

export async function setDiscordCredentials(
  userId: number,
  credentials: { botToken?: string },
): Promise<void> {
  const current = await readCredentials(userId);
  const token = credentials.botToken?.trim() || current?.botToken || "";
  if (!token) return;
  await db.upsertChannelState(userId, CHANNEL_ID, {
    credentialsEnc: await encryptSecret(JSON.stringify({ botToken: token })),
  });
}

/** The identify payload, as the Gateway documents it. */
export function discordIdentify(token: string): Record<string, unknown> {
  return {
    op: 2,
    d: {
      token,
      intents: DISCORD_INTENTS,
      properties: { os: process.platform, browser: "mirrai", device: "mirrai" },
    },
  };
}

/** The resume payload, after a dropped connection. */
export function discordResume(
  token: string,
  sessionId: string,
  seq: number,
): Record<string, unknown> {
  return { op: 6, d: { token, session_id: sessionId, seq } };
}

/** What one MESSAGE_CREATE says, when it is a direct message from a person. */
export function interpretDiscordMessage(event: any): DiscordMessage | null {
  if (!event || typeof event !== "object") return null;
  if (typeof event.id !== "string" || typeof event.channel_id !== "string") return null;
  // A guild id means a server channel; only direct messages are handled.
  if (event.guild_id) return null;
  if (event.author?.bot) return null;
  if (typeof event.content !== "string" || !event.content.trim()) return null;
  return {
    channelId: event.channel_id,
    messageId: event.id,
    authorId: typeof event.author?.id === "string" ? event.author.id : null,
    text: event.content,
  };
}

/**
 * The channel's Discord type, or `null` when Discord could not answer.
 *
 * MESSAGE_CREATE does not carry the channel type, so a group DM (no
 * `guild_id`, like a 1:1 DM) has to be told apart over REST. Failing to
 * read the type is treated as "not a direct message": the safe answer is
 * to stay quiet rather than to answer into a group.
 */
export async function discordChannelType(
  fetchImpl: typeof fetch,
  token: string,
  channelId: string,
): Promise<number | null> {
  const response = await fetchImpl(`${REST_BASE}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { type?: unknown };
  return typeof body.type === "number" ? body.type : null;
}

/** Whether the channel is a one-to-one direct message (Discord type 1). */
export async function discordChannelIsDm(
  fetchImpl: typeof fetch,
  token: string,
  channelId: string,
): Promise<boolean> {
  return (await discordChannelType(fetchImpl, token, channelId)) === 1;
}

/**
 * The inbound path: only a one-to-one direct message reaches the binding
 * rule. A group DM has no `guild_id` but is still a group, and is dropped
 * here.
 */
export async function handleDiscordInbound(params: {
  userId: number;
  message: DiscordMessage;
  token: string;
  sendText: (channelId: string, text: string) => Promise<void>;
  locale?: Locale;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const dm = await discordChannelIsDm(
    params.fetchImpl ?? fetch,
    params.token,
    params.message.channelId,
  );
  if (!dm) return;
  await handleDiscordMessage({
    userId: params.userId,
    message: params.message,
    sendText: params.sendText,
    locale: params.locale,
  });
}

/**
 * Handles one direct message for one user — the same binding rule as
 * every bot channel: unbound conversations may only say `/bind`.
 */
export async function handleDiscordMessage(params: {
  userId: number;
  message: DiscordMessage;
  sendText: (channelId: string, text: string) => Promise<void>;
  locale?: Locale;
}): Promise<void> {
  const { userId, message, sendText } = params;
  const locale = params.locale ?? (await db.getUserLocale(userId).catch(() => "zh" as Locale));
  const binding = await requireBoundChannel({
    userId,
    channel: CHANNEL_ID,
    conversationKey: message.channelId,
  });
  if (!binding) {
    const outcome = await handleBindAttempt({
      userId,
      channel: CHANNEL_ID,
      conversationKey: message.channelId,
      text: message.text,
      locale,
    });
    if (outcome.handled && outcome.reply) await sendText(message.channelId, outcome.reply);
    return;
  }
  const defaultPersona = await db.getChannelDefaultPersona(userId, CHANNEL_ID);
  if (!defaultPersona) return;
  let commandResult: Awaited<ReturnType<typeof handleCommand>>;
  try {
    commandResult = await handleCommand({
      userId,
      conversationKey: message.channelId,
      text: message.text,
      defaultPersonaId: defaultPersona.personaId,
      channel: CHANNEL_ID,
      sendLetter: async (letter) => {
        await sendText(message.channelId, letter);
        return true;
      },
    });
  } catch (error) {
    console.warn("[Discord] The command failed:", (error as Error).message);
    await sendText(message.channelId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (commandResult.handled) {
    if (commandResult.reply) await sendText(message.channelId, commandResult.reply);
    return;
  }
  const personaId = getActivePersonaId(message.channelId, binding.personaId, userId);
  let reply: Awaited<ReturnType<typeof handleChannelChat>> = null;
  try {
    reply = await handleChannelChat({
      userId,
      conversationKey: message.channelId,
      personaId,
      messageText: message.text,
      channel: CHANNEL_ID,
      locale,
    });
  } catch (error) {
    console.warn("[Discord] Could not answer:", (error as Error).message);
    await sendText(message.channelId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (!reply) return;
  try {
    await sendChannelParts(reply, (part) => sendText(message.channelId, part));
  } catch (error) {
    console.warn("[Discord] Could not send the reply:", (error as Error).message);
    await sendText(
      message.channelId,
      copy(locale, "channels.messageFailed", { reason: (error as Error).message.slice(0, 200) }),
    );
  }
}

/** One REST send. */
export async function sendDiscordMessage(
  fetchImpl: typeof fetch,
  token: string,
  channelId: string,
  text: string,
): Promise<void> {
  const response = await fetchImpl(`${REST_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord answered ${response.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * The Gateway connection.
 *
 * It reconnects until the signal aborts; a resumed session is preferred
 * after the first READY, exactly as the Gateway documents. The heartbeat
 * interval comes from HELLO; a test can shorten it.
 */
export async function runDiscordGateway(params: {
  token: string;
  signal: AbortSignal;
  socketFactory?: DiscordSocketFactory;
  onMessage: (message: DiscordMessage) => Promise<void>;
  onError?: (error: Error) => void;
  reconnectDelayMs?: number;
  /** Test hook: shorten the heartbeat interval HELLO asks for. */
  heartbeatScale?: number;
}): Promise<void> {
  const socketFactory: DiscordSocketFactory =
    params.socketFactory ?? ((url) => new WebSocket(url) as unknown as DiscordSocket);
  let sessionId: string | null = null;
  let seq = 0;
  const delay = params.reconnectDelayMs ?? DISCORD_RECONNECT_MS;

  for (;;) {
    if (params.signal.aborted) return;
    const socket = socketFactory(GATEWAY_URL);
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      // The promise lasts as long as the connection: it resolves when the
      // socket closes, which is when the loop reconnects.
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => undefined);
        socket.addEventListener("error", (event: unknown) => {
          reject(event instanceof Error ? event : new Error("The Discord socket failed."));
        });
        socket.addEventListener("message", (event: any) => {
          let payload: any;
          try {
            payload = JSON.parse(String(event?.data ?? "{}"));
          } catch {
            return;
          }
          if (typeof payload?.s === "number") seq = payload.s;
          /**
           * The handshake: HELLO says how often to heartbeat, then the
           * session either identifies (first time) or resumes.
           */
          if (payload?.op === 10) {
            const interval = Math.max(50, Number(payload?.d?.heartbeat_interval ?? 41_250) * (params.heartbeatScale ?? 1));
            heartbeat = setInterval(() => {
              try {
                socket.send(JSON.stringify({ op: 1, d: seq }));
              } catch {
                // The socket is going away; the close handler reconnects.
              }
            }, interval);
            if (sessionId) socket.send(JSON.stringify(discordResume(params.token, sessionId, seq)));
            else socket.send(JSON.stringify(discordIdentify(params.token)));
            return;
          }
          if (payload?.op === 7) {
            // Reconnect as asked.
            socket.close();
            return;
          }
          if (payload?.op === 9) {
            /**
             * The session is invalid: it cannot be resumed any more.
             * Forget it so the next connection identifies from scratch
             * rather than resuming the dead session for ever.
             */
            sessionId = null;
            seq = 0;
            socket.close();
            return;
          }
          if (payload?.t === "READY") {
            sessionId = typeof payload?.d?.session_id === "string" ? payload.d.session_id : null;
            return;
          }
          if (payload?.t === "MESSAGE_CREATE") {
            const message = interpretDiscordMessage(payload?.d);
            if (message) {
              void params.onMessage(message).catch((error: unknown) => {
                params.onError?.(error as Error);
              });
            }
          }
        });
        socket.addEventListener("close", () => resolve());
      });
    } catch (error) {
      params.onError?.(error as Error);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
    if (params.signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function cancelRunning(userId: number): void {
  const run = running.get(userId);
  if (!run) return;
  run.controller.abort();
  running.delete(userId);
}

export const discordAdapter: ChannelAdapter = {
  id: CHANNEL_ID,
  label: "Discord",
  requiresCredentials: true,

  async start(userId: number, locale: Locale = "zh"): Promise<void> {
    const credentials = await readCredentials(userId);
    if (!credentials) throw new Error(copy(locale, "errors.channelCredentialsMissing"));
    cancelRunning(userId);
    const controller = new AbortController();
    await ensureBindCode(userId, CHANNEL_ID);
    await db.upsertChannelState(userId, CHANNEL_ID, { status: "running", lastError: null });
    const done = runDiscordGateway({
      token: credentials.botToken,
      signal: controller.signal,
      onMessage: (message) =>
        handleDiscordInbound({
          userId,
          message,
          token: credentials.botToken,
          sendText: (channelId, text) =>
            sendDiscordMessage(fetch, credentials.botToken, channelId, text),
          locale,
        }),
      onError: (error) => {
        void db
          .upsertChannelState(userId, CHANNEL_ID, { lastError: error.message.slice(0, 500) })
          .catch(() => undefined);
      },
    }).catch((error) => {
      console.warn("[Discord] The gateway loop stopped:", (error as Error).message);
    });
    running.set(userId, { controller, done });
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
    const connected = Boolean(running.get(userId)) || state?.status === "running";
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
      },
    };
  },

  async send(userId: number, targetId: string, text: string, locale: Locale = "zh"): Promise<void> {
    const credentials = await readCredentials(userId);
    if (!credentials) throw new Error(copy(locale, "errors.channelCredentialsMissing"));
    await sendDiscordMessage(fetch, credentials.botToken, targetId, text);
  },

  async setDefaultPersona(userId: number, personaId: number): Promise<void> {
    await db.setChannelDefaultPersona({ userId, channel: CHANNEL_ID, personaId });
  },

  async restore(userId: number): Promise<boolean> {
    const credentials = await readCredentials(userId);
    if (!credentials) return false;
    const state = await db.getChannelState(userId, CHANNEL_ID).catch(() => undefined);
    if (state?.status !== "running") return false;
    await discordAdapter.start(userId);
    return true;
  },
};

/** The random id a message send could use for tracing. */
export function discordNonce(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

/** Uses the code up after a bind; exported for the tests. */
export { clearBindCode as clearDiscordBindCode };
