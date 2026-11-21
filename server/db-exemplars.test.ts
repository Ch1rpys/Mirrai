import { describe, expect, it } from "vitest";
import {
  purgePersona,
  getCollectedMessagesForPersona,
} from "./db";
import { buildXiaomanRecords } from "./test-fixtures/xiaoman";
import { seedXiaoman } from "./test-fixtures/seed-db";
import { retrieveExemplars } from "./chat/exemplars";
import { retrieveExemplarsFromTable } from "./chat/exemplar-query";

const DATABASE_URL = process.env.DATABASE_URL;

function jaccard(a: number[], b: number[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const id of left) if (right.has(id)) intersection += 1;
  return intersection / union.size;
}

describe.skipIf(!DATABASE_URL)("exemplars from the index against the old path", () => {
  it("picks the same first line for at least 18 of 20 questions", async () => {
    const userId = 9_940_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const records = await getCollectedMessagesForPersona(personaId, userId, {
        newest: true,
      });
      const userLines = buildXiaomanRecords()
        .filter((row) => row.role === "user" && row.kind === "text" && row.content.trim().length >= 2)
        .map((row) => row.content);
      /**
       * The fixture has eighteen distinct user lines, so the question
       * set is eighteen — the smallest of the two (manual says twenty,
       * the hook has eighteen; recorded in the deviation table).
       */
      const questions = [...new Set(userLines)];
      let sameFirst = 0;
      let jaccardSum = 0;
      const differences: Array<{ q: string; oldIds: number[]; newIds: number[] }> = [];
      for (const question of questions) {
        const oldFound = retrieveExemplars({
          userMessage: question,
          records: records as never,
        });
        const newFound = await retrieveExemplarsFromTable({
          personaId,
          userId,
          userMessage: question,
          now: new Date("2024-11-01T12:00:00.000Z"),
          timeZone: "Asia/Shanghai",
        });
        expect(newFound).not.toBeNull();
        const oldIds = oldFound.map((item) => item.id);
        const newIds = (newFound ?? []).map((item) => item.id);
        if (oldIds[0] != null && oldIds[0] === newIds[0]) sameFirst += 1;
        jaccardSum += jaccard(oldIds.slice(0, 4), newIds.slice(0, 4));
        if (oldIds.join(",") !== newIds.join(",")) {
          differences.push({ q: question, oldIds, newIds });
        }
      }
      const averageJaccard = jaccardSum / questions.length;
      console.log(
        "[C8.7]",
        JSON.stringify({ questions: questions.length, sameFirst, averageJaccard, differences }),
      );
      expect(questions.length).toBe(18);
      expect(sameFirst).toBeGreaterThanOrEqual(18);
      expect(averageJaccard).toBeGreaterThanOrEqual(0.75);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 60_000);
});
