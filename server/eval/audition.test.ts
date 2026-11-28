import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTextRecord } from "@shared/records";
import { measureFingerprint } from "@shared/style-fingerprint";
import { copy } from "@shared/copy";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import type { LLMProvider } from "../llm/types";
import type { EvalCaseData } from "./dataset";
import { attachComposite, runAudition } from "./audition";

const buildPromptForPersona = vi.fn();

vi.mock("../chat/prompt", () => ({
  buildPromptForPersona: (...a: unknown[]) => buildPromptForPersona(...a),
  buildPromptBundleForPersona: async (...a: unknown[]) => {
    const prompt = await buildPromptForPersona(...a);
    return typeof prompt === "string" ? { prompt } : prompt;
  },
}));

const LONG_LINE =
  "这是一句很长很长的话，用来测量分身有没有漂走。这是一句很长很长的话，用来测量分身有没有漂走。这是一句很长很长的话，用来测量分身有没有漂走。你还在吗？";

function fixtureTaLine(): string {
  const line = buildXiaomanRecords()
    .filter((row) => row.role === "assistant" && isTextRecord(row) && row.content.trim())
    .map((row) => row.content.trim())
    .find((text) => Array.from(text).length <= 12 && !/[。？?！!]/.test(text));
  expect(line).toBeTruthy();
  return line!;
}

function fixtureFingerprint() {
  return measureFingerprint(
    buildXiaomanRecords().map((row) => ({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
    })),
  );
}

function persona() {
  const fingerprint = fixtureFingerprint();
  expect(fingerprint).not.toBeNull();
  return {
    id: 1,
    userId: 1,
    name: "小满",
    emotionalState: "warm",
    timezone: "Asia/Shanghai",
    relationshipDesc: "恋人",
    togetherFrom: "2021-06-15",
    togetherTo: null,
    personaData: {},
    styleProfile: {
      version: 1,
      measuredAt: "2023-01-01T00:00:00.000Z",
      recordsVersion: "1:1",
      fingerprint,
    },
  } as any;
}

function cases(): EvalCaseData[] {
  const expected = fixtureTaLine();
  return [
    {
      context: [
        { role: "user", content: "在吗", timestamp: null },
        { role: "assistant", content: "在的", timestamp: null },
      ],
      expected: { role: "assistant", content: expected, timestamp: null },
      expectedState: null,
    },
    {
      context: [
        { role: "user", content: "今天好累", timestamp: null },
        { role: "assistant", content: "怎么了", timestamp: null },
      ],
      expected: { role: "assistant", content: expected, timestamp: null },
      expectedState: null,
    },
  ];
}

function stubProvider(name: string, invoke: LLMProvider["invoke"]): LLMProvider {
  return {
    name,
    capabilities: { streaming: false, vision: false, tools: false, jsonMode: false },
    isConfigured: () => true,
    invoke,
  };
}

beforeEach(() => {
  buildPromptForPersona.mockReset();
  buildPromptForPersona.mockResolvedValue("【系统】");
});

describe("attachComposite", () => {
  it("ranks the closer overlap higher when the rest is equal", () => {
    const ranked = attachComposite([
      { id: "a", providerName: "a", model: "", label: "a", overlap: 0.2, lengthDistance: 1 },
      { id: "b", providerName: "b", model: "", label: "b", overlap: 0.9, lengthDistance: 1 },
    ]);
    expect(ranked.map((row) => row.id)).toEqual(["b", "a"]);
    expect(ranked[0]!.composite).toBeGreaterThan(ranked[1]!.composite!);
  });
});

