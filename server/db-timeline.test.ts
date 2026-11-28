import { describe, expect, it } from "vitest";
import { deleteRecordRow, iterateRecords, purgePersona, updatePersona } from "./db";
import { seedXiaoman } from "./test-fixtures/seed-db";
import {
  buildTimeline,
  findTurningPoints,
  setTurningPointDecision,
  weekStartDate,
} from "./records/timeline";
import { isoWeekKey } from "@shared/timezone";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Removes every record in the weeks after a week key.
 *
 * The same week axis as `buildTimeline`: the persona's own zone decides
 * which week a row belongs to. The turn's own week is left in the
 * records — the page still has that week on the axis, it just no longer
 * measures a move there.
 */
async function deleteRecordsAfterWeek(
  personaId: number,
  userId: number,
  id: string,
): Promise<number> {
  const start = weekStartDate(id);
  if (!start) throw new Error(`not a week key: ${id}`);
  const startAt = Date.parse(`${start}T00:00:00Z`);
  const ids: number[] = [];
  for await (const row of iterateRecords(personaId, userId)) {
    const week = weekStartDate(isoWeekKey(row.timestamp ?? row.createdAt, "Asia/Shanghai"));
    if (!week) continue;
    const offset = (Date.parse(`${week}T00:00:00Z`) - startAt) / 604_800_000;
    if (offset >= 1) ids.push(row.id);
  }
  for (const rowId of ids) await deleteRecordRow(rowId, personaId, userId);
  return ids.length;
}

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

  it("keeps a confirmed turn that the current records do not detect (C2.5)", async () => {
    // The records changed under a decision: the week no longer moves
    // enough to be detected. The page must still show what the user
    // confirmed and wrote, or their own note disappears with the data.
    const userId = 9_946_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      await setTurningPointDecision({
        personaId,
        userId,
        id: "2000-W01",
        status: "confirmed",
        note: "这是我自己记下的",
      });
      const timeline = await buildTimeline({ personaId, userId });
      const kept = timeline.points.find((point) => point.id === "2000-W01");
      expect(kept).toMatchObject({ status: "confirmed", note: "这是我自己记下的" });
      expect(kept?.weekStart).toBe("2000-01-03");
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 30_000);

  it("keeps the changes of a confirmed turn the current records no longer detect (C2.5)", async () => {
    /**
     * The production shape of the bug: the user confirms a point the
     * page is showing, with the changes the page lists ("their median
     * length went 10 → 6"). Later the records change so the week stops
     * moving; the stored decision keeps the point, but the store never
     * had the changes — the vertical line and the sentence vanished.
     *
     * The fixture is real rows: detect, confirm with the changes the
     * detector returned, delete that period's records, detect again.
     */
    const userId = 9_947_000 + Math.floor(Math.random() * 10_000);
    const { personaId } = await seedXiaoman(null, { userId });
    try {
      await updatePersona(personaId, userId, { timezone: "Asia/Shanghai" });
      const first = await buildTimeline({ personaId, userId });
      const target = first.points.find(
        (point) =>
          point.id.startsWith("2023-")
          && point.changes.some((change) => change.series === "charsMedian"),
      );
      expect(target).toBeTruthy();
      const savedChanges = target!.changes;
      expect(savedChanges.length).toBeGreaterThan(0);

      // What the confirm route does: the point the user is looking at,
      // together with the changes the page listed for it.
      await setTurningPointDecision({
        personaId,
        userId,
        id: target!.id,
        status: "confirmed",
        changes: savedChanges,
        note: "那之后话短了",
      });

      // The records change under the decision: the later part of the
      // history is deleted, so the week that carried the shift no longer
      // moves enough to be detected again.
      expect(await deleteRecordsAfterWeek(personaId, userId, target!.id)).toBeGreaterThan(0);
      const second = await buildTimeline({ personaId, userId });
      expect(findTurningPoints(second.series).map((point) => point.id)).not.toContain(target!.id);
      // The week is still on the axis (the page can draw the line there);
      // only the move it used to measure is gone.
      expect(second.series.some((week) => week.week === target!.id)).toBe(true);

      // The point survives on the user's decision, and what moved has to
      // survive with it, or the page shows a point with no line and no
      // "what changed".
      const kept = second.points.find((point) => point.id === target!.id);
      expect(kept?.status).toBe("confirmed");
      expect(kept?.note).toBe("那之后话短了");
      expect(kept?.weekStart).toBe(weekStartDate(target!.id));
      expect(kept?.changes).toEqual(savedChanges);

      // A writer that does not carry changes (the reject path, or a page
      // that only changes the note) must not erase what the confirmation
      // stored.
      const rewritten = await setTurningPointDecision({
        personaId,
        userId,
        id: target!.id,
        status: "confirmed",
        note: "那之后话短了",
      });
      expect(rewritten?.changes).toEqual(savedChanges);
    } finally {
      await purgePersona(personaId, userId);
    }
  }, 30_000);
});
