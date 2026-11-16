import { describe, expect, it } from "vitest";
import { buildActProfile } from "./acts";

describe("buildActProfile", () => {
  it("does not count sticker rows toward the sample floor", async () => {
    const messages = [
      ...Array.from({ length: 10 }, () => ({ role: "assistant", content: "嗯", kind: "text" as const })),
      ...Array.from({ length: 40 }, () => ({
        role: "assistant",
        content: "[sticker:狗狗探头]",
        kind: "sticker" as const,
      })),
    ];
    expect(await buildActProfile({ messages, userId: 1 })).toBeNull();
  });
});
