import { describe, expect, it, vi } from "vitest";
import { collectLexiconCandidates, mergeLexicon } from "@shared/lexicon";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import { mineLexicon } from "./lexicon";

/**
 * Private words, counted off the record before a model is asked.
 *
 * Everyday language has to stay off the list the model sees, and a
 * term the model invents has to stay off the persona.
 */

function termsSentToModel(invoke: ReturnType<typeof vi.fn>): string[] {
  const messages = invoke.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
  const body = messages?.find((row) => row.role === "user")?.content ?? "";
  const jsonStart = body.indexOf("[");
  const jsonEnd = body.lastIndexOf("]");
  if (jsonStart < 0 || jsonEnd < jsonStart) return [];
  const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1)) as Array<{ term?: string }>;
  return parsed.map((row) => row.term).filter((term): term is string => typeof term === "string");
}

function guguRows() {
  const first = new Date("2022-03-12T04:00:00.000Z");
  const gugu = Array.from({ length: 15 }, (_, i) => ({
    role: "assistant" as const,
    content: "又咕咕了",
    kind: "text",
    timestamp: new Date(first.getTime() + i * 60_000),
  }));
  const today = Array.from({ length: 20 }, (_, i) => ({
    role: "user" as const,
    content: "今天天气不错",
    kind: "text",
    timestamp: new Date(first.getTime() + i * 90_000),
  }));
  return [...gugu, ...today];
}

describe("counting the private lexicon", () => {
  it("keeps 咕咕 from the fixture, at about 15, with the first line as evidence", async () => {
    const rows = buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
    }));
    const firstLine = rows.find((row) => row.content.includes("咕咕"));
    const invoke = vi.fn(async () => JSON.stringify([{ term: "咕咕", gloss: "放鸽子" }]));
    const mined = await mineLexicon({
      personaId: 1,
      userId: 1,
      locale: "zh",
      records: rows,
      invoke,
    });
    const gugu = mined.find((row) => row.term === "咕咕");
    expect(gugu).toBeTruthy();
    expect(gugu?.count).toBeGreaterThanOrEqual(14);
    expect(gugu?.count).toBeLessThanOrEqual(16);
    expect(gugu?.evidence[0]?.snippet).toBe(firstLine?.content);
    expect(gugu?.who).toBe("them");
    expect(gugu?.verified).toBe(false);
    const sent = termsSentToModel(invoke);
    expect(sent).toContain("咕咕");
    expect(sent).not.toContain("今天");
  });

  it("does not send everyday words to the model", async () => {
    const invoke = vi.fn(async () => JSON.stringify([{ term: "咕咕", gloss: "放鸽子" }]));
    await mineLexicon({
      personaId: 1,
      userId: 1,
      records: guguRows(),
      invoke,
    });
    const sent = termsSentToModel(invoke);
    expect(sent).toContain("咕咕");
    expect(sent).not.toContain("今天");
    expect(sent).not.toContain("天气");
    expect(collectLexiconCandidates(guguRows()).map((row) => row.term)).not.toContain("今天");
  });

  it("drops a term the model invented", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([
        { term: "咕咕", gloss: "放鸽子" },
        { term: "专属黑话", gloss: "模型自己加的" },
      ]),
    );
    const mined = await mineLexicon({
      personaId: 1,
      userId: 1,
      records: guguRows(),
      invoke,
    });
    expect(mined.map((row) => row.term)).toEqual(["咕咕"]);
  });

  it("keeps the two-character slang and drops the wrapper around it", () => {
    const terms = collectLexiconCandidates(guguRows()).map((row) => row.term);
    expect(terms).toContain("咕咕");
    expect(terms).not.toContain("又咕咕了");
    expect(terms).not.toContain("又咕咕");
  });

  it("keeps a confirmed word across a re-run and leaves a rejected one gone", () => {
    const confirmed = {
      id: "keep",
      term: "咕咕",
      gloss: "放鸽子",
      who: "them" as const,
      count: 15,
      evidence: [{ snippet: "又咕咕了" }],
      source: "auto" as const,
      verified: true,
    };
    const merged = mergeLexicon(
      [confirmed],
      [
        { ...confirmed, id: "auto-new", gloss: "新的解释", verified: false },
        {
          id: "auto-no",
          term: "专属黑话",
          gloss: "不该回来",
          who: "both" as const,
          count: 8,
          evidence: [{ snippet: "专属黑话" }],
          source: "auto" as const,
          verified: false,
        },
      ],
      ["lexicon:专属黑话"],
    );
    expect(merged.map((row) => row.term)).toEqual(["咕咕"]);
    expect(merged[0]?.gloss).toBe("放鸽子");
  });
});
