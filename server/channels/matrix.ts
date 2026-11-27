/**
 * Matrix (C9.1).
 *
 * The client-server API, long-polled with `/sync`: no public address is
 * needed, the app dials out like the other two bot channels.
 *
 * Protocol checked against the official specification on 2026-11-24:
 *   https://spec.matrix.org/latest/client-server-api/#syncing
 *   https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3sync
 *   https://spec.matrix.org/latest/client-server-api/#sending-messages
 *   https://spec.matrix.org/latest/client-server-api/#direct-messaging
 *
 * Direct conversations are the joined rooms with exactly two members:
 * the bot and one person. A bot cannot read the person's own `m.direct`
 * account data (account data is per account and the spec only lets a
 * user read their own), so that list is not a usable criterion here — an
 * earlier version read the bot's own, which was always empty and made
 * the channel drop every message. A room the bot is invited to is joined
 * when the invite appears in `/sync`.
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

const CHANNEL_ID = "matrix" as const;
export const MATRIX_SYNC_TIMEOUT_MS = 30_000;
export const MATRIX_RETRY_MS = 3_000;

export interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
}

/**
 * A homeserver address, with a scheme.
 *
 * People type `matrix.example.org` into the settings field; `fetch` needs
 * `https://` in front of it. The stored value is normalised once so every
 * later request works.
 */
export function normalizeHomeserverUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export interface MatrixMessage {
  roomId: string;
  eventId: string;
  senderId: string;
  text: string;
}

export interface MatrixSyncResult {
  nextBatch: string | null;
  messages: MatrixMessage[];
  invites: string[];
}

const running = new Map<number, { controller: AbortController; done: Promise<void> }>();

async function readCredentials(userId: number): Promise<MatrixCredentials | null> {
  const state = await db.getChannelState(userId, CHANNEL_ID);
  if (!state?.credentialsEnc) return null;
  const plain = await decryptSecret(state.credentialsEnc);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as MatrixCredentials;
    if (!parsed?.homeserverUrl || !parsed?.accessToken) return null;
    return {
      homeserverUrl: normalizeHomeserverUrl(parsed.homeserverUrl),
      accessToken: parsed.accessToken,
    };
  } catch {
    return null;
  }
}

export async function setMatrixCredentials(
  userId: number,
  credentials: { homeserverUrl?: string; accessToken?: string },
): Promise<void> {
  const current = await readCredentials(userId);
  const next: MatrixCredentials = {
    homeserverUrl: normalizeHomeserverUrl(credentials.homeserverUrl) || current?.homeserverUrl || "",
    accessToken: credentials.accessToken?.trim() || current?.accessToken || "",
  };
  if (!next.homeserverUrl || !next.accessToken) return;
  await db.upsertChannelState(userId, CHANNEL_ID, {
    credentialsEnc: await encryptSecret(JSON.stringify(next)),
  });
}

/**
 * What one `/sync` response says.
 *
 * Pure, so the parsing (which events are text messages, which rooms are
 * invites) is tested without a homeserver.
 */
export function interpretMatrixSync(body: unknown): MatrixSyncResult {
  const sync = (body ?? {}) as {
    next_batch?: unknown;
    rooms?: {
      join?: Record<string, { timeline?: { events?: unknown[] } }>;
      invite?: Record<string, unknown>;
    };
  };
  const messages: MatrixMessage[] = [];
  for (const [roomId, room] of Object.entries(sync.rooms?.join ?? {})) {
    for (const event of room?.timeline?.events ?? []) {
      const row = event as {
        type?: unknown;
        event_id?: unknown;
        sender?: unknown;
        content?: { msgtype?: unknown; body?: unknown };
      };
      if (row?.type !== "m.room.message") continue;
      if (row.content?.msgtype !== "m.text") continue;
      if (typeof row.content?.body !== "string" || !row.content.body.trim()) continue;
      if (typeof row.sender !== "string") continue;
      messages.push({
        roomId,
        eventId: typeof row.event_id === "string" ? row.event_id : `${roomId}:${messages.length}`,
        senderId: row.sender,
        text: row.content.body,
      });
    }
  }
  return {
    nextBatch: typeof sync.next_batch === "string" ? sync.next_batch : null,
    messages,
    invites: Object.keys(sync.rooms?.invite ?? {}),
  };
}

