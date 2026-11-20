/**
 * Delivering what the user scheduled for a later day (C5.3).
 *
 * A capsule opens in the letter box, a message enters the conversation
 * as the user's own line, and a letter becomes a letter. The sweep runs
 * from the scheduler's tick, one claim per row, so two copies of the app
 * — or two ticks that overlap — do not deliver the same thing twice.
 */
import * as db from "../db";
import { getEffectivePresence } from "../_core/graduation";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { mayChatNow } from "@shared/persona-state";
import { preferredClockZone } from "@shared/timezone";
import { resolveReplyAt } from "@shared/letters";
import { detectCrisis } from "../safety/crisis";
import { pushToUser } from "../_core/push";

/** Why an item was called off, in the words the interface uses. */
export type CancelReason = "asleep" | "sealed" | "closed" | "deleted";

export interface ScheduledSweepResult {
  delivered: number;
  cancelled: number;
}

/**
 * Delivers every item whose day has come.
 *
 * `now` is a parameter so the tests can move the clock; the scheduler
 * passes the real one.
 */
export async function sweepScheduledItems(
  now: Date = new Date(),
): Promise<ScheduledSweepResult> {
  const due = await db.listDueScheduledItems(now);
  let delivered = 0;
  let cancelled = 0;

  for (const item of due) {
    if (!(await db.claimScheduledItem(item.id, item.userId))) continue;

    const cancel = async (reason: CancelReason) => {
      await db.finishScheduledItem(item.id, item.userId, "cancelled", { reason });
      cancelled += 1;
    };

    const persona = await db.getPersonaById(item.personaId, item.userId);
    if (!persona) {
      await cancel("deleted");
      continue;
    }

    const settings = normalizePersonaSettings(persona.settings);
    const presence = getEffectivePresence({
      personaPresence: persona.presence,
      graduationStatus: persona.graduationStatus,
    });
    if (presence === "asleep") {
      await cancel("asleep");
      continue;
    }
    const user = await db.getUserById(item.userId).catch(() => null);
    const zone = preferredClockZone(
      (persona as { timezone?: string | null }).timezone,
      user?.timezone,
    );
    const chat = mayChatNow(persona, now, zone || "UTC");
    if (!chat.ok) {
      await cancel(chat.reason === "sealed" ? "sealed" : "closed");
      continue;
    }

    if (item.kind === "capsule") {
      // Nothing leaves the app: the body becomes readable in the letter
      // box, and only from the day onwards.
      await db.finishScheduledItem(item.id, item.userId, "delivered", { at: now });
      delivered += 1;
      continue;
    }

    const locale = user?.locale === "en" ? "en" : "zh";

    if (item.kind === "letter") {
      try {
        const replyAt = resolveReplyAt({ now });
        await db.createLetterWithMessage(
          {
            userId: item.userId,
            personaId: persona.id,
            body: item.body,
            kind: "letter",
            mood: null,
            status: "waiting",
            replyAt,
          },
          {
            personaId: persona.id,
            userId: item.userId,
            content: item.body,
            channel: "web",
            origin: "scheduled",
          },
        );
      } catch (error) {
        console.warn("[Scheduler] A scheduled letter could not be delivered:", error);
        await db.releaseScheduledItem(item.id, item.userId);
        continue;
      }
      await db.finishScheduledItem(item.id, item.userId, "delivered", { at: now });
      delivered += 1;
      continue;
    }

    if (item.kind !== "message") {
      // An unknown kind is not going to become known.
      await db.finishScheduledItem(item.id, item.userId, "cancelled", { reason: "closed" });
      cancelled += 1;
      continue;
    }

    // The line was written earlier; the app reads it once more before it
    // goes in, the same way it reads a letter at the moment of writing.
    const crisis = detectCrisis(item.body);
    if (crisis.crisis) {
      await db.createSafetyEvent({
        userId: item.userId,
        personaId: persona.id,
        type: "crisis",
        severity: "critical",
      }).catch((error: unknown) =>
        console.warn("[Safety] Failed to record the crisis event:", error));
    }

    let text = "";
    let failed = false;
    try {
      const { runConversation } = await import("../chat/service");
      for await (const event of runConversation({
        persona,
        userId: item.userId,
        message: item.body,
        mode: "once",
        channel: "web",
        locale,
        now,
        periodId: null,
      })) {
        if (event.type === "delta") {
          text += event.text;
        } else if (event.type === "burst") {
          text = event.texts.filter((line) => line.length > 0).join("\n\n");
        } else if (event.type === "silence") {
          text = event.notice;
        } else if (event.type === "replace") {
          text = event.text;
        } else if (event.type === "error") {
          failed = true;
        }
      }
    } catch (error) {
      console.warn("[Scheduler] A scheduled message could not be delivered:", error);
      failed = true;
    }
    if (failed) {
      await db.releaseScheduledItem(item.id, item.userId);
      continue;
    }

    await db.finishScheduledItem(item.id, item.userId, "delivered", { at: now });
    delivered += 1;
    if (text) {
      await pushToUser(item.userId, {
        kind: "reply",
        personaId: persona.id,
        personaName: persona.name,
        text,
      }).catch((error: unknown) =>
        console.warn("[Scheduler] The push could not be sent:", error));
    }
  }

  return { delivered, cancelled };
}
