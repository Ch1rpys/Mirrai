import { describe, expect, it } from "vitest";
import { normalizeStyleProfile } from "./style-profile";

describe("the style profile", () => {
  it("fills the identity fields from an empty value", () => {
    expect(normalizeStyleProfile(null)).toEqual({
      version: 1,
      measuredAt: "",
      recordsVersion: "",
    });
  });

  it("drops unknown keys and keeps a measurement that is present", () => {
    const profile = normalizeStyleProfile({
      version: 1,
      measuredAt: "2026-01-15T12:00:00.000Z",
      recordsVersion: "12:40",
      extra: true,
      fingerprint: { tokens: 3 },
    });
    expect(profile).not.toHaveProperty("extra");
    expect(profile.fingerprint).toEqual({ tokens: 3 });
    expect(profile.recordsVersion).toBe("12:40");
  });
});
