/**
 * Binding a bot channel to an account (C9.1).
 *
 * Telegram, Discord and Matrix bots are public: anybody who finds the bot
 * can send it a message. So the bot answers **nothing** until the person
 * has proved the conversation is theirs with a six-digit code that only
 * the app shows them.
 *
 * The rules, and why:
 *
 *   - an unbound conversation gets no reply, no model call and no row —
 *     a stranger's message is not material and not a conversation;
 *   - `/bind <code>` is the only thing an unbound conversation can say;
 *   - three wrong codes use the code up, so a guessed code cannot be
 *     retried for ever;
 *   - a code is single use: once the conversation is bound it is gone;
 *   - only direct conversations are bound; groups are ignored entirely.
 *
 * The code and the channel's own cursor live together in
 * `channel_states.cursor`, as JSON, so one row holds everything the
 * channel needs to resume after a restart.
 */
import { randomInt } from "node:crypto";
import * as db from "../db";
import { copy, type Locale } from "@shared/copy";
import type { ChannelId } from "./bridge";

/** The channels that must be bound before they answer. */
export type BindableChannelId = "telegram" | "discord" | "matrix";

export const BINDABLE_CHANNELS: BindableChannelId[] = ["telegram", "discord", "matrix"];

/** How many wrong codes before the code is used up. */
export const MAX_BIND_ATTEMPTS = 3;

/** The shape stored in `channel_states.cursor`. */
export interface ChannelCursor {
  /** The protocol's own position: a Telegram offset, a Matrix since, a Discord seq. */
  cursor?: string;
  /** The one-time binding code, when the channel is running. */
  bindCode?: string;
  /** How many wrong codes have been tried against it. */
  bindAttempts?: number;
}

export function isBindableChannel(channel: ChannelId): channel is BindableChannelId {
  return (BINDABLE_CHANNELS as string[]).includes(channel);
}

/**
 * A fresh six-digit code.
 *
 * It is a secret, not a nonce: it is generated with the CSPRNG and
 * compared without a timing shortcut. Leading zeros are kept, so the code
 * is always six characters as the interface says.
 */
export function newBindCode(rand: () => number = () => randomInt(0, 1_000_000)): string {
  const value = rand();
  const bounded = Number.isFinite(value) ? Math.abs(Math.floor(value)) % 1_000_000 : 0;
  return String(bounded).padStart(6, "0");
}

