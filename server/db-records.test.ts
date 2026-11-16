import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  countRecords,
  createCollectedMessages,
  createPersona,
  deletePersona,
  deleteRecordsByFile,
  getRecordsAround,
  getRecordSourceSummary,
  iterateRecords,
} from "./db";
import { importRecords } from "./collectors/db-store";
import { buildXiaomanRecords } from "./test-fixtures/xiaoman";
import { seedXiaoman } from "./test-fixtures/seed-db";

const DATABASE_URL = process.env.DATABASE_URL;

function hashKey(key: string): string {
  return createHash("md5").update(key).digest("hex");
}

describe.skipIf(!DATABASE_URL)("the record table", () => {
  it("pages the Xiaoman fixture in time order, and counts the same number", async () => {
    const userId = 9_910_000 + Math.floor(Math.random() * 10_000);
    const expected = buildXiaomanRecords().filter(
      (row) => row.role === "user" || row.role === "assistant",
    ).length;
    const { personaId, count } = await seedXiaoman(null, { userId });
    try {
      expect(count).toBe(expected);
      expect(await countRecords(personaId, userId)).toBe(expected);

      const paged: Array<{ timestamp: Date | null }> = [];
      for await (const row of iterateRecords(personaId, userId, { pageSize: 500 })) {
        paged.push({ timestamp: row.timestamp });
      }
      expect(paged).toHaveLength(expected);
      for (let i = 1; i < paged.length; i++) {
        const previous = (paged[i - 1].timestamp ?? new Date(0)).getTime();
        const next = (paged[i].timestamp ?? new Date(0)).getTime();
        expect(next).toBeGreaterThanOrEqual(previous);
      }
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("stores two identical lines said in the same second", async () => {
    const userId = 9_920_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "same-second" });
    try {
      const at = new Date("2022-03-01T12:00:00.000Z");
      const content = "嗯";
      const rows = [0, 1].map((n) => {
        const base = `generic|${at.toISOString()}|${content}`;
        const key = n === 0 ? base : `${base}|#${n}`;
        return {
          userId,
          personaId,
          source: "generic",
          role: "assistant" as const,
          content,
          timestamp: at,
          kind: "text",
          speaker: "小满",
          idempotencyKey: hashKey(key),
        };
      });
      expect(await createCollectedMessages(rows)).toBe(2);
      const matches: number[] = [];
      for await (const row of iterateRecords(personaId, userId)) {
        if (row.content === content && row.timestamp?.getTime() === at.getTime()) {
          matches.push(row.id);
        }
      }
      expect(matches).toHaveLength(2);
      const around = await getRecordsAround(matches[0], userId, 0, 1);
      expect(around.target?.id).toBe(matches[0]);
      expect(around.after.map((row) => row.id)).toEqual([matches[1]]);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("does not count a public-register row unless asked", async () => {
    const userId = 9_930_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "register" });
    try {
      const written = await createCollectedMessages([
        {
          userId,
          personaId,
          source: "generic",
          role: "assistant",
          content: "private line",
          timestamp: new Date("2022-08-01T12:00:00.000Z"),
          kind: "text",
          speaker: "小满",
          idempotencyKey: hashKey(`generic|private|${userId}`),
        },
        {
          userId,
          personaId,
          source: "generic",
          role: "assistant",
          content: "public line",
          timestamp: new Date("2022-08-01T12:01:00.000Z"),
          kind: "text",
          speaker: "小满",
          meta: { register: "public" },
          idempotencyKey: hashKey(`generic|public|${userId}`),
        },
      ]);
      expect(written).toBe(2);
      expect(await countRecords(personaId, userId)).toBe(1);
      expect(await countRecords(personaId, userId, { register: "public" })).toBe(1);
      expect(await countRecords(personaId, userId, { register: "all" })).toBe(2);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("summarises sources and deletes one file's rows without touching the rest", async () => {
    const userId = 9_940_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "sources" });
    try {
      const at = new Date("2022-09-01T12:00:00.000Z");
      await createCollectedMessages([
        {
          userId,
          personaId,
          source: "generic",
          role: "assistant",
          content: "kept",
          timestamp: at,
          kind: "text",
          speaker: "小满",
          fileId: 7,
          idempotencyKey: hashKey(`generic|${at.toISOString()}|kept`),
        },
        {
          userId,
          personaId,
          source: "wechat_export",
          role: "assistant",
          content: "from-file",
          timestamp: at,
          kind: "text",
          speaker: "小满",
          fileId: 42,
          lineNo: 1,
          idempotencyKey: hashKey(`wechat_export|${at.toISOString()}|from-file`),
        },
      ]);
      const summary = await getRecordSourceSummary(personaId, userId);
      expect(summary.some((row) => row.source === "generic" && row.fileId === 7 && row.count === 1)).toBe(true);
      expect(summary.some((row) => row.source === "wechat_export" && row.fileId === 42 && row.count === 1)).toBe(true);
      expect(await deleteRecordsByFile(personaId, userId, 42)).toBe(1);
      expect(await countRecords(personaId, userId)).toBe(1);
      const after = await getRecordSourceSummary(personaId, userId);
      expect(after.some((row) => row.source === "wechat_export")).toBe(false);
    } finally {
      await deletePersona(personaId, userId);
    }
  });

  it("writes nothing when the same fixture is imported again", async () => {
    const userId = 9_950_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const records = buildXiaomanRecords()
        .filter((row) => row.role === "user" || row.role === "assistant")
        .map((row) => ({
          speaker: row.speaker,
          content: row.content,
          timestamp: row.timestamp,
          kind: row.kind,
          lineNo: row.id,
          meta: row.meta,
          role: row.role,
        }));
      expect(
        await importRecords({
          personaId,
          userId,
          source: "generic",
          records,
        }),
      ).toBe(0);
    } finally {
      await deletePersona(personaId, userId);
    }
  });
});
