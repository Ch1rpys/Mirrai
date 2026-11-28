import { isMemorial, personaSettingsOf, sealState, taperStage } from "@shared/persona-state";

/**
 * Whether the lobby may put this persona in front of the user.
 *
 * The list still shows every persona — they are the user's. Featuring
 * is the other question: a daily pick, a conversation starter. Those
 * have to stay quiet for a persona that is paused, unreachable, ended,
 * not yet ready, sealed until a date the user picked, locked (C8.4), or
 * kept only for letters (WP13).
 */
export type LobbyPersona = {
  analysisStatus?: string | null;
  graduationStatus?: string | null;
  presence?: string | null;
  reachability?: string | null;
  relationshipEnded?: boolean;
  /**
   * `personas.settings`; memorial, seal, taper and the lock are read
   * from it. `persona.list` sends `null` for a locked persona (the
   * settings carry content), so the row-level `locked` flag below is
   * the one that is there when the card is closed.
   */
  settings?: unknown;
  /** The row-level flag `persona.list` adds for a closed card. */
  locked?: boolean | null;
};

/**
 * Whether the persona is locked (C8.4).
 *
 * Two sources, because the store sends both: the settings as stored
 * when the session proved the PIN recently, and the row-level flag when
 * it did not. A locked persona is not featured either way.
 */
export function isLockedPersona(persona: LobbyPersona | null | undefined): boolean {
  if (!persona) return false;
  if (persona.locked === true) return true;
  return personaSettingsOf(persona).locked === true;
}

/** The lobby can put this persona in front of the user. */
export function mayFeature(persona: LobbyPersona): boolean {
  if (isLockedPersona(persona)) return false;
  if (isMemorial(persona) || sealState(persona, new Date()) === "sealed") return false;
  if (taperStage(persona) === 3) return false;
  return persona.analysisStatus === "ready"
    && persona.graduationStatus !== "graduated"
    && persona.presence === "active"
    && persona.reachability !== "unreachable"
    && !persona.relationshipEnded;
}
