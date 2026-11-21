import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The daily purge of the recycle bin (C8.11).
 *
 * The purge is behind a twenty-four-hour throttle in the scheduler's own
 * memory: the tick runs once a minute, and hard-deleting every persona in
 * the bin every minute would be a query a minute for nothing.
 */

const purgeExpiredPersonas = vi.fn();

vi.mock("../db", () => ({
  purgeExpiredPersonas: (...a: unknown[]) => purgeExpiredPersonas(...a),
}));

import { PURGE_INTERVAL_MS, resetDailyPurgeThrottle, runDailyPurge } from "./purge";

const DAY = 24 * 60 * 60 * 1000;

describe("the daily purge", () => {
  beforeEach(() => {
    purgeExpiredPersonas.mockReset();
    purgeExpiredPersonas.mockResolvedValue(0);
    resetDailyPurgeThrottle();
  });

  it("purges on the first tick", async () => {
    const now = new Date("2026-03-01T03:00:00.000Z");
    await runDailyPurge(now);
    expect(purgeExpiredPersonas).toHaveBeenCalledTimes(1);
    // The moment is passed down, so the age is decided from one clock.
    expect(purgeExpiredPersonas).toHaveBeenCalledWith(now);
  });

  it("does not purge again within the same day", async () => {
    const first = new Date("2026-03-01T03:00:00.000Z");
    await runDailyPurge(first);
    await runDailyPurge(new Date(first.getTime() + PURGE_INTERVAL_MS - 1));
    expect(purgeExpiredPersonas).toHaveBeenCalledTimes(1);
  });

  it("purges again once a day has passed", async () => {
    const first = new Date("2026-03-01T03:00:00.000Z");
    await runDailyPurge(first);
    await runDailyPurge(new Date(first.getTime() + PURGE_INTERVAL_MS));
    expect(purgeExpiredPersonas).toHaveBeenCalledTimes(2);
  });

  it("returns how many were purged", async () => {
    purgeExpiredPersonas.mockResolvedValue(3);
    expect(await runDailyPurge(new Date("2026-03-01T03:00:00.000Z"))).toBe(3);
  });

  it("does not count a failed purge as done-and-gone for ever", async () => {
    /**
     * The throttle is set before the work, so a database that is down
     * does not make the sweep retry every minute — but it also must not
     * claim a persona was purged. The next day tries again.
     */
    purgeExpiredPersonas.mockRejectedValueOnce(new Error("database is down"));
    await expect(runDailyPurge(new Date("2026-03-01T03:00:00.000Z"))).rejects.toThrow(
      "database is down",
    );
    purgeExpiredPersonas.mockResolvedValue(0);
    await runDailyPurge(new Date("2026-03-03T03:00:00.000Z"));
    expect(purgeExpiredPersonas).toHaveBeenCalledTimes(2);
  });

  it("keeps the interval at one day", () => {
    expect(PURGE_INTERVAL_MS).toBe(DAY);
  });
});
