import { describe, expect, it, vi } from "vitest";
import { LLMService, registry } from "./index";
import { ProviderRegistry } from "./provider-registry";
import type { LLMProvider } from "./types";

describe("LLMService retry policy", () => {
  it("honors a provider's single-attempt policy", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("HTTP 503"));
    const provider: LLMProvider = {
      name: "Atlas",
      maxAttempts: 1,
      capabilities: {
        streaming: false,
        vision: false,
        tools: false,
        jsonMode: false,
      },
      isConfigured: () => true,
      invoke,
    };
    const reg = new ProviderRegistry();
    reg.register(provider);
    reg.setDefault("atlas");

    const service = new LLMService(reg);

    await expect(service.invoke({ messages: [] })).rejects.toThrow("HTTP 503");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("LLM provider registration", () => {
  it("registers Groq with its default endpoint and model", () => {
    const entry = registry.getEntry("groq");
    expect(entry).toBeDefined();
    const instance = entry!.entry.factory({
      apiKey: "test-groq-key",
    });
    expect(instance.name).toBe("Groq");
    expect(instance.isConfigured()).toBe(true);
  });

  it("registers Mistral with its default endpoint and model", () => {
    const entry = registry.getEntry("mistral");
    expect(entry).toBeDefined();
    const instance = entry!.entry.factory({
      apiKey: "test-mistral-key",
    });
    expect(instance.name).toBe("Mistral");
    expect(instance.isConfigured()).toBe(true);
  });
});
