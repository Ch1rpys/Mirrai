import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTextRecord } from "@shared/records";
import { measureFingerprint } from "@shared/style-fingerprint";
import { copy } from "@shared/copy";
import { buildXiaomanRecords } from "../test-fixtures/xiaoman";
import type { LLMMessage, LLMProvider } from "../llm/types";
import type { EvalCaseData } from "./dataset";
import * as db from "../db";

const buildPromptForPersona = vi.fn();

vi.mock("../chat/prompt", () => ({
  buildPromptForPersona: (...a: unknown[]) => buildPromptForPersona(...a),
  buildPromptBundleForPersona: async (...a: unknown[]) => {
    const prompt = await buildPromptForPersona(...a);
    return typeof prompt === "string" ? { prompt } : prompt;
  },
}));

import {
  DriftNeedUserSideError,
  DRIFT_TURNS_DEFAULT,
  runDrift,
  simUserSystemPrompt,
  windowSlope,
} from "./drift";

const UNIQUE_USER_LINE = "这是一句只有我会说的话";

const LONG_LINE =
  "这是一句很长很长的话，用来测量分身有没有漂走。这是一句很长很长的话，用来测量分身有没有漂走。这是一句很长很长的话，用来测量分身有没有漂走。你还在吗？";

function fixtureTaLines(): string[] {
  return buildXiaomanRecords()
    .filter((row) => row.role === "assistant" && isTextRecord(row) && row.content.trim())
    .map((row) => row.content.trim());
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
      userSide: {
        samples: 48,
        sampleLines: [UNIQUE_USER_LINE, "在吗", "今天好累"],
      },
    },
  } as any;
}

function startCase(): EvalCaseData {
  return {
    context: [
      { role: "user", content: "在吗", timestamp: null },
      { role: "assistant", content: "在的", timestamp: null },
    ],
    expected: { role: "assistant", content: "嗯嗯", timestamp: null },
    expectedState: null,
  };
}

function messageText(messages: LLMMessage[]): string {
  return messages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n");
}

function isSimUserCall(messages: LLMMessage[]): boolean {
  const text = messageText(messages);
  return (
    text.includes(copy("zh", "prompts.eval.simUser")) ||
    text.includes(copy("en", "prompts.eval.simUser"))
  );
}

function stubProvider(invoke: LLMProvider["invoke"]): LLMProvider {
  return {
    name: "stub",
    capabilities: { streaming: false, vision: false, tools: false, jsonMode: false },
    isConfigured: () => true,
    invoke,
  };
}

const writeSpies: Array<{ name: string; spy: ReturnType<typeof vi.spyOn> }> = [];

beforeEach(() => {
  buildPromptForPersona.mockReset();
  buildPromptForPersona.mockResolvedValue("【系统】");
  writeSpies.length = 0;
  for (const name of Object.keys(db) as Array<keyof typeof db>) {
    const value = db[name];
    if (typeof value !== "function") continue;
    if (!/^(create|save|update|delete|set|insert|upsert|write)/i.test(String(name))) continue;
    /**
     * The cost ledger is not user data (C8.9).
     *
     * A drift run is fifty model calls, and each one writes a usage row.
     * What this list enforces is that the evaluation writes none of the
     * *content* it generates — no messages, no memories, no persona
     * changes. A ledger row records the call, not what was said.
     */
    if (String(name) === "insertLlmUsage") continue;
    writeSpies.push({ name: String(name), spy: vi.spyOn(db, name as never) });
  }
});

afterEach(() => {
  for (const { spy } of writeSpies) spy.mockRestore();
  writeSpies.length = 0;
});

function expectNoWrites() {
  for (const { name, spy } of writeSpies) {
    expect(spy, name).not.toHaveBeenCalled();
  }
}

describe("windowSlope", () => {
  it("is the least-squares slope against the window index", () => {
    expect(windowSlope([0, 1, 2, 3])).toBeCloseTo(1, 10);
    expect(windowSlope([4, 4, 4])).toBeCloseTo(0, 10);
    expect(windowSlope([1])).toBe(0);
  });
});

describe("the simulated user's prompt", () => {
  it("puts the sample lines inside the material fence", () => {
    const prompt = simUserSystemPrompt("zh", [UNIQUE_USER_LINE]);
    expect(prompt).toContain(UNIQUE_USER_LINE);
    expect(prompt).toContain(copy("zh", "prompts.eval.simUser"));
    const unfenced = prompt.replace(
      /MATERIAL>>>:[0-9a-f]+\n[\s\S]*?<<<END MATERIAL>>>:[0-9a-f]+/g,
      "",
    );
    expect(unfenced).not.toContain(UNIQUE_USER_LINE);
  });
});

function typicalTaLine(): string {
  const short = fixtureTaLines().find(
    (line) => Array.from(line).length <= 12 && !/[。？?！!]/.test(line),
  );
  expect(short).toBeTruthy();
  return short!;
}

describe("runDrift", () => {
  it("rises after twenty in-character turns, and does not write", async () => {
    const taLine = typicalTaLine();
    let personaCalls = 0;
    let sawFencedSample = false;
    const provider = stubProvider(async (messages) => {
      if (isSimUserCall(messages)) {
        const text = messageText(messages);
        expect(text).toContain(UNIQUE_USER_LINE);
        const unfenced = text.replace(
          /MATERIAL>>>:[0-9a-f]+\n[\s\S]*?<<<END MATERIAL>>>:[0-9a-f]+/g,
          "",
        );
        expect(unfenced).not.toContain(UNIQUE_USER_LINE);
        sawFencedSample = true;
        return "嗯";
      }
      personaCalls += 1;
      return personaCalls <= 20 ? taLine : LONG_LINE;
    });

    const report = await runDrift({
      persona: persona(),
      userId: 1,
      turns: DRIFT_TURNS_DEFAULT,
      startCase: startCase(),
      provider,
      seed: "drift-away",
    });

    expect(personaCalls).toBe(50);
    expect(sawFencedSample).toBe(true);
    expect(report.windows).toHaveLength(5);
    expect(report.slope).toBeGreaterThan(0);
    expect(report.firstWindowOver).toBe(2);
    expectNoWrites();
  });

  it("stays flat when every reply is one of theirs", async () => {
    const taLine = typicalTaLine();
    const provider = stubProvider(async (messages) => {
      if (isSimUserCall(messages)) return "嗯";
      return taLine;
    });

    const report = await runDrift({
      persona: persona(),
      userId: 1,
      turns: DRIFT_TURNS_DEFAULT,
      startCase: startCase(),
      provider,
      seed: "drift-flat",
    });

    expect(Math.abs(report.slope)).toBeLessThan(0.01);
    expect(report.firstWindowOver).toBeNull();
    expectNoWrites();
  });

  it("refuses a persona with no user-side lines", async () => {
    const bare = persona();
    bare.styleProfile.userSide = undefined;
    await expect(
      runDrift({
        persona: bare,
        userId: 1,
        startCase: startCase(),
        provider: stubProvider(async () => "嗯"),
        seed: "drift-none",
      }),
    ).rejects.toBeInstanceOf(DriftNeedUserSideError);
    expectNoWrites();
  });
});
