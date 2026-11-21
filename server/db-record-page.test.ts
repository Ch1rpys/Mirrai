import { describe, expect, it } from "vitest";
import {
  countRecords,
  countRecordsByMonth,
  createPersona,
  purgePersona,
  deleteRecordRow,
  listRecordMarks,
  pageRecords,
  removeRecordMark,
  upsertRecordMark,
} from "./db";
import { seedXiaoman } from "./test-fixtures/seed-db";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("the timeline reader's data", () => {
  it("pages the whole fixture without losing or repeating a line", async () => {
    const userId = 9_950_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const total = await countRecords(personaId, userId);
      const seen: number[] = [];
      let anchor: { recordId: number } | undefined;
      let hasNewerFirst: boolean | null = null;
      let pages = 0;
      for (;;) {
        const page = await pageRecords(personaId, userId, {
          anchor,
          direction: "older",
          limit: 200,
        });
        pages += 1;
        expect(page.rows.length).toBeLessThanOrEqual(200);
        if (hasNewerFirst === null) hasNewerFirst = page.hasNewer;
        seen.push(...page.rows.map((row) => row.id));
        if (!page.hasOlder) break;
        anchor = { recordId: page.rows[0].id };
      }
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
      expect(pages).toBe(Math.ceil(total / 200));
      // The first page is the newest one: nothing newer to load. The last
      // page is the oldest: nothing older.
      expect(hasNewerFirst).toBe(false);
      expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("returns the anchored line and its neighbours", async () => {
    const userId = 9_960_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const first = await pageRecords(personaId, userId, { direction: "older", limit: 200 });
      const middle = first.rows[100];
      const page = await pageRecords(personaId, userId, {
        anchor: { recordId: middle.id },
        direction: "around",
        limit: 10,
      });
      expect(page.rows.map((row) => row.id)).toContain(middle.id);
      expect(page.rows.length).toBeGreaterThan(1);
      expect(page.rows.length).toBeLessThanOrEqual(10);
      expect(page.hasOlder).toBe(true);
      expect(page.hasNewer).toBe(true);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("keeps an even around-page within its limit", async () => {
    const userId = 9_965_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const first = await pageRecords(personaId, userId, { direction: "older", limit: 200 });
      const anchor = first.rows[100];
      const page = await pageRecords(personaId, userId, {
        anchor: { recordId: anchor.id },
        direction: "around",
        limit: 200,
      });
      expect(page.rows.length).toBeLessThanOrEqual(200);
      expect(page.rows.map((row) => row.id)).toContain(anchor.id);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("counts the months of the outline and adds up to the total", async () => {
    const userId = 9_970_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      const total = await countRecords(personaId, userId);
      const months = await countRecordsByMonth(personaId, userId, "Asia/Shanghai");
      expect(months.length).toBeGreaterThan(20);
      expect(months.reduce((sum, row) => sum + row.count, 0)).toBe(total);
      expect(months.every((row) => /^\d{4}-\d{2}$/.test(row.month))).toBe(true);
    } finally {
      await purgePersona(personaId, userId);
    }
  });

  it("keeps a bookmark and a note, and drops them with the line", async () => {
    const userId = 9_980_000 + Math.floor(Math.random() * 10_000);
    const personaId = await createPersona({ userId, name: "marks" });
    try {
      const { createCollectedMessages } = await import("./db");
      await createCollectedMessages([{
        userId,
        personaId,
        source: "generic",
        role: "assistant",
        content: "在的呀",
        timestamp: new Date("2022-03-01T12:00:00.000Z"),
        kind: "text",
        speaker: "小满",
      }]);
      const page = await pageRecords(personaId, userId, { direction: "older", limit: 10 });
      const recordId = page.rows[0].id;

      const bookmark = await upsertRecordMark({
        userId,
        personaId,
        recordId,
        kind: "bookmark",
        note: null,
      });
      expect(bookmark?.kind).toBe("bookmark");
      const note = await upsertRecordMark({
        userId,
        personaId,
        recordId,
        kind: "note",
        note: "这里值得记住",
      });
      expect(note?.note).toBe("这里值得记住");
      // The same kind twice updates rather than duplicates.
      await upsertRecordMark({ userId, personaId, recordId, kind: "note", note: "改过" });
      const marks = await listRecordMarks(personaId, userId);
      expect(marks).toHaveLength(2);
      expect(marks.find((mark) => mark.kind === "note")?.note).toBe("改过");

      // Somebody else cannot mark this line.
      await expect(
        upsertRecordMark({ userId: userId + 1, personaId, recordId, kind: "bookmark", note: null }),
      ).resolves.toBeNull();

      // Deleting the line takes its marks with it.
      expect(await deleteRecordRow(recordId, personaId, userId)).toBe(true);
      expect(await listRecordMarks(personaId, userId)).toHaveLength(0);
      expect(await removeRecordMark(bookmark!.id, userId, personaId)).toBe(false);
    } finally {
      await purgePersona(personaId, userId);
    }
  });
});
