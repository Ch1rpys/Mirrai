import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The question after the conversation (C4.2).
 *
 * It is a question, so the tests are mostly about not asking it: not
 * while the conversation is still going, not two days later, not when
 * the session was too short, not twice for the same session, and not
 * twice in one day.
 */
const getSessionStartAt = vi.fn();
const getLastMessageAt = vi.fn();
const countUserMessagesSince = vi.fn();
const getSessionCheckin = vi.fn();
const countCheckinsSince = vi.fn();
const getUserTimezone = vi.fn();
const getRecentCheckinAnswers = vi.fn();
const getSafetyEvents = vi.fn();
const createSafetyEvent = vi.fn();

vi.mock("../db", () => ({
  getSessionStartAt: (...a: unknown[]) => getSessionStartAt(...a),
  getLastMessageAt: (...a: unknown[]) => getLastMessageAt(...a),
  countUserMessagesSince: (...a: unknown[]) => countUserMessagesSince(...a),
  getSessionCheckin: (...a: unknown[]) => getSessionCheckin(...a),
  countCheckinsSince: (...a: unknown[]) => countCheckinsSince(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getRecentCheckinAnswers: (...a: unknown[]) => getRecentCheckinAnswers(...a),
  getSafetyEvents: (...a: unknown[]) => getSafetyEvents(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
}));

import { isWorseStreak, pendingCheckin, worseSuggestion } from "./checkins";

const now = new Date("2026-03-10T12:00:00Z");
const sessionStart = new Date("2026-03-10T10:00:00Z");
const quietSince = new Date("2026-03-10T11:50:00Z");

describe("pendingCheckin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionStartAt.mockResolvedValue(sessionStart);
    getLastMessageAt.mockResolvedValue(quietSince);
    countUserMessagesSince.mockResolvedValue(7);
    getSessionCheckin.mockResolvedValue(null);
    countCheckinsSince.mockResolvedValue(0);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
  });

  it("asks after a real session that has clearly ended", async () => {
    const result = await pendingCheckin({ userId: 1, personaId: 5, now });
    expect(result).toEqual({ sessionStartAt: sessionStart });
  });

  it("does not ask while the conversation is still going", async () => {
    getLastMessageAt.mockResolvedValue(new Date("2026-03-10T11:55:00Z"));
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });

  it("does not ask about a session older than two days", async () => {
    getLastMessageAt.mockResolvedValue(new Date("2026-03-08T10:00:00Z"));
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });

  it("does not ask about a session where the user said too little", async () => {
    countUserMessagesSince.mockResolvedValue(5);
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });

  it("does not ask the same session twice", async () => {
    getSessionCheckin.mockResolvedValue({ id: 1, answer: "worse" });
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });

  it("does not ask twice in one day", async () => {
    // The first session of the day was answered; the second is quiet.
    countCheckinsSince.mockResolvedValue(1);
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });

  it("returns null with no session at all", async () => {
    getSessionStartAt.mockResolvedValue(null);
    expect(await pendingCheckin({ userId: 1, personaId: 5, now })).toBeNull();
  });
});

describe("isWorseStreak", () => {
  it("counts three valid worse answers in a row", () => {
    expect(isWorseStreak(["worse", "worse", "worse"])).toBe(true);
  });

  it("ignores skipped answers", () => {
    expect(isWorseStreak(["worse", "skipped", "worse", "worse"])).toBe(true);
  });

  it("is broken by a better answer", () => {
    expect(isWorseStreak(["worse", "better", "worse", "worse"])).toBe(false);
  });
});

describe("worseSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentCheckinAnswers.mockResolvedValue([
      { answer: "worse" },
      { answer: "worse" },
      { answer: "worse" },
    ]);
    getSafetyEvents.mockResolvedValue([]);
    createSafetyEvent.mockResolvedValue(1);
  });

  it("suggests a pause after three worse answers", async () => {
    expect(await worseSuggestion({ userId: 1, personaId: 5, now })).toBe(true);
  });

  it("does not suggest it again once the card was shown", async () => {
    getSafetyEvents.mockResolvedValue([
      {
        type: "usage",
        personaId: 5,
        excerpt: "checkins:worse×3",
        createdAt: new Date("2026-03-09T10:00:00Z"),
      },
    ]);
    expect(await worseSuggestion({ userId: 1, personaId: 5, now })).toBe(false);
  });

  it("does not suggest it after a better answer", async () => {
    getRecentCheckinAnswers.mockResolvedValue([
      { answer: "better" },
      { answer: "worse" },
      { answer: "worse" },
      { answer: "worse" },
    ]);
    expect(await worseSuggestion({ userId: 1, personaId: 5, now })).toBe(false);
  });
});
