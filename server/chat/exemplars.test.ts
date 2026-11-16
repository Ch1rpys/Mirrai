import { describe, expect, it } from "vitest";
import { retrieveExemplars, truncateExemplar } from "./exemplars";

const records = [
  { id: 1, role: "user", content: "今晚吃什么" },
  { id: 2, role: "assistant", content: "随便，你定" },
  { id: 3, role: "user", content: "那家店叫什么来着" },
  { id: 4, role: "assistant", content: "老地方那家面" },
  { id: 5, role: "user", content: "你好吗" },
  { id: 6, role: "assistant", content: "还行" },
];

describe("retrieving past replies", () => {
  it("returns nothing when nothing is close enough", () => {
    const found = retrieveExemplars({
      userMessage: "quantum chromodynamics",
      records,
      minScore: 0.4,
    });
    expect(found).toEqual([]);
  });

  it("finds the reply that followed a similar user line", () => {
    const found = retrieveExemplars({
      userMessage: "那家店叫什么",
      records,
      minScore: 0.05,
    });
    expect(found.some((item) => item.content.includes("老地方"))).toBe(true);
  });

  it("excludes a held-out id", () => {
    const found = retrieveExemplars({
      userMessage: "那家店叫什么",
      records,
      excludeIds: [4],
      minScore: 0.05,
    });
    expect(found.every((item) => item.id !== 4)).toBe(true);
  });

  it("cuts a line to one and a half of their median", () => {
    expect(truncateExemplar("abcdefghij", 4).length).toBeLessThanOrEqual(6);
  });

  it("does not retrieve a sticker as a past reply", () => {
    const found = retrieveExemplars({
      userMessage: "今晚吃什么",
      records: [
        ...records,
        { id: 7, role: "user", content: "今晚吃什么", kind: "text" },
        { id: 8, role: "assistant", content: "[sticker:狗狗探头]", kind: "sticker" },
      ],
      minScore: 0.05,
    });
    expect(found.every((item) => !item.content.startsWith("[sticker:"))).toBe(true);
  });
});
