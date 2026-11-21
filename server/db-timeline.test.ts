import { describe, expect, it } from "vitest";
import { purgePersona, updatePersona } from "./db";
import { seedXiaoman } from "./test-fixtures/seed-db";
import { buildTimeline, setTurningPointDecision } from "./records/timeline";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("the turning points of a persona", () => {
  it("drops a rejected point on the next run and keeps a confirmed note", async () => {
    const userId = 9_945_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      await updatePersona(personaId, userId, { timezone: "Asia/Shanghai" });
      const first = await buildTimeline({ personaId, userId });
      const changes = first.points.flatMap((point) =>
        point.changes.filter((change) => change.series === "charsMedian").map((change) => ({ point, change })),
      );
      expect(changes.length).toBeGreaterThanOrEqual(2);
      const rejected = changes[0].point.id;
      const kept = changes[1].point.id;

      await setTurningPointDecision({
        personaId,
        userId,
        id: rejected,
        status: "rejected",
      });
      await setTurningPointDecision({
        personaId,
        userId,
        id: kept,
        status: "confirmed",
        note: "那之后话短了",
      });

      const second = await buildTimeline({ personaId, userId });
      expect(second.points.map((point) => point.id)).not.toContain(rejected);
      const confirmed = second.points.find((point) => point.id === kept);
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.note).toBe("那之后话短了");
      // The change itself is still counted from the record.
      expect(confirmed?.changes.length).toBeGreaterThan(0);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 30_000);
});
