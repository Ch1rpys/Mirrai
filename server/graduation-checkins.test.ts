import { describe, expect, it } from "vitest";
import { checkGraduationEligibility } from "./_core/persona-utils";

/**
 * The human veto on a machine suggestion (C4.2).
 *
 * "They seem ready" is the app's reading. "These talks leave me worse" is
 * the person's own report. When the two disagree, the person wins.
 */
const eligible = {
  intimacyLevel: "soulmate",
  recentEmotions: Array.from({ length: 10 }, () => ({ emotionalState: "warm" })),
  chatCount: 60,
  recentChatFrequency: 5,
  previousChatFrequency: 5,
  locale: "zh" as const,
};

describe("the graduation check and the after-chat answers", () => {
  it("does not suggest a goodbye after three worse conversations", () => {
    const result = checkGraduationEligibility({ ...eligible, worseStreak: 3 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("更难受");
  });

  it("lists every condition it uses, and all met iff eligible", () => {
    const met = checkGraduationEligibility(eligible);
    expect(met.conditions).toHaveLength(6);
    expect(met.conditions.every((condition) => condition.met)).toBe(true);
    expect(met.eligible).toBe(true);

    const vetoed = checkGraduationEligibility({ ...eligible, worseStreak: 3 });
    expect(vetoed.conditions).toHaveLength(6);
    expect(vetoed.conditions.find((condition) => condition.key === "checkinsWorse")?.met).toBe(false);
    expect(vetoed.conditions.filter((condition) => !condition.met)).toHaveLength(1);
    expect(vetoed.eligible).toBe(false);
  });

  it("leaves the ordinary decision alone when the answers are not three worse", () => {
    expect(checkGraduationEligibility({ ...eligible, worseStreak: 2 }).eligible).toBe(true);
    expect(checkGraduationEligibility(eligible).eligible).toBe(true);
  });
});