/** Handles one direct message, with the shared binding rule first. */
export async function handleMatrixMessage(params: {
  userId: number;
  message: MatrixMessage;
  sendText: (roomId: string, text: string) => Promise<void>;
  locale?: Locale;
}): Promise<void> {
  const { userId, message, sendText } = params;
  const locale = params.locale ?? (await db.getUserLocale(userId).catch(() => "zh" as Locale));
  const binding = await requireBoundChannel({
    userId,
    channel: CHANNEL_ID,
    conversationKey: message.roomId,
  });
  if (!binding) {
    const outcome = await handleBindAttempt({
      userId,
      channel: CHANNEL_ID,
      conversationKey: message.roomId,
      text: message.text,
      locale,
    });
    if (outcome.handled && outcome.reply) await sendText(message.roomId, outcome.reply);
    return;
  }
  const defaultPersona = await db.getChannelDefaultPersona(userId, CHANNEL_ID);
  if (!defaultPersona) return;
  let commandResult: Awaited<ReturnType<typeof handleCommand>>;
  try {
    commandResult = await handleCommand({
      userId,
      conversationKey: message.roomId,
      text: message.text,
      defaultPersonaId: defaultPersona.personaId,
      channel: CHANNEL_ID,
      sendLetter: async (letter) => {
        await sendText(message.roomId, letter);
        return true;
      },
    });
  } catch (error) {
    console.warn("[Matrix] The command failed:", (error as Error).message);
    await sendText(message.roomId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (commandResult.handled) {
    if (commandResult.reply) await sendText(message.roomId, commandResult.reply);
    return;
  }
  const personaId = getActivePersonaId(message.roomId, binding.personaId, userId);
  let reply: Awaited<ReturnType<typeof handleChannelChat>> = null;
  try {
    reply = await handleChannelChat({
      userId,
      conversationKey: message.roomId,
      personaId,
      messageText: message.text,
      channel: CHANNEL_ID,
      locale,
    });
  } catch (error) {
    console.warn("[Matrix] Could not answer:", (error as Error).message);
    await sendText(message.roomId, copy(locale, "channels.replyFailed"));
    return;
  }
  if (!reply) return;
  try {
    await sendChannelParts(reply, (part) => sendText(message.roomId, part));
  } catch (error) {
    console.warn("[Matrix] Could not send the reply:", (error as Error).message);
    await sendText(
      message.roomId,
      copy(locale, "channels.messageFailed", { reason: (error as Error).message.slice(0, 200) }),
    );
  }
}

/** One `m.room.message` send. */
export async function sendMatrixMessage(
  fetchImpl: typeof fetch,
  credentials: MatrixCredentials,
  roomId: string,
  text: string,
): Promise<void> {
  const txn = randomUUID();
  const url = `${credentials.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`;
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ msgtype: "m.text", body: text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Matrix answered ${response.status}: ${body.slice(0, 200)}`);
  }
}

/** Who the access token is. The bot needs its own user id to ignore itself. */
export async function matrixWhoAmI(
  fetchImpl: typeof fetch,
  credentials: MatrixCredentials,
): Promise<string> {
  const response = await fetchImpl(`${credentials.homeserverUrl}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });
  if (!response.ok) throw new Error(`Matrix answered ${response.status} for whoami`);
  const body = (await response.json().catch(() => ({}))) as { user_id?: unknown };
  if (typeof body.user_id !== "string") throw new Error("Matrix did not say who this token is.");
  return body.user_id;
}

/**
 * How many people are joined to a room, or `null` when Matrix could not
 * answer.
 *
 * A bot cannot see the person's own `m.direct` list, so "is this a direct
 * conversation" is answered the only way a bot can observe it: a joined
 * room with exactly two members is the bot and one person.
 */
export async function matrixRoomMemberCount(
  fetchImpl: typeof fetch,
  credentials: MatrixCredentials,
  roomId: string,
): Promise<number | null> {
  const response = await fetchImpl(
    `${credentials.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members?membership=join`,
    { headers: { Authorization: `Bearer ${credentials.accessToken}` } },
  );
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { chunk?: unknown };
  if (!Array.isArray(body.chunk)) return null;
  const members = new Set<string>();
  for (const event of body.chunk) {
    const row = event as { type?: unknown; state_key?: unknown; content?: { membership?: unknown } };
    if (row?.type !== "m.room.member") continue;
    if (row.content?.membership !== "join") continue;
    if (typeof row.state_key === "string") members.add(row.state_key);
  }
  return members.size;
}

/** Whether this is a one-to-one room (the bot and one person). */
export async function matrixRoomIsDirect(
  fetchImpl: typeof fetch,
  credentials: MatrixCredentials,
  roomId: string,
): Promise<boolean> {
  return (await matrixRoomMemberCount(fetchImpl, credentials, roomId)) === 2;
}

/**
 * The inbound path: a room the bot is not in a one-to-one conversation
 * with is ignored entirely, then the ordinary binding rule applies.
 */
