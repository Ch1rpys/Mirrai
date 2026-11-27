import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  countRecords,
  countFidelityPairs,
  createCollectedMessages,
  createFidelityPair,
  listFidelityPairs,
  createLetter,
  createPersona,
  createUser,
  deleteUserAccount,
  createPersonaFile,
  purgePersona,
  deletePersonaFile,
  deleteRecordsByFile,
  getCollectedMessagesForPersona,
  getPersonaStyleProfile,
  getRecordsAround,
  getRecordSourceSummary,
  getWaitingNotes,
  iterateRecords,
  setLetterDone,
} from "./db";
import { importRecords } from "./collectors/db-store";
import { measureStyleProfile } from "./_core/style-profile";
import { clearRerankModelCache, getRerankModel } from "./chat/rerank-model";
import { buildXiaomanRecords } from "./test-fixtures/xiaoman";
import { seedXiaoman } from "./test-fixtures/seed-db";

const DATABASE_URL = process.env.DATABASE_URL;

function hashKey(key: string): string {
  return createHash("md5").update(key).digest("hex");
}

describe.skipIf(!DATABASE_URL)("the chosen/rejected pairs (B8.8)", () => {
  it("stores a pair with its features and keeps it to its owner and persona", async () => {
    // The progress row used to rest on a mock: nothing inserted a row
    // into `fidelity_pairs` against a real database, so a column that
    // did not exist would not have failed.
    const userId = 9_909_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "pairs" });
    try {
      const pair = await createFidelityPair({
        userId,
        personaId,
        messageId: 41,
        chosenText: "我还是想听听你的声音",
        rejectedText: "随便吧",
        features: { overlap: 0.4, style: 0.2 },
      });
      expect(pair?.id).toBeGreaterThan(0);
      expect(pair?.features).toEqual({ overlap: 0.4, style: 0.2 });

      expect(await countFidelityPairs(personaId, userId)).toBe(1);
      expect(await listFidelityPairs(personaId, userId)).toHaveLength(1);
      // Another account does not see it.
      expect(await listFidelityPairs(personaId, userId + 1)).toHaveLength(0);
      expect(await countFidelityPairs(personaId, userId + 1)).toBe(0);
    } finally {
      await purgePersona(personaId, userId);
    }
  });
});

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
      await purgePersona(personaId, userId);
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
      await purgePersona(personaId, userId);
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

      const read = async (register?: string) => {
        const out: string[] = [];
        for await (const row of iterateRecords(personaId, userId, { register })) {
          out.push(row.content);
        }
        return out;
      };
      expect(await read()).toEqual(["private line"]);
      expect(await read("public")).toEqual(["public line"]);
      expect((await read("all")).sort()).toEqual(["private line", "public line"]);

      const readCollected = async (register?: "private" | "public" | "all") =>
        (await getCollectedMessagesForPersona(personaId, userId, { register, newest: true }))
          .map((row) => row.content);
      expect(await readCollected()).toEqual(["private line"]);
      expect(await readCollected("public")).toEqual(["public line"]);
      expect((await readCollected("all")).sort()).toEqual(["private line", "public line"]);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("does not build the rerank n-gram model from public posts", async () => {
    const userId = 9_935_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "rerank-register" });
    clearRerankModelCache();
    try {
      const rows = [
        ...Array.from({ length: 40 }, (_, i) => ({
          userId,
          personaId,
          source: "generic",
          role: "assistant" as const,
          content: `private line ${i}`,
          timestamp: new Date(2022, 0, 1, 12, 0, i),
          kind: "text",
          speaker: "小满",
          idempotencyKey: hashKey(`generic|rerank-private|${userId}|${i}`),
        })),
        ...Array.from({ length: 60 }, (_, i) => ({
          userId,
          personaId,
          source: "moments",
          role: "assistant" as const,
          content: `public post ${i}`,
          timestamp: new Date(2022, 1, 1, 12, 0, i),
          kind: "text",
          speaker: "小满",
          meta: { register: "public" },
          idempotencyKey: hashKey(`generic|rerank-public|${userId}|${i}`),
        })),
      ];
      expect(await createCollectedMessages(rows)).toBe(100);

      const model = await getRerankModel(personaId, userId);
      expect(model).not.toBeNull();
      expect(model!.texts).toHaveLength(40);
      expect(model!.texts.every((text) => text.startsWith("private line "))).toBe(true);
    } finally {
      clearRerankModelCache();
      await purgePersona(personaId, userId);
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
      await purgePersona(personaId, userId);
    }
  });

  it("deleting one file leaves the other file's rows", async () => {
    const userId = 9_980_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "two-files" });
    try {
      const fileA = await createPersonaFile({
        personaId,
        userId,
        fileType: "chat_txt",
        originalName: "a.txt",
        fileKey: `personas/${userId}/${personaId}/a.txt`,
        fileUrl: `/uploads/personas/${userId}/${personaId}/a.txt`,
        fileSize: 12,
      });
      const fileB = await createPersonaFile({
        personaId,
        userId,
        fileType: "chat_txt",
        originalName: "b.txt",
        fileKey: `personas/${userId}/${personaId}/b.txt`,
        fileUrl: `/uploads/personas/${userId}/${personaId}/b.txt`,
        fileSize: 12,
      });
      const asRecords = (
        rows: Array<{ at: string; content: string }>,
        role: "user" | "assistant",
      ) =>
        rows.map((row, index) => ({
          speaker: role === "user" ? "阿树" : "小满",
          content: row.content,
          timestamp: new Date(row.at),
          kind: "text" as const,
          lineNo: index + 1,
          role,
        }));
      expect(
        await importRecords({
          personaId,
          userId,
          source: "wechat_export",
          fileId: fileA,
          records: asRecords(
            [
              { at: "2022-03-01T12:00:00.000Z", content: "a1" },
              { at: "2022-03-01T12:01:00.000Z", content: "a2" },
              { at: "2022-03-01T12:02:00.000Z", content: "a3" },
            ],
            "assistant",
          ),
        }),
      ).toBe(3);
      expect(
        await importRecords({
          personaId,
          userId,
          source: "sms",
          fileId: fileB,
          records: asRecords(
            [
              { at: "2022-03-01T12:03:00.000Z", content: "b1" },
              { at: "2022-03-01T12:04:00.000Z", content: "b2" },
            ],
            "user",
          ),
        }),
      ).toBe(2);
      const removed = await deletePersonaFile(fileA, userId);
      expect(removed?.deletedRecords).toBe(3);
      expect(await countRecords(personaId, userId)).toBe(2);
      const summary = await getRecordSourceSummary(personaId, userId);
      expect(summary.some((row) => row.fileId === fileA)).toBe(false);
      expect(summary.some((row) => row.fileId === fileB && row.count === 2)).toBe(true);
    } finally {
      await purgePersona(personaId, userId);
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
      await purgePersona(personaId, userId);
    }
  });

  it("writes only the new tail when the same platform is imported again", async () => {
    const userId = 9_970_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "incremental" });
    try {
      const all = buildXiaomanRecords()
        .filter((row) => row.role === "user" || row.role === "assistant")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id);
      const cut = Math.floor(all.length * 0.8);
      const asRecords = (rows: typeof all) =>
        rows.map((row) => ({
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
          source: "wechat_export",
          records: asRecords(all.slice(0, cut)),
        }),
      ).toBe(cut);
      const afterFirst = await measureStyleProfile({
        personaId,
        userId,
        now: new Date("2026-01-01T00:00:00.000Z"),
      });
      expect(afterFirst.recordsVersion).toMatch(/^\d+:\d+$/);
      expect(
        await importRecords({
          personaId,
          userId,
          source: "wechat_export",
          records: asRecords(all),
        }),
      ).toBe(all.length - cut);
      const afterSecond = await measureStyleProfile({
        personaId,
        userId,
        now: new Date("2026-02-01T00:00:00.000Z"),
      });
      expect(afterSecond.recordsVersion).not.toBe(afterFirst.recordsVersion);
      expect(afterSecond.measuredAt).toBe("2026-02-01T00:00:00.000Z");
      expect(
        await importRecords({
          personaId,
          userId,
          source: "wechat_export",
          records: asRecords(all),
        }),
      ).toBe(0);
      const afterThird = await measureStyleProfile({
        personaId,
        userId,
        now: new Date("2026-03-01T00:00:00.000Z"),
      });
      expect(afterThird.recordsVersion).toBe(afterSecond.recordsVersion);
      expect(afterThird.measuredAt).toBe(afterSecond.measuredAt);
      expect(await getPersonaStyleProfile(personaId, userId)).toEqual(afterSecond);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 60_000);

  it("interleaves two sources by time and keeps the same sentence from both", async () => {
    const userId = 9_960_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "two-sources" });
    try {
      const wechat = [
        { at: "2022-03-01T12:00:00.000Z", content: "在吗" },
        { at: "2022-03-01T12:02:00.000Z", content: "好" },
        { at: "2022-03-01T12:04:00.000Z", content: "嗯" },
      ];
      const sms = [
        { at: "2022-03-01T12:01:00.000Z", content: "在吗" },
        { at: "2022-03-01T12:03:00.000Z", content: "好" },
        { at: "2022-03-01T12:04:00.000Z", content: "嗯" },
      ];
      const asRecords = (
        rows: Array<{ at: string; content: string }>,
        speaker: string,
        role: "user" | "assistant",
      ) =>
        rows.map((row, index) => ({
          speaker,
          content: row.content,
          timestamp: new Date(row.at),
          kind: "text" as const,
          lineNo: index + 1,
          role,
        }));
      expect(
        await importRecords({
          personaId,
          userId,
          source: "wechat_export",
          records: asRecords(wechat, "阿树", "user"),
        }),
      ).toBe(3);
      expect(
        await importRecords({
          personaId,
          userId,
          source: "sms",
          records: asRecords(sms, "小满", "assistant"),
        }),
      ).toBe(3);
      const read: Array<{ source: string; content: string; at: string }> = [];
      for await (const row of iterateRecords(personaId, userId)) {
        read.push({
          source: row.source,
          content: row.content,
          at: row.timestamp?.toISOString() ?? "",
        });
      }
      expect(read.map((row) => `${row.at} ${row.source} ${row.content}`)).toEqual([
        "2022-03-01T12:00:00.000Z wechat_export 在吗",
        "2022-03-01T12:01:00.000Z sms 在吗",
        "2022-03-01T12:02:00.000Z wechat_export 好",
        "2022-03-01T12:03:00.000Z sms 好",
        "2022-03-01T12:04:00.000Z wechat_export 嗯",
        "2022-03-01T12:04:00.000Z sms 嗯",
      ]);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("keeps the open notes on the page when the ticked ones are many", async () => {
    const userId = await createUser({
      username: `notes-order-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
      passwordHash: "x",
      name: "notes-order",
    });
    const personaId = await createPersona({ userId, name: "notes-order" });
    try {
      for (let index = 0; index < 20; index++) {
        const done = await createLetter({
          userId,
          personaId,
          body: `已经说过的事 ${index}`,
          status: "private",
          kind: "todo",
        });
        expect(done).not.toBeNull();
        await setLetterDone(done!.id, userId, true);
      }
      const open = await createLetter({
        userId,
        personaId,
        body: "还没说的事",
        status: "private",
        kind: "todo",
      });
      expect(open).not.toBeNull();

      const rows = await getWaitingNotes(personaId, userId);
      expect(rows).toHaveLength(20);
      // The old order put the twenty ticked notes first, so the only
      // open one was cut off by the limit and never reached the page.
      expect(rows.some((row) => row.id === open!.id)).toBe(true);
      expect(rows.filter((row) => row.doneAt === null)).toHaveLength(1);
      expect(rows[0].id).toBe(open!.id);
    } finally {
      await deleteUserAccount(userId);
    }
  });
});
