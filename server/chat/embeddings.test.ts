import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveExemplars } from "./exemplars";
import {
  cosine,
  dequantizeInt8,
  embedTexts,
  l2Normalize,
  quantizeInt8,
} from "./embeddings";

const records = [
  { id: 1, role: "user" as const, content: "沙滩那边风好大" },
  { id: 2, role: "assistant" as const, content: "那不去了" },
  { id: 3, role: "user" as const, content: "今晚吃什么" },
  { id: 4, role: "assistant" as const, content: "随便，你定" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local embeddings", () => {
  it("returns null when Ollama is unreachable, and retrieval matches the literal path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    expect(await embedTexts(["海边"])).toBeNull();
    const without = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
    });
    const withEmbed = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
      embedCosine: () => null,
    });
    expect(withEmbed).toEqual(without);
  });

  it("retrieves a turn whose previous user line is close in the fake embed space", () => {
    const found = retrieveExemplars({
      userMessage: "海边",
      records,
      minScore: 0.05,
      embedCosine: (previousUser) => {
        if (previousUser.includes("沙滩") || previousUser.includes("海边")) return 0.92;
        return 0;
      },
    });
    expect(found.some((item) => item.previousUser.includes("沙滩"))).toBe(true);
  });

  it("round-trips a unit vector through int8 with cosine error below 0.02", () => {
    const raw = Array.from({ length: 64 }, (_, i) => Math.sin(i + 0.3));
    const unit = l2Normalize(raw);
    const restored = dequantizeInt8(quantizeInt8(unit));
    expect(1 - cosine(unit, restored)).toBeLessThan(0.02);
  });
});