export async function handleMatrixInbound(params: {
  userId: number;
  message: MatrixMessage;
  credentials: MatrixCredentials;
  sendText: (roomId: string, text: string) => Promise<void>;
  locale?: Locale;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const direct = await matrixRoomIsDirect(
    params.fetchImpl ?? fetch,
    params.credentials,
    params.message.roomId,
  );
  if (!direct) return;
  await handleMatrixMessage({
    userId: params.userId,
    message: params.message,
    sendText: params.sendText,
    locale: params.locale,
  });
}

/** Joins a room the bot was invited to. */
export async function matrixJoinRoom(
  fetchImpl: typeof fetch,
  credentials: MatrixCredentials,
  roomId: string,
): Promise<void> {
  await fetchImpl(
    `${credentials.homeserverUrl}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  ).catch(() => undefined);
}

/**
 * The `/sync` loop.
 *
 * `since` is the `next_batch` of the last response, kept in the channel's
 * cursor; a restart resumes from it rather than re-reading the history.
 */
export async function runMatrixSync(params: {
  credentials: MatrixCredentials;
  ownUserId: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  onMessage: (message: MatrixMessage) => Promise<void>;
  /** Called with the new `next_batch`, so a restart resumes there. */
  onSync?: (since: string) => Promise<void>;
  initialSince?: string | null;
  onError?: (error: Error) => void;
  timeoutMs?: number;
}): Promise<void> {
  // See the note in telegram.ts: the literal `fetch(` call is what the
  // outbound inventory test recognises.
  const fetchImpl: typeof fetch =
    params.fetchImpl ?? ((input, init) => fetch(input, init));
  let since = params.initialSince ?? null;
  for (;;) {
    if (params.signal.aborted) return;
    try {
      const url = new URL(`${params.credentials.homeserverUrl}/_matrix/client/v3/sync`);
      url.searchParams.set("timeout", String(params.timeoutMs ?? MATRIX_SYNC_TIMEOUT_MS));
      if (since) url.searchParams.set("since", since);
      const response = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${params.credentials.accessToken}` },
        signal: params.signal,
      });
      if (!response.ok) throw new Error(`Matrix answered ${response.status} for sync`);
      if (params.signal.aborted) return;
      const result = interpretMatrixSync(await response.json().catch(() => ({})));
      for (const roomId of result.invites) {
        await matrixJoinRoom(fetchImpl, params.credentials, roomId);
      }
      for (const message of result.messages) {
        if (message.senderId === params.ownUserId) continue;
        await params.onMessage(message);
      }
      if (result.nextBatch && result.nextBatch !== since) {
        since = result.nextBatch;
        await params.onSync?.(since);
      }
    } catch (error) {
      if (params.signal.aborted) return;
      params.onError?.(error as Error);
      await new Promise((resolve) => setTimeout(resolve, MATRIX_RETRY_MS));
    }
  }
}

function cancelRunning(userId: number): void {
  const run = running.get(userId);
  if (!run) return;
  run.controller.abort();
  running.delete(userId);
}

export const matrixAdapter: ChannelAdapter = {
  id: CHANNEL_ID,
  label: "Matrix",
  requiresCredentials: true,

  async start(userId: number, locale: Locale = "zh"): Promise<void> {
    const credentials = await readCredentials(userId);
    if (!credentials) throw new Error(copy(locale, "errors.channelCredentialsMissing"));
    cancelRunning(userId);
    const controller = new AbortController();
    const ownUserId = await matrixWhoAmI(fetch, credentials);
    await ensureBindCode(userId, CHANNEL_ID);
    const cursor = await readChannelCursor(userId, CHANNEL_ID);
    await db.upsertChannelState(userId, CHANNEL_ID, { status: "running", lastError: null });
    const done = runMatrixSync({
      credentials,
      ownUserId,
      signal: controller.signal,
      initialSince: cursor.cursor ?? null,
      onMessage: (message) => handleMatrixInbound({
        userId,
        message,
        credentials,
        sendText: (roomId, text) => sendMatrixMessage(fetch, credentials, roomId, text),
        locale,
      }),
      onSync: (since) => rememberMatrixSince(userId, since),
      onError: (error) => {
        void db
          .upsertChannelState(userId, CHANNEL_ID, { lastError: error.message.slice(0, 500) })
          .catch(() => undefined);
      },
    }).catch((error) => {
      console.warn("[Matrix] The sync loop stopped:", (error as Error).message);
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
    await sendMatrixMessage(fetch, credentials, targetId, text);
  },

  async setDefaultPersona(userId: number, personaId: number): Promise<void> {
    await db.setChannelDefaultPersona({ userId, channel: CHANNEL_ID, personaId });
  },

  async restore(userId: number): Promise<boolean> {
    const credentials = await readCredentials(userId);
    if (!credentials) return false;
    const state = await db.getChannelState(userId, CHANNEL_ID).catch(() => undefined);
    if (state?.status !== "running") return false;
    await matrixAdapter.start(userId);
    return true;
  },
};

/** The cursor the sync loop keeps: the last `next_batch`. */
export async function rememberMatrixSince(
  userId: number,
  since: string,
): Promise<void> {
  await writeChannelCursor(userId, CHANNEL_ID, { cursor: since });
}

/** Uses the code up after a bind; exported for the tests. */
export { clearBindCode as clearMatrixBindCode };
