import { describe, expect, it } from "vitest";
import {
  INHERITED_PERSONA_STATE_KEYS,
  isSharedPersona,
  mergeInheritedPersonaState,
  resolveRecordScope,
} from "./persona-sharing";

describe("whose records a persona reads (C7.2)", () => {
  it("reads its own records when it is not shared", () => {
    expect(resolveRecordScope({ id: 5, userId: 2 })).toEqual({ personaId: 5, userId: 2 });
    expect(isSharedPersona({})).toBe(false);
  });

  it("reads the owner's records when it is shared", () => {
    expect(
      resolveRecordScope({
        id: 9,
        userId: 2,
        sharedFromPersonaId: 5,
        sharedFromUserId: 1,
      }),
    ).toEqual({ personaId: 5, userId: 1 });
    expect(isSharedPersona({ sharedFromPersonaId: 5 })).toBe(true);
  });

  it("never guesses the owner from the member's own user id", () => {
    // A row that has the owner's persona but not the owner's user id
    // (a bad hydrate) must not read the member's empty record set as if
    // it were the owner's.
    expect(resolveRecordScope({ id: 9, userId: 2, sharedFromPersonaId: 5 })).toEqual({
      personaId: 9,
      userId: 2,
    });
  });
});

describe("the state a member inherits from the owner (C7.2)", () => {
  it("lays the owner's seal, taper and memorial mode over the member's settings", () => {
    const member = {
      layerSwitch: true,
      letterEmail: true,
      seal: { until: "2020-01-01", earlyOpen: "never" },
    };
    const owner = {
      seal: { until: "2099-01-01", earlyOpen: "cooling" },
      taper: { stage: 3 },
      mode: "memorial",
      memorial: { deathday: "2024-05-20" },
    };
    expect(mergeInheritedPersonaState(member, owner)).toEqual({
      layerSwitch: true,
      letterEmail: true,
      seal: { until: "2099-01-01", earlyOpen: "cooling" },
      taper: { stage: 3 },
      mode: "memorial",
      memorial: { deathday: "2024-05-20" },
    });
  });

  it("removes a state key the owner no longer has", () => {
    // A stale local seal must not keep a persona closed after the owner
    // lifted it.
    const merged = mergeInheritedPersonaState(
      { seal: { until: "2099-01-01", earlyOpen: "never" }, letterEmail: false },
      { letterEmail: true },
    );
    expect(merged).toEqual({ letterEmail: false });
    expect(merged).not.toHaveProperty("seal");
    expect(INHERITED_PERSONA_STATE_KEYS).toEqual(["seal", "taper", "mode", "memorial"]);
  });

  it("handles missing or broken values without throwing", () => {
    expect(mergeInheritedPersonaState(null, null)).toEqual({});
    expect(mergeInheritedPersonaState("nonsense", 3)).toEqual({});
  });
});
