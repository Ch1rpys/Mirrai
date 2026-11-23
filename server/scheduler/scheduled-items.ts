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
import { isMemorial, mayChatNow } from "@shared/persona-state";
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
