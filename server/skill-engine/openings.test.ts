import { describe, expect, it } from "vitest";
import { buildOpeningProfile, firstWordLines, labelOpening } from "./openings";

describe("first-word openings", () => {
  it("labels a short line as a fragment", () => {
    expect(labelOpening("在吗")).toBe("fragment");
    expect(labelOpening("嗯")).toBe("fragment");
    expect(labelOpening("吃了吗今天晚上还出门")).toBe("checkin");
  });

  it("counts only their own first words", () => {
    const now = new Date("2026-01-02T12:00:00Z");
    const later = new Date("2026-01-03T12:00:00Z");
    const lines = firstWordLines([
      { role: "assistant", content: "早", timestamp: now },
      { role: "user", content: "早", timestamp: now },
      { role: "assistant", content: "嗯嗯", timestamp: now },
      { role: "assistant", content: "想你了", timestamp: later },
    ]);
    expect(lines).toEqual(["早", "想你了"]);
  });

  it("does not build a distribution from fewer than fifteen first words", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "assistant" as const,
      content: `早${i}`,
      timestamp: new Date(Date.UTC(2026, 0, i + 1)),
    }));
    const profile = buildOpeningProfile({ messages, exchangesCounted: 20, spokeFirstCount: 10 });
    expect(profile).not.toBeNull();
    expect(profile?.samples).toBe(10);
    expect(profile?.counts).toEqual({});
    expect(profile?.rate).toBe(0.5);
  });

  it("leaves the rate uncounted when nobody has counted exchanges", () => {
    const profile = buildOpeningProfile({
      messages: [{ role: "assistant", content: "早", timestamp: new Date() }],
    });
    expect(profile?.rate).toBeNull();
  });
});
