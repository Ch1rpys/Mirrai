import { describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  createPersona,
  createUser,
  deletePersona,
  deleteUserAccount,
  getDb,
  insertLlmUsage,
  llmUsageRowsForUser,
} from "./db";
import { llmUsage } from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The usage ledger against a real database (C8.9).
 *
 * The router tests use a mock, so this is where the two rules the
 * handbook names for the data are checked: the rows belong to one user
 * and one persona, and deleting either of them takes the rows with them
 * — the delete-coverage rule is about the tables the schema declares,
 * and this table carries both ids.
 */
describe.skipIf(!DATABASE_URL)("the usage ledger, in the database (C8.9)", () => {
  async function rowCountFor(userId: number): Promise<number> {
    const db = (await getDb())!;
    const [row] = await db.select({ c: count() }).from(llmUsage)
      .where(eq(llmUsage.userId, userId));
    return Number(row?.c ?? 0);
  }

  it("keeps each user's rows apart", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const first = await createUser({ username: `usage-a-${stamp}`, passwordHash: "x", name: "阿树" });
    const second = await createUser({ username: `usage-b-${stamp}`, passwordHash: "x", name: "路人" });
    const personaId = await createPersona({ userId: first, name: "小满", analysisStatus: "ready" });
    try {
      await insertLlmUsage({
        userId: first,
        personaId,
        provider: "OpenAI",
        model: "gpt-4o",
        purpose: "reply",
        promptTokens: 100,
        completionTokens: 20,
        estimated: true,
        costMicros: null,
        jobId: null,
      });
      expect(await rowCountFor(first)).toBe(1);
      expect(await rowCountFor(second)).toBe(0);

      const rows = await llmUsageRowsForUser(first);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.purpose).toBe("reply");
      expect(await llmUsageRowsForUser(second)).toEqual([]);
    } finally {
      await deleteUserAccount(first);
      await deleteUserAccount(second);
    }
  });

  it("goes with the persona when the persona is deleted", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `usage-p-${stamp}`, passwordHash: "x", name: "阿树" });
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    const otherPersonaId = await createPersona({ userId, name: "别人", analysisStatus: "ready" });
    try {
      await insertLlmUsage({
        userId,
        personaId,
        provider: "OpenAI",
        model: "gpt-4o",
        purpose: "distill",
        promptTokens: 10,
        completionTokens: 5,
        estimated: false,
        costMicros: 12_345,
        jobId: "job-1",
      });
      await insertLlmUsage({
        userId,
        personaId: otherPersonaId,
        provider: "OpenAI",
        model: "gpt-4o",
        purpose: "reply",
        promptTokens: 1,
        completionTokens: 1,
        estimated: true,
        costMicros: null,
        jobId: null,
      });
      await deletePersona(personaId, userId);

      const db = (await getDb())!;
      const [left] = await db.select({ c: count() }).from(llmUsage)
        .where(and(eq(llmUsage.userId, userId), eq(llmUsage.personaId, personaId)));
      expect(Number(left?.c ?? 0)).toBe(0);
      // The other persona's row is untouched.
      expect(await rowCountFor(userId)).toBe(1);
    } finally {
      await deleteUserAccount(userId);
    }
  });

  it("goes with the account when the account is deleted", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({ username: `usage-u-${stamp}`, passwordHash: "x", name: "阿树" });
    await insertLlmUsage({
      userId,
      personaId: null,
      provider: "Ollama",
      model: "qwen",
      purpose: "other",
      promptTokens: 3,
      completionTokens: 3,
      estimated: false,
      costMicros: null,
      jobId: null,
    });
    expect(await rowCountFor(userId)).toBe(1);
    await deleteUserAccount(userId);
    expect(await rowCountFor(userId)).toBe(0);
  });
});
