import { describe, expect, it } from "vitest";
import { buildEvalCases } from "./dataset";
import { labelEvalCases } from "./act-labels";

describe("caching an act on a held-out line", () => {
  it("keeps a rule label and does not invent a second one", async () => {
    const cases = buildEvalCases([
      { role: "user", content: "在吗", timestamp: null },
      { role: "assistant", content: "嗯嗯", timestamp: null },
      { role: "user", content: "还在吗", timestamp: null },
      { role: "assistant", content: "嗯", timestamp: null },
    ]);
    const labelled = await labelEvalCases(cases, { userId: 1, locale: "zh" });
    const hmm = labelled.find((item) => item.expected.content === "嗯嗯");
    expect(hmm?.expectedAct).toBe("acknowledge");
    expect(hmm?.expectedActSource).toBe("rule");
  });
});
