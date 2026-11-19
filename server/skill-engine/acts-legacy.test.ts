import { describe, expect, it, vi } from "vitest";

const invokeWithProvider = vi.fn();

vi.mock("../llm", () => ({
  llmService: {
    invoke: vi.fn(),
    invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
  },
  invokeForUser: vi.fn(),
  invokeForUserWithReason: vi.fn(),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: vi.fn(async () => ({
    name: "stub",
    capabilities: { streaming: false, vision: false, tools: false, jsonMode: true },
  })),
}));

import { buildActProfile } from "./acts";

function messages(count: number) {
  const start = Date.parse("2022-03-01T12:00:00.000Z");
  const rows: Array<{
    role: string;
    content: string;
    timestamp: Date;
    kind: "text";
    act?: string | null;
    emotion?: string | null;
  }> = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      role: "user",
      content: `今天天气不错 ${i}`,
      timestamp: new Date(start + i * 120_000),
      kind: "text",
    });
    rows.push({
      role: "assistant",
      content: `风有点大 ${i}`,
      timestamp: new Date(start + i * 120_000 + 30_000),
      kind: "text",
    });
  }
  return rows;
}

describe("the upload-only act profile", () => {
  it("labels up to eighty replies with the old model call and keeps the warm bucket", async () => {
    invokeWithProvider.mockResolvedValue(
      JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ i, act: "share" }))),
    );
    const profile = await buildActProfile({ messages: messages(50), userId: 1, legacy: true });
    expect(profile?.samples).toBe(50);
    expect(profile?.buckets[0]?.emotion).toBe("warm");
    expect(invokeWithProvider).toHaveBeenCalledTimes(1);
  });

  it("does not leave a labelled record profile to guess on its own", async () => {
    invokeWithProvider.mockClear();
    const profile = await buildActProfile({ messages: messages(50), userId: 1 });
    expect(profile).toBeNull();
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });
});
