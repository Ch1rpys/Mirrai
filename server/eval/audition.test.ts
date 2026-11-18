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
    expect(failed?.error).toBe(copy("zh", "eval.audition.failed"));
    expect(failed?.composite).toBeUndefined();
    expect(report.calls).toBe(6);
    expect(report.cases).toBe(2);
  });
});
