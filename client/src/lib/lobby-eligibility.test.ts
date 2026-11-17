import { describe, expect, it } from "vitest";
import { mayFeature, type LobbyPersona } from "./lobby-eligibility";

/**
 * Who the lobby may put forward.
 *
 * Five conditions, each enough on its own to keep a persona off the
 * daily pick and the conversation starters. The card in the directory
 * still shows them.
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
});
