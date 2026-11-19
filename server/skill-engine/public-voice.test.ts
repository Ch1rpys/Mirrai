import { describe, expect, it, vi, beforeEach } from "vitest";

const iterateRecords = vi.fn();

vi.mock("../db", () => ({
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
}));

import { distillPublicVoice, readPublicPosts } from "./public-voice";

describe("the public voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function posts(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      role: "assistant",
      kind: "text",
      content: `公开动态 ${i}`,
    }));
  }

  it("reads only the public text the persona wrote", async () => {
    iterateRecords.mockImplementation(async function* () {
      yield* posts(21);
    });
    const read = await readPublicPosts(5, 1);
    expect(read).toHaveLength(21);
    expect(iterateRecords).toHaveBeenCalledWith(5, 1, { register: "public" });
  });

  it("needs twenty posts and caps the description at 300 characters", async () => {
    iterateRecords.mockImplementation(async function* () {
      yield* posts(20);
    });
    const invoke = vi.fn().mockResolvedValue("长".repeat(400));
    const voice = await distillPublicVoice({ personaId: 5, userId: 1, name: "小满", locale: "zh", invoke });
    expect(voice).toHaveLength(300);
    expect(invoke).toHaveBeenCalledTimes(1);
    const messages = invoke.mock.calls[0]![0] as any[];
    expect(messages[0].content).toContain("不超过 300 字");
    expect(messages[1].content).toContain("MATERIAL>>>:");
  });

  it("does not call the model with fewer than twenty posts", async () => {
    iterateRecords.mockImplementation(async function* () {
      yield* posts(19);
    });
    const invoke = vi.fn();
    expect(
      await distillPublicVoice({ personaId: 5, userId: 1, name: "小满", locale: "zh", invoke }),
    ).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
