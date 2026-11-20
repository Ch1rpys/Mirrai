import { describe, expect, it, vi } from "vitest";
import { cosine, packEmbedding } from "./chat/embeddings";
import { rankSemanticVectors } from "./db";

/**
 * The local embedding model is not available in this environment, so
 * the ranking is tested with vectors that stand in for it: the text
 * "沙滩" is embedded as one direction, "海边" near it. What is proved
 * is that a stored turn is found by meaning, not by its characters.
 */
const fakeEmbed = (text: string): number[] => {
  if (text.includes("沙滩")) return [1, 0];
  if (text.includes("海边")) return [0.94, 0.34];
  if (text.includes("股票")) return [0, 1];
  return [0.5, 0.5];
};
const dequantize = (vec: Uint8Array | Buffer) => Array.from(vec).map((n) => n / 127);

vi.mock("./chat/embeddings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  embedTexts: async (texts: string[]) => texts.map(fakeEmbed),
  embedModelName: () => "fake-model",
}));

describe("semantic ranking", () => {
  it("finds the turn about the seaside from a query about the beach", () => {
    const rows = [
      { recordId: 1, dim: 2, vec: packEmbedding(fakeEmbed("海边")) },
      { recordId: 2, dim: 2, vec: packEmbedding(fakeEmbed("股票")) },
      { recordId: 3, dim: 2, vec: packEmbedding([0, -1]) },
    ];
    const ranked = rankSemanticVectors(
      fakeEmbed("沙滩"),
      rows,
      cosine,
      dequantize,
      3,
    );
    expect(ranked[0]?.recordId).toBe(1);
    expect(ranked.map((hit) => hit.recordId)).not.toContain(2);
    expect(ranked.every((hit) => hit.score >= 0.55)).toBe(true);
  });
});
