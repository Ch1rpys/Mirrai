import { describe, expect, it } from "vitest";
import {
  createPersona,
  purgePersona,
  getRecordReportCache,
  saveRecordReportCache,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("the report cache", () => {
  it("keeps one row per persona and updates it in place", async () => {
    const userId = 9_990_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "report" });
    try {
      expect(await getRecordReportCache(personaId, userId)).toBeNull();
      await saveRecordReportCache({
        userId,
        personaId,
        recordsVersion: "10:10",
        report: { totals: { me: 1, them: 2 } },
      });
      const first = await getRecordReportCache(personaId, userId);
      expect(first?.recordsVersion).toBe("10:10");
      await saveRecordReportCache({
        userId,
        personaId,
        recordsVersion: "12:12",
        report: { totals: { me: 2, them: 3 } },
      });
      const second = await getRecordReportCache(personaId, userId);
      expect(second?.recordsVersion).toBe("12:12");
      expect((second?.report as { totals: { me: number } }).totals.me).toBe(2);
      // Somebody else cannot read it.
      expect(await getRecordReportCache(personaId, userId + 1)).toBeNull();
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("drops the cache with the persona", async () => {
    const userId = 9_991_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "report-delete" });
    await saveRecordReportCache({
      userId,
      personaId,
      recordsVersion: "1:1",
      report: {},
    });
    await purgePersona(personaId, userId);
    expect(await getRecordReportCache(personaId, userId)).toBeNull();
  });
});
