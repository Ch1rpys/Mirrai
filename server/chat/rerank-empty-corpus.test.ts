import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../llm/types";

const iterateRecords = vi.fn();
const getRecordsVersion = vi.fn();
const getCollectedMessagesForPersona = vi.fn();

vi.mock("../db", () => ({
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
}));

const invokeWithProvider = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
}));

import { executePlan, type TurnPlan } from "./generate";

const stubProvider: LLMProvider = {
  name: "stub",
  capabilities: { streaming: false, vision: false, tools: false, jsonMode: false },
  isConfigured: () => true,
  invoke: async () => "",
};

function plan(): TurnPlan {
  return {
    kind: "model",
    sampledAct: null,
    messages: [{ role: "user", content: "在吗" }],
    layersUsed: ["rules", "imperfection", "suppressions", "act", "exemplars", "rerank"],
    exemplarIds: [],
    seedRecordIds: [],
    recalled: [],
    rng: () => 0.5,
  };
}

describe("rerank with an empty corpus", () => {
  beforeEach(() => {
    iterateRecords.mockReset();
    getRecordsVersion.mockReset();
    getCollectedMessagesForPersona.mockReset();
    invokeWithProvider.mockReset();
    iterateRecords.mockImplementation(async function* () {
      /* no rows */
    });
    getRecordsVersion.mockResolvedValue("0:0");
    getCollectedMessagesForPersona.mockResolvedValue([]);
    invokeWithProvider.mockResolvedValue("好");
  });

  it("asks the model once when the switch is on and there are no lines", async () => {
    const persona = {
      id: 1,
      userId: 1,
      name: "小A",
      rerankEnabled: true,
      personaData: null,
      styleProfile: null,
    };
    const input = {
      persona: persona as never,
      userId: 1,
      userMessage: "在吗",
      history: [],
      now: new Date("2026-01-15T12:00:00Z"),
      locale: "zh" as const,
      seed: "rerank:empty",
    };
    for await (const _ of executePlan(plan(), input, {
      provider: stubProvider,
      mode: "once",
      rerank: true,
      options: {},
    })) {
      /* drain */
    }
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });
});
