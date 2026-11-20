/**
 * "How are you after that?" (C4.2)
 *
 * The app asked how the persona felt and never how the person did. This
 * asks, once per session, in four words — and then gets out of the way:
 * no popup, no push, no red dot, and one question a day at most.
 *
 * The conditions are deliberately conservative. A question about how a
 * conversation left someone is only welcome when the conversation is
 * clearly over and the person is not still in it.
 */
import * as db from "../db";
import { zonedDayStart } from "@shared/timezone";

/** What the four buttons mean. */
export const CHECKIN_ANSWERS = ["better", "same", "worse", "skipped"] as const;
export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];

export const CHECKIN_MIN_USER_MESSAGES = 6;
export const CHECKIN_MIN_IDLE_MS = 10 * 60 * 1000;
export const CHECKIN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Are the last three answers that count all "worse"?
 *
 * "skipped" is not an answer about the conversation, so it is dropped
 * before the streak is counted. A "better" after two "worse" breaks the
 * streak — the rule is about three in a row, not three in total.
 */
export function isWorseStreak(answers: string[], needed = 3): boolean {
  const valid = answers.filter((answer) => answer !== "skipped");
  return valid.length >= needed && valid.slice(0, needed).every((answer) => answer === "worse");
}

/**
 * The session that should be asked about, if any.
 *
 * Conditions, all required:
 *   - there is a session, and the user said at least six things in it;
 *   - it has been quiet for ten minutes, and ended within two days;
 *   - this session has not been answered;
 *   - the user has not been asked today, in their own calendar.
 */
export async function pendingCheckin(params: {
  userId: number;
  personaId: number;
  now: Date;
}): Promise<{ sessionStartAt: Date } | null> {
  const sessionStartAt = await db.getSessionStartAt(params.personaId, params.userId);
  if (!sessionStartAt) return null;
  const lastAt = await db.getLastMessageAt(params.personaId, params.userId);
  if (!lastAt) return null;

  const quietMs = params.now.getTime() - lastAt.getTime();
  if (quietMs < CHECKIN_MIN_IDLE_MS) return null;
  if (quietMs > CHECKIN_MAX_AGE_MS) return null;
  if (params.now.getTime() - sessionStartAt.getTime() > CHECKIN_MAX_AGE_MS) return null;

  const said = await db.countUserMessagesSince(params.personaId, params.userId, sessionStartAt);
  if (said < CHECKIN_MIN_USER_MESSAGES) return null;

  if (await db.getSessionCheckin(params.userId, params.personaId, sessionStartAt)) return null;

  const timezone = await db.getUserTimezone(params.userId);
  const askedToday = await db.countCheckinsSince(
    params.userId,
    zonedDayStart(params.now, timezone),
  );
  if (askedToday > 0) return null;

  return { sessionStartAt };
}

/**
 * Has the user just had three conversations in a row that left them
 * worse?
 *
 * The suggestion is made once per group of three. The record of having
 * made it is a safety event with a fixed excerpt, so a second visit does
 * not repeat the card and does not fill the transparency panel with
 * copies of the same sentence.
 */
export async function worseSuggestion(params: {
  userId: number;
  personaId: number;
  now: Date;
}): Promise<boolean> {
  const answers = await db.getRecentCheckinAnswers(params.userId, params.personaId, 20);
  if (!isWorseStreak(answers.map((row) => row.answer))) return false;
  const events = await db.getSafetyEvents(params.userId, 50);
  const already = events.some((event) =>
    event.type === "usage" &&
    event.personaId === params.personaId &&
    event.excerpt === "checkins:worse×3" &&
    event.createdAt.getTime() >= params.now.getTime() - 14 * 24 * 60 * 60 * 1000,
  );
  return !already;
}

/** The number of consecutive "worse" answers, for the graduation veto. */
export async function worseStreakFor(userId: number, personaId: number): Promise<number> {
  const answers = await db.getRecentCheckinAnswers(userId, personaId, 20);
  return isWorseStreak(answers.map((row) => row.answer)) ? 3 : 0;
}

/** Records that the card was shown. Idempotent within the same visit. */
export async function recordWorseSuggestion(params: {
  userId: number;
  personaId: number;
}): Promise<boolean> {
  const already = (await db.getSafetyEvents(params.userId, 50)).some((event) =>
    event.type === "usage" &&
    event.personaId === params.personaId &&
    event.excerpt === "checkins:worse×3" &&
    event.createdAt.getTime() >= Date.now() - 14 * 24 * 60 * 60 * 1000,
  );
  if (already) return false;
  await db.createSafetyEvent({
    userId: params.userId,
    personaId: params.personaId,
    type: "usage",
    severity: "info",
    excerpt: "checkins:worse×3",
  });
  return true;
}
