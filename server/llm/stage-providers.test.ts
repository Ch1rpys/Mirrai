import { describe, expect, it, vi, beforeEach } from "vitest";

const resolveProviderForUser = vi.fn();

vi.mock("./user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

import { resolveStageProviders } from "./stage-providers";
import type { LLMProvider } from "./types";

function stub(name: string): LLMProvider {
  return {
    name,
    capabilities: { streaming: false, vision: false, tools: false, jsonMode: false },
    isConfigured: () => true,
    invoke: async () => "",
  };
}

describe("resolveStageProviders", () => {
  const fallback = stub("default-llm");

  beforeEach(() => {
    resolveProviderForUser.mockReset();
    resolveProviderForUser.mockImplementation(async ({ providerName }: { providerName?: string }) =>
      stub(providerName ?? "default-llm"),
    );
  });

  it("uses the fallback when planner and voice are unset", async () => {
    const stages = await resolveStageProviders({
      userId: 1,
      fallback,
      personaProviderName: "default-llm",
      settings: {},
    });
    expect(stages.planner).toBe(fallback);
    expect(stages.voice).toBe(fallback);
    expect(resolveProviderForUser).not.toHaveBeenCalled();
  });

  it("resolves planner and voice when they differ from the persona provider", async () => {
    const stages = await resolveStageProviders({
      userId: 1,
      fallback,
      personaProviderName: "default-llm",
      settings: { providers: { planner: "planner-llm", voice: "voice-llm" } },
    });
    expect(stages.planner.name).toBe("planner-llm");
    expect(stages.voice.name).toBe("voice-llm");
    expect(resolveProviderForUser).toHaveBeenCalledWith({ userId: 1, providerName: "planner-llm" });
    expect(resolveProviderForUser).toHaveBeenCalledWith({ userId: 1, providerName: "voice-llm" });
  });

  it("keeps the fallback when the named provider cannot be resolved", async () => {
    resolveProviderForUser.mockResolvedValue(undefined);
    const stages = await resolveStageProviders({
      userId: 1,
      fallback,
      settings: { providers: { planner: "missing-llm" } },
    });
    expect(stages.planner).toBe(fallback);
  });
});
