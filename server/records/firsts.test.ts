import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { findFirsts } from "./firsts";

const fixture = buildXiaomanRecords();
/**
 * The fixture keeps the designed state in its truth; B1.5 writes that
 * state onto the `emotion` column of the record rows. The test rows
 * have to carry it in the same place the production rows do.
 */
const labelled = fixture.map((row) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  kind: row.kind,
  timestamp: row.timestamp,
  createdAt: row.timestamp,
  emotion: row.truth.state,
  meta: row.meta ?? null,
}));
const imageAt = new Date("2022-03-01T09:00:00+08:00");
const withImage = [
  ...labelled,
  {
    id: 9_999_999,
    role: "user" as const,
    content: "[image]",
    kind: "image",
    timestamp: imageAt,
    createdAt: imageAt,
    emotion: null,
    meta: { path: "personas/1/5/imports/1/a.jpg" },
  },
];

describe("the firsts and the lasts", () => {
  it("points every first at the line the fixture says it is", () => {
    const found = findFirsts(withImage, { conflict: {} });
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
    expect(byKey.get("firstPhoto")?.recordId).toBe(9_999_999);
    expect(byKey.get("firstPhoto")?.text).toBe("[image]");
    expect(byKey.get("firstSticker")?.recordId).toBe(
      fixture.filter((row) => row.kind === "sticker")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id)[0]?.id,
    );
    expect(byKey.get("firstVoice")?.recordId).toBe(
      fixture.filter((row) => row.kind === "voice")
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id)[0]?.id,
    );
    const lastLine = fixture
      .filter((row) => row.kind === "text" && row.content.trim())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id)
      .at(-1);
    expect(byKey.get("lastLine")?.recordId).toBe(lastLine?.id);
    const firstGoodnightMe = fixture
      .filter((row) => row.role === "user" && row.content.trim() === "晚安")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
    expect(byKey.get("firstGoodnightMe")?.recordId).toBe(firstGoodnightMe.id);
    expect(byKey.get("firstMorningMe")?.text).toBe("早");
    expect(byKey.get("firstMorningThem")?.text).toBe("早呀");
    const calls = fixture
      .filter((row) => row.kind === "call")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id);
    expect(byKey.get("lastCall")?.recordId).toBe(calls.at(-1)?.id);
    const longest = [...calls].sort((a, b) => {
      const aDuration = Number((a.meta as { durationSec?: unknown } | null)?.durationSec ?? 0);
      const bDuration = Number((b.meta as { durationSec?: unknown } | null)?.durationSec ?? 0);
      return bDuration - aDuration || a.id - b.id;
    })[0];
    expect(byKey.get("longestCall")?.recordId).toBe(longest?.id);
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

  it("does not read a negated line as a declaration of love", () => {
    const at = new Date("2022-03-01T12:00:00.000Z");
    const found = findFirsts([
      {
        id: 1,
        role: "assistant",
        content: "我不爱你了",
        kind: "text",
        timestamp: at,
        createdAt: at,
        emotion: "distant",
        meta: null,
      },
    ], {});
    expect(found.some((item) => item.key === "firstLoveThem")).toBe(false);
  });
});
