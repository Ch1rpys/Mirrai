import { describe, expect, it } from "vitest";
import {
  activeSuppressions,
  normalizeSuppressions,
  renderSuppressions,
} from "./suppressions";

const confirmed = {
  id: "s1",
  pattern: "句末不问",
  kind: "no_question_ending" as const,
  confidence: 0.9,
  source: "manual" as const,
  verified: true,
  evidence: [{ snippet: "嗯" }],
};

const candidate = {
  ...confirmed,
  id: "s2",
  pattern: "我理解你",
  kind: "no_phrase" as const,
  source: "auto" as const,
  verified: false,
};

describe("subtraction rules", () => {
  it("treats a hand-written row as confirmed", () => {
    const rules = normalizeSuppressions([{ ...confirmed, verified: undefined, source: "manual" }]);
    expect(rules[0].verified).toBe(true);
  });

  it("keeps an automatic row unverified until it is", () => {
    const rules = normalizeSuppressions([candidate]);
    expect(rules[0].verified).toBe(false);
    expect(activeSuppressions(rules)).toEqual([]);
  });

  it("renders only the confirmed ones", () => {
    const text = renderSuppressions([confirmed, candidate], "zh");
    expect(text).toContain("不要以问句收尾");
    expect(text).not.toContain("我理解你");
  });

  it("renders a confirmed knowledge-boundary subtraction", () => {
    const text = renderSuppressions(
      [
        {
          id: "s4",
          pattern: "股票基金理财",
          kind: "knowledge_boundary",
          confidence: 0.7,
          source: "auto",
          verified: true,
          evidence: [],
        },
      ],
      "zh",
    );
    expect(text).toContain("你不懂这类话题");
    expect(text).toContain("股票基金理财");
  });

  it("renders a confirmed multi-point subtraction", () => {
    const text = renderSuppressions(
      [
        {
          id: "s3",
          pattern: "通常接最后一件",
          kind: "multi_point",
          confidence: 0.7,
          source: "auto",
          verified: true,
          evidence: [],
        },
      ],
      "zh",
    );
    expect(text).toContain("只接其中一件");
    expect(text).toContain("通常接最后一件");
  });

  it("drops a row with no pattern and a row of an unknown kind", () => {
    expect(normalizeSuppressions([{ kind: "no_advice" }, { pattern: "x", kind: "yell" }])).toEqual([]);
  });
});
