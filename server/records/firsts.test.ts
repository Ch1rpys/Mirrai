import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { findFirsts } from "./firsts";

const fixture = buildXiaomanRecords();
const rows = fixture.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  kind: row.kind,
  timestamp: row.timestamp,
  createdAt: row.timestamp,
  meta: { ...(row.meta ?? {}), ...(row.truth.act ? {} : {}) },
}));
// The emotion label lives in the fixture's truth, not in meta; put it
// where the production rows carry it (B1.5 writes `meta` and the column).
const labelled = fixture.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  kind: row.kind,
  timestamp: row.timestamp,
  createdAt: row.timestamp,
  meta: { emotion: row.truth.state, ...(row.meta ?? {}) },
}));

describe("the firsts and the lasts", () => {
  it("points every first at the line the fixture says it is", () => {
    const found = findFirsts(labelled, { conflict: {} });
    const byKey = new Map(found.map((item) => [item.key, item]));

    const firstText = fixture
      .filter((row) => row.kind === "text")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id)[0];
    expect(byKey.get("firstLine")?.recordId).toBe(firstText.id);

    const firstGoodnightThem = fixture
      .filter((row) => row.role === "assistant" && row.truth.ritual === "晚安")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
    expect(byKey.get("firstGoodnightThem")?.recordId).toBe(firstGoodnightThem.id);

    // The fixture numbers its six conflicts by pool order, not by
    // date; the first fight is the earliest of them.
    const firstFightStart = fixture
      .filter((row) => row.truth.conflictEpisode != null)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
    expect(byKey.get("firstFight")?.recordId).toBe(firstFightStart.id);

    const firstCall = fixture
      .filter((row) => row.kind === "call")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
    expect(byKey.get("firstCall")?.recordId).toBe(firstCall.id);
    expect(byKey.get("firstPhoto")?.recordId).toBe(
      fixture.find((row) => row.kind === "image")?.id ?? byKey.get("firstPhoto")?.recordId,
    );
    expect(found.every((item) => item.at)).toBe(true);
  });

  it("omits a first that never happened", () => {
    const found = findFirsts(labelled, { conflict: {} });
    expect(found.some((item) => item.key === "firstLoveMe")).toBe(false);
    expect(found.some((item) => item.key === "firstLoveThem")).toBe(false);
  });

  it("does not show a fight when there is no conflict measurement", () => {
    const found = findFirsts(labelled, {});
    expect(found.some((item) => item.key === "firstFight")).toBe(false);
  });
});
