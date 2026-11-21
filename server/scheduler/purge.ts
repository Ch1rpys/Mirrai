/**
 * The daily purge of the recycle bin (C8.11).
 *
 * A persona that has been in the bin for thirty days is hard-deleted,
 * files and all, by `purgeExpiredPersonas`. The scheduler ticks once a
 * minute, so this runs at most once every twenty-four hours — in the
 * process's own memory, which is enough for the single-process app; two
 * copies of the app both purging the same expired persona is harmless,
 * because a purge of a row that is already gone finds nothing.
 */
import { purgeExpiredPersonas } from "../db";

/** The shortest gap between two purges, in milliseconds. */
export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** When the last purge ran, in milliseconds since the epoch. */
let lastPurgeAt: number | null = null;

/**
 * Runs the purge if a day has passed since the last one.
 *
 * `now` is a parameter so the throttle and the age boundary can be
 * tested without waiting: the database call gets the same moment the
 * throttle was decided on.
 */
export async function runDailyPurge(now: Date = new Date()): Promise<number> {
  if (lastPurgeAt !== null && now.getTime() - lastPurgeAt < PURGE_INTERVAL_MS) {
    return 0;
  }
  lastPurgeAt = now.getTime();
  return purgeExpiredPersonas(now);
}

/**
 * Forgets the throttle.
 *
 * Tests share one process, so a purge run in one test would otherwise
 * silence the next one.
 */
export function resetDailyPurgeThrottle(): void {
  lastPurgeAt = null;
}
