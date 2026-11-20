import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createCollectedMessages,
  createPersona,
  deletePersona,
  getDb,
  searchRecordsLexical,
} from "./db";
import { backfillSearchTokens } from "./records/backfill-tokens";
import { seedXiaoman } from "./test-fixtures/seed-db";

const DATABASE_URL = process.env.DATABASE_URL;

async function makePersona(): Promise<{ userId: number; personaId: number }> {
  const userId = 9_930_000 + Math.floor(Math.random() * 10_000);
  const personaId = await createPersona({ userId, name: "search" });
  return { userId, personaId };
}

function row(
  userId: number,
  personaId: number,
  content: string,
  role: "user" | "assistant" = "assistant",
) {
  return {
    userId,
    personaId,
    source: "generic",
    role,
    content,
    timestamp: new Date("2022-03-01T12:00:00.000Z"),
    kind: "text",
    speaker: role === "user" ? "阿树" : "小满",
  };
}

describe.skipIf(!DATABASE_URL)("search over the record table", () => {
  it("finds a phrase together, not the words apart", async () => {
    const { userId, personaId } = await makePersona();
    try {
      await createCollectedMessages([
        row(userId, personaId, "我也喜欢海边的风"),
        row(userId, personaId, "喜欢和朋友一起，海是后来才喜欢的"),
        row(userId, personaId, "今天吃了面"),
      ]);
      const together = await searchRecordsLexical(personaId, userId, { q: "喜欢海" });
      expect(together.map((hit) => hit.content)).toEqual(["我也喜欢海边的风"]);
      const loose = await searchRecordsLexical(personaId, userId, { q: "喜欢" });
      expect(loose).toHaveLength(2);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("does not fail or inject on punctuation the tokenizer drops", async () => {
    const { userId, personaId } = await makePersona();
    try {
      await createCollectedMessages([row(userId, personaId, "在吗")]);
      for (const q of ["'", "\\", "&", "|", ":*", "'; drop table collected_messages; --"]) {
        await expect(
          searchRecordsLexical(personaId, userId, { q }),
        ).resolves.toEqual([]);
      }
      // The table is still there.
      await expect(
        searchRecordsLexical(personaId, userId, { q: "在吗" }),
      ).resolves.toHaveLength(1);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("backfills missing tokens without changing the answer", async () => {
    const { userId, personaId } = await makePersona();
    try {
      const rows = Array.from({ length: 100 }, (_, index) => ({
        ...row(
          userId,
          personaId,
          index < 5 ? `周末看电影 ${index}` : `第 ${index} 条普通记录`,
        ),
        source: `backfill-${index}`,
      }));
      await createCollectedMessages(rows);
      const db = await getDb();
      await db!.execute(sql`
        UPDATE "collected_messages" SET "searchTokens" = NULL
        WHERE "personaId" = ${personaId} AND "userId" = ${userId}
      `);
      const missingForPersona = async () => {
        const result = await db!.execute(sql`
          SELECT count(*)::int AS c FROM "collected_messages"
          WHERE "personaId" = ${personaId} AND "userId" = ${userId}
            AND "searchTokens" IS NULL
        `);
        return Number((result.rows[0] as { c: number }).c);
      };
      expect(await missingForPersona()).toBe(100);
      const before = await searchRecordsLexical(personaId, userId, { q: "周末看电影" });
      expect(before).toHaveLength(5);
      const filled = await backfillSearchTokens({ batchSize: 25 });
      expect(filled.records).toBeGreaterThanOrEqual(100);
      expect(await missingForPersona()).toBe(0);
      const after = await searchRecordsLexical(personaId, userId, { q: "周末看电影" });
      expect(after.map((hit) => hit.id)).toEqual(before.map((hit) => hit.id));
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("keeps both GIN indexes after a schema push", async () => {
    const db = await getDb();
    const indexes = await db!.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN (
        'collected_messages_search_tokens_idx',
        'messages_search_tokens_idx'
      )
    `);
    const names = (indexes.rows as Array<{ indexname: string }>).map((r) => r.indexname).sort();
    expect(names).toEqual([
      "collected_messages_search_tokens_idx",
      "messages_search_tokens_idx",
    ]);
  });
});


describe.skipIf(!DATABASE_URL)("search over the Xiaoman fixture", () => {
  it("finds the four lines where they said they liked the sea", async () => {
    const userId = 9_930_500 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const theirs = await searchRecordsLexical(personaId, userId, {
        q: "海",
        role: "assistant",
      });
      expect(theirs).toHaveLength(4);
      expect(theirs.every((hit) => hit.content === "喜欢海")).toBe(true);
      expect(theirs.every((hit) => hit.timestamp != null)).toBe(true);

      const mine = await searchRecordsLexical(personaId, userId, {
        q: "海",
        role: "user",
      });
      expect(mine).toEqual([]);

      // The two-character query still uses the index and finds the same
      // four lines.
      const phrase = await searchRecordsLexical(personaId, userId, {
        q: "喜欢海",
        role: "assistant",
      });
      expect(phrase.map((hit) => hit.id).sort()).toEqual(
        theirs.map((hit) => hit.id).sort(),
      );

      // A time range narrows it, and a page offset pages it.
      const firstAt = theirs[0].timestamp!;
      const narrowed = await searchRecordsLexical(personaId, userId, {
        q: "喜欢海",
        role: "assistant",
        from: new Date(firstAt.getTime() - 1000),
        to: new Date(firstAt.getTime() + 1000),
      });
      expect(narrowed.length).toBeGreaterThanOrEqual(1);
      expect(narrowed.length).toBeLessThanOrEqual(4);
      const secondPage = await searchRecordsLexical(personaId, userId, {
        q: "喜欢海",
        role: "assistant",
        limit: 2,
        offset: 2,
      });
      expect(secondPage).toHaveLength(2);
      expect(secondPage.map((hit) => hit.id)).not.toEqual(
        phrase.slice(0, 2).map((hit) => hit.id),
      );
    } finally {
      await deletePersona(personaId, userId);
    }
  });
});
