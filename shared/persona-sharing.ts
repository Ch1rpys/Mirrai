/**
 * Whose records a persona reads (C7.2).
 *
 * A shared persona is one identity with two rows: the owner's, which
 * holds the name, the persona data, the style profile and the records,
 * and the member's, which holds their own conversations, mood, letters
 * and settings.
 *
 * Everything a turn reads from the *record* has to read the owner's
 * data; everything it writes about the *conversation* stays on the
 * member's row. This is the one place that decides which pair to use.
 */
export interface PersonaScopeInput {
  id: number;
  userId: number;
  /** The owner's persona id, when this row is a member's. */
  sharedFromPersonaId?: number | null;
  /**
   * The owner's user id.
   *
   * It is put on the hydrated row by `getPersonaById`; a member's own
   * `userId` is not the owner's and must never be used to read the
   * records.
   */
  sharedFromUserId?: number | null;
}

export interface RecordScope {
  personaId: number;
  userId: number;
}

/** Which `(personaId, userId)` pair holds the records this persona reads. */
export function resolveRecordScope(persona: PersonaScopeInput): RecordScope {
  if (persona.sharedFromPersonaId && persona.sharedFromUserId) {
    return {
      personaId: persona.sharedFromPersonaId,
      userId: persona.sharedFromUserId,
    };
  }
  return { personaId: persona.id, userId: persona.userId };
}

/** Whether this persona belongs to somebody else. */
export function isSharedPersona(persona: {
  sharedFromPersonaId?: number | null;
}): boolean {
  return Boolean(persona.sharedFromPersonaId);
}
