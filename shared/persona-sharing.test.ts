import { describe, expect, it } from "vitest";
import { resolveRecordScope, isSharedPersona } from "./persona-sharing";

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
