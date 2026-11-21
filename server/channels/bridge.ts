/**
 * The conversation bridge shared by every channel.
 *
 * A channel delivers a message; this turns it into a reply from the user's
 * persona. The actual conversation lives in `server/chat/service.ts`, so the
 * web UI, the streaming endpoint and every channel behave identically —
 * memory recall, the safety layer and the graduation check all apply.
 */
import type { Persona } from "../../drizzle/schema";
import * as db from "../db";
import { runConversation, PersonaAsleepError, ChatClosedError } from "../chat/service";
import { copy } from "@shared/copy";
import { fallbackChannelGapMs, waitAbortable } from "../chat/inbox";
import type { ChannelReply } from "./send-parts";
import { claimSilenceNotice } from "../chat/silence-notice";
import { zonedDateKey, localDateKey } from "@shared/timezone";
import type { Locale } from "@shared/copy";

export type ChannelId = "wechat" | "feishu";

export interface ChannelChatParams {
  userId: number;
  /** The conversation identifier on the channel. */
  conversationKey: string;
  personaId: number;
  messageText: string;
  /** Which channel the message arrived on. */
  channel: ChannelId;
  /**
   * The user's interface language.
   *
   * The channels have no language switch of their own, so this comes from
   * the user's saved preference. It decides which emotion triggers the
   * heuristic uses and which language the prompt is written in.
   */
  locale?: Locale;
}

function gapsFor(parts: string[], given?: number[]): number[] {
  if (parts.length <= 1) return [];
  const out: number[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(given?.[i - 1] ?? fallbackChannelGapMs(parts[i]!));
  }
  return out;
}

/**
 * Handles one inbound channel message against a persona.
 *
 * The persona id is resolved by the caller (default binding, or a
 * session-scoped override chosen with `/使用`).
 *
 * Returns null when the persona cannot answer — not ready, or gone, or
 * a later message took the turn, or the reply was deferred.
 */
export async function handleChannelChat(params: ChannelChatParams): Promise<ChannelReply | null> {
  const { userId, personaId, messageText } = params;

  const persona = await db.getPersonaById(personaId, userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  let parts: string[] = [];
  let gapsMs: number[] = [];
  let graduationSuggested = false;

  try {
    for await (const event of runConversation({
      persona: persona as Persona,
      userId,
      message: messageText,
      providerName: (persona as any).llmProvider || undefined,
      channel: params.channel,
      conversationKey: params.conversationKey,
      mode: "once",
      locale: params.locale ?? "zh",
    })) {
      if (event.type === "delta") {
        parts = [(parts[0] ?? "") + event.text];
        gapsMs = [];
      } else if (event.type === "delay") {
        const wait = Math.min(Math.max(0, event.ms), 90_000);
        if (wait > 0) await waitAbortable(wait);
      } else if (event.type === "silence") {
        // The day is the reader's day, not the persona's. Two clocks can
        // be on different dates; "once a day" follows the person who is
        // reading the channel.
        const zone = (await db.getUserTimezone(userId).catch(() => null))
          || (persona as { timezone?: string | null }).timezone
          || "UTC";
        const day = zonedDateKey(new Date(), zone) || localDateKey(new Date());
        if (!(await claimSilenceNotice(userId, persona.id, day))) return null;
        parts = [event.notice];
        gapsMs = [];
      } else if (event.type === "burst") {
        parts = event.texts.filter((text) => text.length > 0);
        gapsMs = gapsFor(parts, event.gapsMs);
      } else if (event.type === "error") {
        /**
         * A failure is a failure.
         *
         * The pipeline reports one as an event rather than as an
         * exception, so it used to arrive here as an empty reply — and
         * the channel dropped the message without a word. The user saw
         * their message sit there unanswered.
         */
        throw new Error(event.message || "The reply could not be produced.");
      } else if (event.type === "superseded") {
        return null;
      } else if (event.type === "deferred") {
        return null;
      } else if (event.type === "done") {
        graduationSuggested = event.graduationSuggested;
      }
    }
  } catch (e) {
    /**
     * A persona that has said goodbye.
     *
     * `runConversation` throws when the persona is asleep, and the
     * message is the notice the app means to show: "{name} has
     * graduated. If you still want to talk, wake this persona up
     * first."
     *
     * On the web the throw became a response, so the user saw it. On a
     * channel both entry points only logged it — so a person who kept
     * talking to a persona that had said goodbye watched their message
     * sit there unanswered for ever, with no indication that the
     * persona was asleep.
     */
    if (e instanceof PersonaAsleepError) {
      return { parts: [e.message], gapsMs: [] };
    }
    /**
     * The user closed the chat themselves (C6.1).
     *
     * On a channel the notice is a message, so it is sent once a day —
     * the same rule the "they did not reply" notice follows.
     */
    if (e instanceof ChatClosedError) {
      const zone = (await db.getUserTimezone(userId).catch(() => null))
        || (persona as { timezone?: string | null }).timezone
        || "UTC";
      const day = zonedDateKey(new Date(), zone) || localDateKey(new Date());
      if (!(await claimSilenceNotice(userId, persona.id, day))) return null;
      return { parts: [e.message], gapsMs: [] };
    }
    throw e;
  }

  if (parts.length === 0) return null;

  /**
   * The app may have decided that a farewell is due.
   *
   * On the web that opens a card; on a channel there is nowhere to open
   * one, so the suggestion was simply dropped — which meant the one
   * place the user is least surrounded by the rest of the interface was
   * the one place the suggestion never reached.
   *
   * The note is added here, and only here. The channels used to add a
   * second one of their own, so the user received two instructions to
   * type "/毕业" at the end of one message.
   */
  const farewellDue = graduationSuggested || persona.graduationStatus === "suggested";
  if (farewellDue) {
    const last = parts.length - 1;
    parts[last] = `${parts[last]}${copy(params.locale ?? "zh", "channels.graduationNote")}`;
  }

  return { parts, gapsMs: gapsFor(parts, gapsMs) };
}

export { sendChannelParts } from "./send-parts";
export type { ChannelReply } from "./send-parts";
