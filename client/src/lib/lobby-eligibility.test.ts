import { describe, expect, it, vi } from "vitest";
import { mayFeature, type LobbyPersona } from "./lobby-eligibility";

/**
 * Who the lobby may put forward.
 *
 * Each condition is enough on its own to keep a persona off the daily
 * pick and the conversation starters. The card in the directory still
 * shows them.
 */

const featured: LobbyPersona = {
  analysisStatus: "ready",
  graduationStatus: "active",
  presence: "active",
  reachability: "reachable",
  relationshipEnded: false,
};

describe("mayFeature", () => {
  it("is false when the persona is not ready", () => {
    expect(mayFeature({ ...featured, analysisStatus: "analyzing" })).toBe(false);
  });

  it("is false when the persona has graduated", () => {
    expect(mayFeature({ ...featured, graduationStatus: "graduated" })).toBe(false);
  });

  it("is false when the persona is paused", () => {
    expect(mayFeature({ ...featured, presence: "quiet" })).toBe(false);
  });

  it("is false when the two of them cannot reach each other", () => {
    expect(mayFeature({ ...featured, reachability: "unreachable" })).toBe(false);
  });

  it("is false when the relationship has ended", () => {
    expect(mayFeature({ ...featured, relationshipEnded: true })).toBe(false);
  });

  it("is false for a memorial persona", () => {
    expect(mayFeature({ ...featured, settings: { mode: "memorial" } })).toBe(false);
  });

  it("is false while sealed, and true again after the day", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-04T12:00:00Z"));
      const sealed = { ...featured, settings: { seal: { until: "2026-03-20", earlyOpen: "never" } } };
      expect(mayFeature(sealed)).toBe(false);
      vi.setSystemTime(new Date("2026-03-20T12:00:00Z"));
      expect(mayFeature(sealed)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is false when only letters are allowed", () => {
    expect(mayFeature({ ...featured, settings: { taper: { stage: 3 } } })).toBe(false);
  });

  it("is false for a locked persona", () => {
    // C8.4: the lobby shows it as a card with no name. Featuring it
    // would put that name (and a chat prompt) in front of the user.
    expect(mayFeature({ ...featured, settings: { locked: true } })).toBe(false);
  });

  it("is false for a locked persona even when everything else is ready", () => {
    // `persona.list` sends the row's `locked` flag (and nulls the
    // settings it belongs to), so the row flag is the one that is
    // there when the card is closed.
    expect(mayFeature({ ...featured, locked: true })).toBe(false);
  });

  it("is true for an unlocked ready persona", () => {
    expect(mayFeature({ ...featured, settings: { locked: false } })).toBe(true);
    expect(mayFeature({ ...featured, locked: false })).toBe(true);
  });
});
