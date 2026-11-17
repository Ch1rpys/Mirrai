import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./persona-utils";
import { copy } from "@shared/copy";

/**
 * Whether the replica is told not to repeat hurtful lines.
 *
 * The sentence sits with the hard rules, outside the material fence.
 * A persona whose user chose to keep those lines is not told this.
 * A persona with no report is unchanged.
 */

const instruction = copy("zh", "prompt.harmDoNotRepeat");

function persona(harmReport?: unknown) {
  return {
    id: 1,
    userId: 1,
    name: "小A",
    emotionalState: "warm",
    timezone: "Asia/Shanghai",
    relationshipDesc: "朋友",
    togetherFrom: "2021-06-15",
    togetherTo: null,
    personaData: {
      personality: "温柔",
      speakingStyle: "慢慢说",
      ...(harmReport ? { harmReport } : {}),
    },
  } as any;
}

const pending = {
  categories: [{ kind: "belittle" as const, count: 5, examples: [1, 2, 3] }],
  decision: "pending" as const,
};

describe("the harm instruction in the prompt", () => {
  it("sits after the hard rules and outside the fence when pending", () => {
    const prompt = buildSystemPrompt(persona(pending), { locale: "zh" });
    expect(prompt).toContain(instruction);
    const at = prompt.indexOf(instruction);
    expect(at).toBeGreaterThan(prompt.indexOf(copy("zh", "prompt.hardRules")));
    expect(at).toBeLessThan(prompt.indexOf(copy("zh", "prompt.materialIsData")));
    const fenced = [...prompt.matchAll(/MATERIAL>>>:[^\n]*\n([\s\S]*?)<<<MATERIAL/g)];
    for (const match of fenced) {
      expect(match[1]).not.toContain(instruction);
    }
  });

  it("is omitted when the user chose to keep the lines", () => {
    const prompt = buildSystemPrompt(
      persona({ ...pending, decision: "keep" }),
      { locale: "zh" },
    );
    expect(prompt).not.toContain(instruction);
  });

  it("is omitted when there is no report", () => {
    const prompt = buildSystemPrompt(persona(), { locale: "zh" });
    expect(prompt).not.toContain(instruction);
  });
});
