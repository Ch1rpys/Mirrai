import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "@shared/copy";

const invoke = vi.fn();
const resolveProviderForUserWithOwnership = vi.fn();

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUserWithOwnership: (...args: unknown[]) =>
    resolveProviderForUserWithOwnership(...args),
}));

vi.mock("../llm", () => ({
  llmService: {
    invoke: (...args: unknown[]) => invoke(...args),
  },
}));

import { completeUnfinishedLine } from "./unsaid";

function persona(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小满",
    relationshipDesc: "朋友",
    togetherFrom: "2022-03-01",
    togetherTo: null,
    emotionalState: "warm",
    llmProvider: null,
    personaData: { personality: "安静", speakingStyle: "短句" },
    ...overrides,
  } as any;
}

describe("finishing an unfinished line (C6.5)", () => {
  beforeEach(() => {
    invoke.mockReset();
    resolveProviderForUserWithOwnership.mockReset();
    resolveProviderForUserWithOwnership.mockResolvedValue({ provider: null, owned: false });
  });

  it("puts the guard in the instruction area, and the line inside the fence", async () => {
    invoke.mockResolvedValue("那下次一起去吧");
    const result = await completeUnfinishedLine({
      persona: persona(),
      userId: 1,
      line: "下次带你去吃那家面",
      context: ["你上次说的那家店还开着吗", "开着"],
    });

    expect(result).toBe("那下次一起去吧");
    const [request] = invoke.mock.calls[0];
    const system = request.messages[0].content as string;
    const user = request.messages[1].content as string;

    expect(system).toContain(copy("zh", "prompt.unsaidGuard", { name: "小满" }));
    // The guard is an application instruction: it sits before the first
    // block of material, not inside it.
    expect(system.indexOf(copy("zh", "prompt.unsaidGuard", { name: "小满" }))).toBeLessThan(
      system.indexOf("<persona_data>"),
    );
    // The record line is material, in the user message's fence.
    const outsideFence = user.split("MATERIAL>>>")[0];
    expect(outsideFence).not.toContain("下次带你去吃那家面");
    expect(user).toContain("下次带你去吃那家面");
    expect(request.options.purpose).toBe("reply");
  });

  it("drops a line that makes a promise or a decision for the real person", async () => {
    invoke.mockResolvedValue("我原谅你，我们和好吧");
    const result = await completeUnfinishedLine({
      persona: persona(),
      userId: 1,
      line: "算了",
    });
    expect(result).toBeNull();
  });

  it("returns null when no model answers", async () => {
    invoke.mockRejectedValue(new Error("no provider"));
    expect(
      await completeUnfinishedLine({
        persona: persona(),
        userId: 1,
        line: "算了",
      }),
    ).toBeNull();
  });
});
