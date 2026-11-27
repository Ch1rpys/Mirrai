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
import { ENV } from "../_core/env";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { isMemorial, mayChatNow, taperStage } from "@shared/persona-state";
import { resolveReplyAt } from "@shared/letters";
import { detectCrisis } from "../safety/crisis";
import { pushToUser } from "../_core/push";
import { withoutEncryptionLocked } from "../encryption/lock";
import { composeCheckInMessage } from "../chat/checkin";
import { isQuietHour } from "./reminders";

/** Why an item was called off, in the words the interface uses. */
export type CancelReason = "asleep" | "sealed" | "closed" | "deleted";

export interface ScheduledSweepResult {
  delivered: number;
  cancelled: number;
}

/**
 * Records that a due item's words are a crisis line (C5.3).
 *
 * The check is asked at creation and again at delivery — the words are
 * the user's own, and the manual asks both. Only the "message" branch
 * had it: a capsule or a letter written around the same time went
 * through without the event that the rest of the app reads.
 */
async function recordDeliveryCrisis(item: {
  userId: number;
  body: string;
}, personaId: number): Promise<boolean> {
  if (!detectCrisis(item.body).crisis) return false;
  await db.createSafetyEvent({
    userId: item.userId,
    personaId,
    type: "crisis",
    severity: "critical",
  }).catch((error: unknown) =>
    console.warn("[Safety] Failed to record the crisis event:", error));
  return true;
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
  /**
   * Capsules and scheduled messages carry the user's own words; an
   * encrypted account with no key in this process waits for the next
   * sign-in (C8.5).
   */
  const due = await withoutEncryptionLocked(
    await db.listDueScheduledItems(now),
    (item) => item.userId,
    "scheduled",
  );
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
    // The user's day, the same clock `sealedGuard` uses (C8.2/C6.2).
    const zone = (user?.timezone ?? "").trim() || "UTC";
    const chat = mayChatNow(persona, now, zone);
    if (!chat.ok) {
      await cancel(chat.reason === "sealed" ? "sealed" : "closed");
      continue;
    }

    /**
      * The reminder the persona agreed to bring up (C9.4).
      *
      * A check-in is not a message the user scheduled to send: it is a
      * question the user asked the persona to ask. So it is cancelled
      * rather than delivered when they have already written — the
      * conversation happened without it. Quiet hours and the memorial
      * mode are respected at the moment of delivery, not only when the
      * tool was called.
      */
    if (item.kind === "check_in") {
      /**
       * A check-in is the persona reaching out, so the states that mean
       * "do not reach out" hold it: `quiet` (the person asked for space)
       * and any taper stage above zero (the relationship is winding
       * down; the first word belongs to the user).
       *
       * It is released rather than cancelled: these states can change,
       * and the reminder was the user's own request.
       */
      if (presence === "quiet" || taperStage(persona) > 0) {
        await db.releaseScheduledItem(item.id, item.userId);
        continue;
      }
      const lastUser = await db.getLastUserMessageAt(persona.id, item.userId);
      const setAt = item.createdAt ? new Date(item.createdAt).getTime() : 0;
      if (lastUser && new Date(lastUser).getTime() >= setAt) {
        await cancel("closed");
        continue;
      }
      if (isMemorial(persona)) {
        await cancel("closed");
        continue;
      }
      if (isQuietHour(now, ENV.reminderQuietHours, zone)) {
        // Do not wake them. The item stays due and the next tick after
        // the quiet hours tries again.
        await db.releaseScheduledItem(item.id, item.userId);
        continue;
      }
      if (detectCrisis(item.body).crisis) {
        await db.createSafetyEvent({
          userId: item.userId,
          personaId: persona.id,
          type: "crisis",
          severity: "critical",
        }).catch((error: unknown) =>
          console.warn("[Safety] Failed to record the crisis event:", error));
        await cancel("closed");
        continue;
      }
      const locale = user?.locale === "en" ? "en" : user?.locale === "zh-Hant" ? "zh-Hant" : "zh";
      let line: string | null = null;
      try {
        line = await composeCheckInMessage({
          persona,
          userId: item.userId,
          reminderText: item.body,
          locale,
          now,
        });
      } catch (error) {
        console.warn("[Scheduler] A check-in could not be written:", error);
        line = null;
      }
      if (!line) {
        await db.releaseScheduledItem(item.id, item.userId);
        continue;
      }
      try {
        await db.createMessage({
          personaId: persona.id,
          userId: item.userId,
          role: "assistant",
          content: line,
          channel: "web",
          metadata: { kind: "check_in", reminderText: item.body },
        });
      } catch (error) {
        console.warn("[Scheduler] A check-in could not be stored:", error);
        await db.releaseScheduledItem(item.id, item.userId);
        continue;
      }
      await db.finishScheduledItem(item.id, item.userId, "delivered", { at: now });
      delivered += 1;
      await pushToUser(item.userId, {
        kind: "reply",
        personaId: persona.id,
        personaName: persona.name,
        text: line,
      }).catch((error: unknown) =>
        console.warn("[Scheduler] The push could not be sent:", error));
      continue;
    }

    if (item.kind === "capsule") {
      // Nothing leaves the app: the body becomes readable in the letter
      // box, and only from the day onwards.
      await recordDeliveryCrisis(item, persona.id);
      await db.finishScheduledItem(item.id, item.userId, "delivered", { at: now });
      delivered += 1;
      continue;
    }

    const locale = user?.locale === "en" ? "en" : "zh";

    if (item.kind === "letter") {
      await recordDeliveryCrisis(item, persona.id);
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
    await recordDeliveryCrisis(item, persona.id);

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
        // The answer arrives when the user is not looking, so the
        // mailbox has to be able to count it (C8.2).
        fromScheduledMessage: true,
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
