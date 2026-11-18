import { describe, expect, it } from "vitest";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";
import { isSpeechAct } from "./speech-acts";
import {
  clusterActLines,
  measureActClusters,
  pickActClusterLines,
} from "./act-clusters";

function variants(base: string, n: number): Array<{ text: string; at: Date }> {
  const tails = ["", "了", "呀", "啦", "哦", "哈", "咯", "嘛", "呢", "啊"];
  return Array.from({ length: n }, (_, i) => ({
    text: `${base}${tails[i] ?? ""}`,
    at: new Date(Date.UTC(2022, 2, 1, 12, 0, i)),
  }));
}

describe("clustering the lines under one action", () => {
  it("splits ten 哈哈哈哈 你又来 variants and ten 就嗯？ variants into two clusters", () => {
    const clustered = clusterActLines([
      ...variants("哈哈哈哈 你又来", 10),
      ...variants("就嗯？", 10),
    ]);
    expect(clustered).toBeTruthy();
    expect(clustered!.length).toBe(2);
    const joined = clustered!.map((row) => row.lines.join(" "));
    const laugh = clustered!.find((row) => row.lines.some((line) => line.includes("哈哈哈哈")));
    const mm = clustered!.find((row) => row.lines.some((line) => line.includes("就嗯")));
    expect(laugh).toBeTruthy();
    expect(mm).toBeTruthy();
    expect(laugh!.size).toBe(10);
    expect(mm!.size).toBe(10);
    expect(joined.some((text) => text.includes("哈哈哈哈") && text.includes("就嗯"))).toBe(false);
  });

  it("does not produce clusters for eleven lines", () => {
    expect(clusterActLines(variants("哈哈哈哈 你又来", 11))).toBeNull();
  });

  it("picks one line from each of the largest clusters, stably for a seed", () => {
    const clustered = clusterActLines([
      ...variants("哈哈哈哈 你又来", 12),
      ...variants("就嗯？", 12),
    ]);
    const first = pickActClusterLines(clustered!, () => 0);
    const second = pickActClusterLines(clustered!, () => 0);
    expect(first).toEqual(second);
    expect(first.length).toBe(2);
  });
});

describe("the fixture's acknowledgements", () => {
  it("produces acknowledge clusters whose every line is a true acknowledge", () => {
    const fixture = buildXiaomanRecords();
    const records = fixture.map((row) => ({
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      act: row.role === "assistant" && isSpeechAct(row.truth.act) ? row.truth.act : null,
    }));
    const clusters = measureActClusters(records);
    expect(clusters?.acknowledge).toBeTruthy();
    expect(clusters!.acknowledge!.length).toBeGreaterThan(0);
    const allowed = new Set(
      fixture
        .filter((row) => row.role === "assistant" && row.kind === "text" && row.truth.act === "acknowledge")
        .map((row) => row.content),
    );
    for (const cluster of clusters!.acknowledge!) {
      for (const line of cluster.lines) {
        expect(allowed.has(line)).toBe(true);
      }
    }
  });
});
