import { describe, expect, it } from "vitest";
import { copy } from "@shared/copy";
import { TOPIC_DOMAINS } from "@shared/topic-domains";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { mineKnowledgeBoundary } from "./knowledge-boundary";

const FINANCE = copy("zh", "labels.topicDomain.finance");

describe("topics they have never spoken about", () => {
  it("has about twenty coarse domains, each with a real keyword list", () => {
    expect(TOPIC_DOMAINS.length).toBeGreaterThanOrEqual(20);
    for (const domain of TOPIC_DOMAINS) {
      expect(domain.keywords.length).toBeGreaterThanOrEqual(12);
      expect(copy("zh", domain.nameKey)).toMatch(/[一-鿿]/);
    }
  });

  it("reads stocks and funds off Xiaoman, from the reply she actually gave", () => {
    const mined = mineKnowledgeBoundary(buildXiaomanRecords(), { minTaLines: 500 });
    const stocks = mined.find((row) => row.pattern === FINANCE);
    expect(stocks?.kind).toBe("knowledge_boundary");
    expect(stocks?.verified).toBe(false);
    expect(stocks?.source).toBe("auto");
    expect(stocks?.evidence.some((row) => row.snippet.includes("听不懂 说人话"))).toBe(true);
    expect(stocks?.evidence).toHaveLength(3);
  });

  it("does not mine a domain they named once", () => {
    const rows = [
      ...buildXiaomanRecords(),
      {
        role: "assistant" as const,
        content: "股票还行",
        kind: "text" as const,
        timestamp: new Date("2024-12-01T12:00:00Z"),
      },
    ];
    const mined = mineKnowledgeBoundary(rows, { minTaLines: 500 });
    expect(mined.find((row) => row.pattern === FINANCE)).toBeUndefined();
  });

  it("does not mine a domain the other person only mentioned four times", () => {
    const rows: Array<{ role: "user" | "assistant"; content: string; kind: "text"; timestamp: Date }> = [];
    for (let i = 0; i < 2000; i++) {
      rows.push({
        role: "assistant",
        content: "嗯",
        kind: "text",
        timestamp: new Date(Date.UTC(2020, 0, 1, 0, i)),
      });
    }
    for (let i = 0; i < 4; i++) {
      rows.push({
        role: "user",
        content: i % 2 === 0 ? "今天股票怎么样" : "基金又跌了",
        kind: "text",
        timestamp: new Date(Date.UTC(2021, 0, 1, i)),
      });
      rows.push({
        role: "assistant",
        content: "听不懂 说人话",
        kind: "text",
        timestamp: new Date(Date.UTC(2021, 0, 1, i, 1)),
      });
    }
    expect(mineKnowledgeBoundary(rows).find((row) => row.pattern === FINANCE)).toBeUndefined();
  });
});
