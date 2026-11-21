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

/**
 * The settings that describe the persona itself, not the member's side.
 *
 * A shared persona's seal, taper step and memorial mode are the owner's
 * decisions about the relationship. A family member gets the same
 * persona, so those decisions have to reach them too — otherwise the
 * owner could seal the persona, or step it down to letters, and the
 * family would carry on chatting. Everything else in `settings` (the
 * generation switches, the letter mailbox, the long-distance date) is
 * the member's own.
 */
export const INHERITED_PERSONA_STATE_KEYS = ["seal", "taper", "mode", "memorial"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The member's settings with the owner's state laid over them.
 *
 * Pure; both sides are the stored (un-normalised) values. A state key
 * the owner does not have is removed rather than kept from the member, so
 * a stale local copy cannot keep a persona sealed or tapered after the
 * owner lifted it.
 */
export function mergeInheritedPersonaState(
  memberSettings: unknown,
  ownerSettings: unknown,
): Record<string, unknown> {
  const member = isPlainObject(memberSettings) ? { ...memberSettings } : {};
  const owner = isPlainObject(ownerSettings) ? ownerSettings : {};
  for (const key of INHERITED_PERSONA_STATE_KEYS) {
    if (owner[key] === undefined) delete member[key];
    else member[key] = owner[key];
  }
  return member;
}