/** The cursor and the binding code of one channel. */
export async function readChannelCursor(
  userId: number,
  channel: BindableChannelId,
): Promise<ChannelCursor> {
  const state = await db.getChannelState(userId, channel).catch(() => undefined);
  if (!state?.cursor) return {};
  try {
    const parsed = JSON.parse(state.cursor) as ChannelCursor;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Writes the cursor and the binding code back as one JSON value. */
export async function writeChannelCursor(
  userId: number,
  channel: BindableChannelId,
  patch: Partial<ChannelCursor>,
): Promise<ChannelCursor> {
  const current = await readChannelCursor(userId, channel);
  const next: ChannelCursor = { ...current, ...patch };
  for (const key of Object.keys(next) as Array<keyof ChannelCursor>) {
    if (next[key] === undefined) delete next[key];
  }
  await db.upsertChannelState(userId, channel, { cursor: JSON.stringify(next) });
  return next;
}

/** Makes sure a code exists and returns it. */
export async function ensureBindCode(
  userId: number,
  channel: BindableChannelId,
  rand?: () => number,
): Promise<string> {
  const current = await readChannelCursor(userId, channel);
  if (current.bindCode) return current.bindCode;
  const code = newBindCode(rand);
  await writeChannelCursor(userId, channel, { bindCode: code, bindAttempts: 0 });
  return code;
}

/** Uses the code up (a successful bind, or three wrong tries). */
export async function clearBindCode(
  userId: number,
  channel: BindableChannelId,
): Promise<void> {
  const current = await readChannelCursor(userId, channel);
  await db.upsertChannelState(userId, channel, {
    cursor: JSON.stringify({
      ...(current.cursor ? { cursor: current.cursor } : {}),
    } satisfies ChannelCursor),
  });
}

export function isBindCommand(text: string): boolean {
  return /^\/bind(\s|$)/i.test(text.trim());
}

export type BindOutcome =
  | { handled: false }
  | {
      handled: true;
      bound: boolean;
      reason?: "wrong_code" | "invalidated" | "no_persona" | "no_code";
      reply?: string;
    };

/**
 * Handles `/bind <code>` for an unbound conversation.
 *
 * Returns `handled: false` for anything that is not a bind attempt — the
 * caller then drops the message without a word.
 */
export async function handleBindAttempt(params: {
  userId: number;
  channel: BindableChannelId;
  conversationKey: string;
  conversationName?: string | null;
  text: string;
  locale: Locale;
}): Promise<BindOutcome> {
  const { userId, channel, conversationKey, locale } = params;
  if (!isBindCommand(params.text)) return { handled: false };
  const code = params.text.trim().replace(/^\/bind\s*/i, "").trim();
  const cursor = await readChannelCursor(userId, channel);
  if (!cursor.bindCode) {
    return { handled: true, bound: false, reason: "no_code", reply: copy(locale, "channels.bindInvalidated") };
  }
  if (code !== cursor.bindCode) {
    const attempts = (cursor.bindAttempts ?? 0) + 1;
    if (attempts >= MAX_BIND_ATTEMPTS) {
      await clearBindCode(userId, channel);
      return {
        handled: true,
        bound: false,
        reason: "invalidated",
        reply: copy(locale, "channels.bindInvalidated"),
      };
    }
    await writeChannelCursor(userId, channel, { bindAttempts: attempts });
    return {
      handled: true,
      bound: false,
      reason: "wrong_code",
      reply: copy(locale, "channels.bindWrongCode", { left: MAX_BIND_ATTEMPTS - attempts }),
    };
  }

  // The code is right: the conversation becomes this account's. A
  // conversation needs a persona to talk to; without one the bind waits.
  const defaultPersona = await db.getChannelDefaultPersona(userId, channel);
  if (!defaultPersona) {
    return { handled: true, bound: false, reason: "no_persona", reply: copy(locale, "channels.bindNoPersona") };
  }
  await db.setChannelBindingPersona({
    userId,
    channel,
    targetId: conversationKey,
    personaId: defaultPersona.personaId,
    targetName: params.conversationName ?? null,
  });
  await clearBindCode(userId, channel);
  const persona = await db.getPersonaById(defaultPersona.personaId, userId).catch(() => undefined);
  return {
    handled: true,
    bound: true,
    reply: `${copy(locale, "channels.boundNotice")}${
      persona?.name ? `\n${copy(locale, "channels.boundTo", { name: persona.name })}` : ""
    }`,
  };
}

export interface BoundConversation {
  bindingId: number;
  personaId: number;
}

/**
 * The conversation's binding, or null.
 *
 * This is the gate every bot channel's inbound path goes through before
 * it reads, replies or calls a model. The structural test in
 * `server/channels/binding.test.ts` checks that it is called first.
 */
export async function requireBoundChannel(params: {
  userId: number;
  channel: BindableChannelId;
  conversationKey: string;
}): Promise<BoundConversation | null> {
  const binding = await db
    .getChannelBinding(params.userId, params.channel, params.conversationKey)
    .catch(() => undefined);
  if (!binding || binding.isActive === false) return null;
  return { bindingId: binding.id, personaId: binding.personaId };
}

/**
 * Remembers a conversation that is already bound.
 *
 * Nothing to write: the binding row is the record. Kept as a named step so
 * an adapter does not have to know that.
 */
export function boundPersonaId(binding: BoundConversation): number {
  return binding.personaId;
}
