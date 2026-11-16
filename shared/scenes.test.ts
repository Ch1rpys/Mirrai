import { describe, expect, it } from "vitest";
import { splitScenes, toTurns } from "./scenes";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";

function row(
  at: string,
  role: "user" | "assistant" | "other",
  extra: { speaker?: string; source?: string } = {},
) {
  return {
    timestamp: new Date(at),
    role,
    speaker: extra.speaker,
    source: extra.source,
    content: role,
  };
}

describe("splitScenes", () => {
  it("keeps rows less than six hours apart in one scene", () => {
    const rows = [
      row("2022-03-01T12:00:00.000Z", "user"),
      row("2022-03-01T17:59:00.000Z", "assistant"),
    ];
    expect(splitScenes(rows)).toHaveLength(1);
    expect(splitScenes(rows)[0]).toHaveLength(2);
  });

  it("opens a new scene after more than six hours of silence", () => {
    const rows = [
      row("2022-03-01T12:00:00.000Z", "user"),
      row("2022-03-01T18:00:01.000Z", "assistant"),
    ];
    const scenes = splitScenes(rows);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toHaveLength(1);
    expect(scenes[1]).toHaveLength(1);
  });

  it("honours a custom break window", () => {
    const rows = [
      row("2022-03-01T12:00:00.000Z", "user"),
      row("2022-03-01T13:30:00.000Z", "assistant"),
    ];
    expect(splitScenes(rows, 1)).toHaveLength(2);
    expect(splitScenes(rows, 2)).toHaveLength(1);
  });

  it("does not break on a row with no timestamp", () => {
    const rows = [
      row("2022-03-01T12:00:00.000Z", "user"),
      { timestamp: null, role: "assistant" as const, content: "x" },
      row("2022-03-02T12:00:00.000Z", "user"),
    ];
    expect(splitScenes(rows)).toHaveLength(1);
  });

  it("treats two sources in the same stretch as one scene", () => {
    const rows = [
      row("2022-03-01T12:00:00.000Z", "user", { source: "wechat_export" }),
      row("2022-03-01T12:01:00.000Z", "assistant", { source: "sms" }),
      row("2022-03-01T12:02:00.000Z", "user", { source: "wechat_export" }),
    ];
    expect(splitScenes(rows)).toHaveLength(1);
  });

  it("returns nothing for an empty record", () => {
    expect(splitScenes([])).toEqual([]);
  });

  it("does not change the cuts when even and odd fixture scenes come from different sources", () => {
    const records = [...buildXiaomanRecords()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id - b.id,
    );
    const unlabeled = splitScenes(records);
    const tagged = records.map((row) => ({
      ...row,
      source: row.truth.sceneId % 2 === 0 ? "wechat_export" : "sms",
    }));
    const labeled = splitScenes(tagged);
    expect(labeled.map((scene) => scene.map((row) => row.id))).toEqual(
      unlabeled.map((scene) => scene.map((row) => row.id)),
    );
  });
});

describe("toTurns", () => {
  it("merges consecutive lines from the same person", () => {
    const rows = [
      { role: "assistant", speaker: "小满", content: "a" },
      { role: "assistant", speaker: "小满", content: "b" },
      { role: "user", speaker: "阿树", content: "c" },
    ];
    const turns = toTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0].map((item) => item.content)).toEqual(["a", "b"]);
    expect(turns[1].map((item) => item.content)).toEqual(["c"]);
  });

  it("keeps two other-speakers apart", () => {
    const rows = [
      { role: "other", speaker: "琪琪", content: "a" },
      { role: "other", speaker: "我妈", content: "b" },
    ];
    expect(toTurns(rows)).toHaveLength(2);
  });
});
