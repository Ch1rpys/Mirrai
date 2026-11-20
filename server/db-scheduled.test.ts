import { describe, expect, it } from "vitest";
import {
  cancelScheduledItem,
  claimScheduledItem,
  createScheduledItem,
  finishScheduledItem,
  getScheduledItem,
  listDueScheduledItems,
  listScheduledItems,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("scheduled items in postgres", () => {
  it("creates, lists and isolates by user", async () => {
    const userId = 9_980_000 + Math.floor(Math.random() * 10_000);
    const other = userId + 50_000;
    const personaId = 9_980_000 + Math.floor(Math.random() * 10_000);
    try {
      const row = await createScheduledItem({
        userId,
        personaId,
        kind: "capsule",
        body: "给以后的自己",
        dueAt: new Date("2099-01-01T00:00:00Z"),
        status: "scheduled",
      });
      const mine = await listScheduledItems(personaId, userId);
      expect(mine.map((item) => item.id)).toContain(row.id);
      expect(await listScheduledItems(personaId, other)).toEqual([]);
      expect(await getScheduledItem(row.id, other)).toBeNull();
      expect(await getScheduledItem(row.id, userId)).toMatchObject({ body: "给以后的自己" });
    } finally {
      const rows = await listScheduledItems(personaId, userId);
      for (const item of rows) await cancelScheduledItem(item.id, userId);
    }
  });

  it("claims a due item once and finishes it once", async () => {
    const userId = 9_990_000 + Math.floor(Math.random() * 10_000);
    const personaId = 9_990_000 + Math.floor(Math.random() * 10_000);
    const row = await createScheduledItem({
      userId,
      personaId,
      kind: "message",
      body: "到那天说",
      dueAt: new Date("2020-01-01T00:00:00Z"),
      status: "scheduled",
    });
    const due = await listDueScheduledItems(new Date("2026-01-01T00:00:00Z"));
    expect(due.some((item) => item.id === row.id)).toBe(true);
    expect(await claimScheduledItem(row.id, userId)).toBe(true);
    expect(await claimScheduledItem(row.id, userId)).toBe(false);
    expect(await finishScheduledItem(row.id, userId, "delivered", {
      at: new Date("2026-01-01T00:00:00Z"),
    })).toBe(true);
    const after = await getScheduledItem(row.id, userId);
    expect(after?.status).toBe("delivered");
    expect(after?.claimedAt).toBeNull();
    expect(after?.deliveredAt).toBeInstanceOf(Date);
    // A delivered item is not due again.
    const again = await listDueScheduledItems(new Date("2026-01-02T00:00:00Z"));
    expect(again.some((item) => item.id === row.id)).toBe(false);
  });

  it("cancels only a scheduled item", async () => {
    const userId = 9_995_000 + Math.floor(Math.random() * 10_000);
    const personaId = 9_995_000 + Math.floor(Math.random() * 10_000);
    const row = await createScheduledItem({
      userId,
      personaId,
      kind: "letter",
      body: "一封信",
      dueAt: new Date("2099-01-01T00:00:00Z"),
      status: "scheduled",
    });
    expect(await cancelScheduledItem(row.id, userId)).toBe(true);
    expect(await cancelScheduledItem(row.id, userId)).toBe(false);
    expect((await getScheduledItem(row.id, userId))?.status).toBe("cancelled");
  });
});
