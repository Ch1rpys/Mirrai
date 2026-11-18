import { describe, expect, it } from "vitest";
import { relationshipIsOver } from "./relationship-ended";

describe("relationshipIsOver", () => {
  it("is true when there is an end date, or the phase is breakup or apart", () => {
    expect(relationshipIsOver("2024-01-01", null)).toBe(true);
    expect(relationshipIsOver("  ", "breakup")).toBe(true);
    expect(relationshipIsOver(null, "apart")).toBe(true);
    expect(relationshipIsOver(null, "together")).toBe(false);
    expect(relationshipIsOver("", null)).toBe(false);
  });
});
