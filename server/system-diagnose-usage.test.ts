import { describe, expect, it, vi } from "vitest";

/**
 * A diagnosis calls the user's model once per provider (C8.12). That
 * call used to be invisible to the usage ledger, so one-click diagnosis
 * spent tokens the cost panel never saw (C8.9).
 */

const invokeWithProvider = vi.fn();

vi.mock("./llm", () => ({
  llmService: {
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
  registry: {
    list: () => [{ name: "fake", configured: true }],
    get: () => ({
      name: "fake",
      capabilities: { streaming: true, vision: false },
    }),
  },
}));

vi.mock("./llm/user-provider", () => ({
  buildUserProvider: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLlmConfigsByUserId: async () => [],
}));

import { createDiagnoseDeps } from "./system/diagnose-deps";

describe("the diagnosis probe and the usage ledger (C8.9)", () => {
  it("records the probe as a call by the user", async () => {
    invokeWithProvider.mockResolvedValue("pong");
    const deps = createDiagnoseDeps(42);
    const probes = await deps.listProviders();
    expect(probes).toHaveLength(1);
    await probes[0]!.request(new AbortController().signal);
    expect(invokeWithProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fake" }),
      expect.objectContaining({
        usage: { userId: 42 },
        options: expect.objectContaining({ purpose: "other", maxTokens: 1 }),
      }),
    );
  });
});
