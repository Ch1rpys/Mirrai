import { describe, expect, it } from "vitest";
import { measureUserSide, type UserSideRecord } from "./user-side-profile";

/**
 * i18n:allow-input — fixture lines, not copy the app writes.
 */
function fixture(userCount: number): UserSideRecord[] {
  const start = Date.parse("2022-03-01T12:00:00.000Z");
  const rows: UserSideRecord[] = [];
  for (let i = 0; i < userCount; i++) {
    rows.push({
      role: "assistant",
      content: "在的呀",
      timestamp: new Date(start + i * 120_000),
      kind: "text",
    });
    rows.push({
      role: "user",
      content: `user-line-${String(i).padStart(2, "0")}-xxxxxxxx`,
      timestamp: new Date(start + i * 120_000 + 30_000),
      kind: "text",
      act: i % 2 === 0 ? "ask" : "acknowledge",
    });
  }
  return rows;
}

describe("measureUserSide", () => {
  it("counts the user's text lines and picks twelve of their quotes", () => {
    const rows = fixture(48);
    const userLines = rows.filter((row) => row.role === "user").map((row) => row.content);
    const profile = measureUserSide(rows);
    expect(profile).not.toBeNull();
    expect(profile?.samples).toBe(userLines.length);
    expect(profile?.sampleLines).toHaveLength(12);
    for (const line of profile?.sampleLines ?? []) {
      expect(userLines).toContain(line);
    }
  });

  it("returns null when there are fewer than forty user text lines", () => {
    expect(measureUserSide(fixture(39))).toBeNull();
  });
});
