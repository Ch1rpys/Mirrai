import { describe, expect, it, vi } from "vitest";

/**
 * The semantic search has to distinguish "the local model is down"
 * from "nothing similar was found" (C8.6). The caller shows a line
 * explaining that only the literal search ran; an empty list would
 * claim the records do not contain anything like it.
 */
vi.mock("./chat/embeddings", () => ({
  embedTexts: async () => null,
  embedModelName: () => "fake-model",
  cosine: () => 0,
  dequantizeInt8: () => [],
}));

import { searchRecordsSemantic } from "./db";

describe("semantic search without an embedding model", () => {
  it("returns null, not an empty list", async () => {
    await expect(searchRecordsSemantic(1, 1, { q: "沙滩" })).resolves.toBeNull();
  });
});
