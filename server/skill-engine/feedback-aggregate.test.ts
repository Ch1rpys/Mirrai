import { describe, expect, it } from "vitest";
import {
  aggregateFidelityFeedback,
  confirmedSuppressionFromUnlike,
  inventedMemoryDraft,
  sampledActFromMetadata,
} from "./feedback-aggregate";

describe("feeding unlike marks back", () => {
  it("turns word/ask/complete into subtraction candidates that point at the message", () => {
    const candidates = aggregateFidelityFeedback({
      rows: [
        { id: 1, messageId: 9, reason: "word" },
        { id: 2, messageId: 10, reason: "mood" },
      ],
    });
    const word = candidates.find((row) => row.reason === "word");
    expect(word?.kind).toBe("suppression");
    expect(word?.messageId).toBe(9);
    expect(candidates.find((row) => row.reason === "mood")?.kind).toBe("display");
  });

  it("does not revive a key the user refused", () => {
    const candidates = aggregateFidelityFeedback({
      rows: [{ id: 1, messageId: 9, reason: "ask" }],
      rejectedKeys: ["ask:9"],
    });
    expect(candidates).toEqual([]);
  });

  it("does not revive a key that was confirmed into a rule", () => {
    const candidates = aggregateFidelityFeedback({
      rows: [{ id: 1, messageId: 9, reason: "word" }],
      rejectedKeys: ["word:9"],
    });
    expect(candidates).toEqual([]);
  });

  it("writes a verified subtraction from the reply itself", () => {
    const rule = confirmedSuppressionFromUnlike({
      key: "word:9",
      reason: "word",
      snippet: "你好吗？我们一起加油吧",
    });
    expect(rule?.verified).toBe(true);
    expect(rule?.source).toBe("manual");
    expect(rule?.kind).toBe("no_word_class");
    expect(rule?.pattern).toBe("你好吗？我们一起加油吧");
    expect(confirmedSuppressionFromUnlike({ key: "mood:1", reason: "mood", snippet: "x" })).toBeNull();
  });

  it("turns an invented reply into a later-written memory draft", () => {
    const draft = inventedMemoryDraft("我们去年夏天去了那家店");
    expect(draft.title).toBe("我们去年夏天去了那家店");
    expect(draft.factKey.length).toBeGreaterThan(0);
    expect(draft.description).toContain("那家店");
  });

  it("keeps a rewrite as evidence on the candidate", () => {
    const candidates = aggregateFidelityFeedback({
      rows: [{ id: 1, messageId: 9, reason: "word", rewrite: "那才像" }],
    });
    expect(candidates[0]?.rewrite).toBe("那才像");
    expect(candidates[0]?.suppression?.evidence?.some((row) => row.snippet === "那才像")).toBe(true);
  });

  it("reads the sampled act off the message", () => {
    expect(sampledActFromMetadata({ sampledAct: "tease" })).toBe("tease");
    expect(sampledActFromMetadata({ sampledAct: "nope" })).toBeNull();
  });
});
