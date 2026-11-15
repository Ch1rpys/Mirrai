import { describe, expect, it } from "vitest";
import { pickRerankWinner } from "./rerank";

describe("picking among four lines", () => {
  it("drops the one that copied an exemplar", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "今天真的好开心呀" },
        { text: "还行" },
        { text: "嗯" },
        { text: "在" },
      ],
      trainingTexts: ["嗯", "在", "还行", "随便", "好", "行", "哦", "嗯嗯"],
      exemplars: ["今天真的好开心呀"],
    });
    expect(result?.text).not.toBe("今天真的好开心呀");
    expect(result?.scores.find((row) => row.text === "今天真的好开心呀")?.discarded).toBe("exemplar");
  });

  it("does not pick the longest complete line when they write short", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "我完全理解你现在的感受，我们可以一步一步来，先深呼吸，然后把今天的事情列成三条。" },
        { text: "嗯" },
        { text: "在" },
        { text: "哦" },
      ],
      trainingTexts: ["嗯", "在", "哦", "好", "行", "随便", "嗯嗯", "还行"],
    });
    expect(result?.text.length ?? 99).toBeLessThan(10);
  });

  it("prefers a short line near their median over a likelier long one", () => {
    const result = pickRerankWinner({
      candidates: [
        { text: "嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯嗯" },
        { text: "嗯" },
        { text: "在呢" },
        { text: "好" },
      ],
      trainingTexts: ["嗯", "好", "在", "哦", "行", "嗯嗯", "随便", "还行"],
    });
    expect((result?.text.length ?? 99) <= 4).toBe(true);
  });
});