describe("runAudition", () => {
  it("ranks the in-character model first and records a throwing one", async () => {
    const taLine = fixtureTaLine();
    const report = await runAudition({
      persona: persona(),
      userId: 1,
      cases: cases(),
      trainingTexts: [taLine, "在的呀", "嗯嗯", "早点睡"],
      providers: [
        {
          id: "ta",
          providerName: "ta",
          model: "voice",
          provider: stubProvider("ta", async () => taLine),
        },
        {
          id: "long",
          providerName: "long",
          model: "essay",
          provider: stubProvider("long", async () => LONG_LINE),
        },
        {
          id: "boom",
          providerName: "boom",
          model: "none",
          provider: stubProvider("boom", async () => {
            throw new Error("the model refused");
          }),
        },
      ],
    });

    expect(report.results).toHaveLength(3);
    expect(report.results[0]!.id).toBe("ta");
    expect(report.results[0]!.composite).toBeGreaterThan(report.results[1]!.composite ?? -Infinity);
    const failed = report.results.find((row) => row.id === "boom");
    // The provider's own words, not a fixed sentence: "any failure keeps
    // its reason" has to reach the result.
    expect(failed?.error).toContain("the model refused");
    expect(failed?.error).not.toBe(copy("zh", "eval.audition.failed"));
    expect(failed?.failedCases).toBe(2);
    expect(failed?.attemptedCases).toBe(2);
    expect(failed?.composite).toBeUndefined();
    expect(report.calls).toBe(6);
    expect(report.cases).toBe(2);
  });

  it("reports a candidate that could not answer most cases instead of ranking it", async () => {
    const taLine = fixtureTaLine();
    // Ten cases the in-character model answers every time. The broken
    // provider is unreachable for eight of them — it can only answer
    // the two calls that happen to get through. Before the fix those
    // two scored cases were enough for it to be ranked on.
    const tenCases = Array.from({ length: 10 }, () => cases()[0]!);
    let brokenCalls = 0;
    const report = await runAudition({
      persona: persona(),
      userId: 1,
      cases: tenCases,
      trainingTexts: [taLine],
      providers: [
        {
          id: "steady",
          providerName: "steady",
          model: "voice",
          provider: stubProvider("steady", async () => taLine),
        },
        {
          id: "broken",
          providerName: "broken",
          model: "none",
          provider: stubProvider("broken", async () => {
            brokenCalls += 1;
            if (brokenCalls <= 2) return taLine;
            throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
          }),
        },
      ],
    });

    const failed = report.results.find((row) => row.id === "broken");
    expect(failed?.error).toContain("ECONNREFUSED");
    expect(failed?.failedCases).toBe(8);
    expect(failed?.attemptedCases).toBe(10);
    expect(failed?.composite).toBeUndefined();
    expect(report.results[0]!.id).toBe("steady");
  });

  it("keeps a partially failed candidate's score and carries why the calls failed", async () => {
    const taLine = fixtureTaLine();
    // Two failures out of ten is under the max rate, so the candidate
    // is ranked — and the row has to say which calls did not answer.
    // The UI used to hide the composite and replace it with a fixed
    // sentence for exactly these rows.
    const tenCases = Array.from({ length: 10 }, () => cases()[0]!);
    let flakyCalls = 0;
    const report = await runAudition({
      persona: persona(),
      userId: 1,
      cases: tenCases,
      trainingTexts: [taLine],
      providers: [
        {
          id: "steady",
          providerName: "steady",
          model: "voice",
          provider: stubProvider("steady", async () => taLine),
        },
        {
          id: "flaky",
          providerName: "flaky",
          model: "voice",
          provider: stubProvider("flaky", async () => {
            flakyCalls += 1;
            if (flakyCalls <= 2) throw new Error(`connect ECONNREFUSED call ${flakyCalls}`);
            return taLine;
          }),
        },
      ],
    });

    const flaky = report.results.find((row) => row.id === "flaky");
    expect(flaky?.failedCases).toBe(2);
    expect(flaky?.attemptedCases).toBe(10);
    // Still ranked: the score is there and the row is not an error row.
    expect(flaky?.composite).toBeTypeOf("number");
    expect(flaky?.error).toBeUndefined();
    // The provider's own words, which the row now carries.
    expect(flaky?.failureReasons).toEqual([
      "connect ECONNREFUSED call 1",
      "connect ECONNREFUSED call 2",
    ]);
    // A candidate that answered every case carries none.
    expect(report.results.find((row) => row.id === "steady")?.failureReasons).toBeUndefined();
  });

  it("keeps at most two failure reasons on a ranked candidate", async () => {
    const taLine = fixtureTaLine();
    const tenCases = Array.from({ length: 10 }, () => cases()[0]!);
    let calls = 0;
    const report = await runAudition({
      persona: persona(),
      userId: 1,
      cases: tenCases,
      trainingTexts: [taLine],
      providers: [
        {
          id: "flaky",
          providerName: "flaky",
          model: "voice",
          provider: stubProvider("flaky", async () => {
            calls += 1;
            if (calls <= 4) throw new Error(`refused call ${calls}`);
            return taLine;
          }),
        },
      ],
    });

    const flaky = report.results.find((row) => row.id === "flaky");
    // Four of ten is still under the max rate: ranked, not an error row.
    expect(flaky?.composite).toBeTypeOf("number");
    expect(flaky?.failedCases).toBe(4);
    expect(flaky?.failureReasons).toHaveLength(2);
    expect(flaky?.failureReasons?.[0]).toContain("refused call 1");
  });
});
