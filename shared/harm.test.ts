import { describe, expect, it } from "vitest";
import {
  HARM_CUES_EN,
  HARM_CUES_ZH,
  HARM_KINDS,
  filterHarm,
  findHarmCandidates,
  isHarmfulLine,
  personaDataForExport,
  shouldFilterHarm,
  shouldInstructHarm,
} from "./harm";
import { buildXiaomanRecords } from "../server/test-fixtures/xiaoman";

describe("the harm cue lists", () => {
  it("has at least fifteen clues in each language for every kind", () => {
    for (const kind of HARM_KINDS) {
      expect(HARM_CUES_ZH[kind].length, kind).toBeGreaterThanOrEqual(15);
      expect(HARM_CUES_EN[kind].length, kind).toBeGreaterThanOrEqual(15);
    }
  });

  it("hits a positive example of each kind", () => {
    expect(isHarmfulLine("你就是个废物", ["belittle"])).toBe(true);
    expect(isHarmfulLine("操你妈", ["insult"])).toBe(true);
    expect(isHarmfulLine("弄死你", ["threat"])).toBe(true);
    expect(isHarmfulLine("不准你出门", ["control"])).toBe(true);
    expect(isHarmfulLine("you're worthless", ["belittle"])).toBe(true);
    expect(isHarmfulLine("fuck you", ["insult"])).toBe(true);
    expect(isHarmfulLine("i'll kill you", ["threat"])).toBe(true);
    expect(isHarmfulLine("give me your phone", ["control"])).toBe(true);
  });

  it("does not treat a mild tease as harm", () => {
    expect(isHarmfulLine("你这个小笨蛋")).toBe(false);
    expect(isHarmfulLine("傻瓜")).toBe(false);
  });
});

describe("candidates in the fixture", () => {
  it("finds none in the default log and five belittling lines when asked", () => {
    expect(findHarmCandidates(buildXiaomanRecords())).toEqual([]);
    const found = findHarmCandidates(buildXiaomanRecords({ withHarm: true }));
    expect(found).toHaveLength(5);
    expect(found.every((row) => row.kind === "belittle")).toBe(true);
  });
});

describe("filterHarm", () => {
  const lines = buildXiaomanRecords({ withHarm: true })
    .filter((row) => row.role === "assistant" && row.kind === "text")
    .map((row) => ({ id: row.id, content: row.content }));
  const report = {
    categories: [{ kind: "belittle" as const, count: 5, examples: lines.slice(0, 3).map((row) => row.id) }],
    decision: "pending" as const,
  };
  const five = findHarmCandidates(buildXiaomanRecords({ withHarm: true })).map((row) => row.recordId);

  it("drops the five lines when the decision is pending or remove", () => {
    const pending = filterHarm(lines, { harmReport: report }).map((row) => row.id);
    const removed = filterHarm(lines, { harmReport: { ...report, decision: "remove" } }).map(
      (row) => row.id,
    );
    for (const id of five) {
      expect(pending).not.toContain(id);
      expect(removed).not.toContain(id);
    }
  });

  it("keeps the five lines when the decision is keep", () => {
    const kept = filterHarm(lines, { harmReport: { ...report, decision: "keep" } }).map(
      (row) => row.id,
    );
    for (const id of five) {
      expect(kept).toContain(id);
    }
  });
});

describe("the soften decision (C10.1)", () => {
  const lines = buildXiaomanRecords({ withHarm: true })
    .filter((row) => row.role === "assistant" && row.kind === "text")
    .map((row) => ({ id: row.id, content: row.content }));
  const five = findHarmCandidates(buildXiaomanRecords({ withHarm: true })).map((row) => row.recordId);
  const report = {
    categories: [{ kind: "belittle" as const, count: 5, examples: five.slice(0, 3) }],
    decision: "soften" as const,
  };

  it("keeps the voice but drops the hurtful lines", () => {
    // 「学语气，不学这些话」: the measurement still learns how the
    // person talks, but the lines that hurt are not part of the voice
    // it learns. That is the middle choice between keep and remove.
    expect(shouldFilterHarm(report)).toBe(true);
    const kept = filterHarm(lines, { harmReport: report }).map((row) => row.id);
    for (const id of five) expect(kept).not.toContain(id);
    expect(kept.length).toBeGreaterThan(0);
    // Softening does not add a second instruction on top of the prompt.
    expect(shouldInstructHarm(report)).toBe(false);
  });
});

describe("persona data on its way out (C10.1)", () => {
  const harmReport = {
    categories: [{
      kind: "belittle" as const,
      count: 5,
      examples: [1, 2, 3],
      snippets: ["你就是个废物", "真没用"],
    }],
    decision: "remove" as const,
  };

  it("strips the evidence snippets but keeps the decision", () => {
    const exported = personaDataForExport({ personality: "温柔", harmReport });
    const report = exported.harmReport as { decision: string; categories: Array<{ count: number; examples: number[]; snippets?: string[] }> };
    expect(report.decision).toBe("remove");
    expect(report.categories[0]?.count).toBe(5);
    expect(report.categories[0]?.examples).toEqual([1, 2, 3]);
    // The quotes themselves are only ever shown in the card.
    expect(JSON.stringify(exported)).not.toContain("你就是个废物");
    expect(report.categories[0]?.snippets).toBeUndefined();
  });

  it("leaves the rest of the persona alone", () => {
    expect(personaDataForExport({ personality: "温柔", nickname: "满满" })).toEqual({
      personality: "温柔",
      nickname: "满满",
    });
    expect(personaDataForExport(null)).toEqual({});
  });
});
