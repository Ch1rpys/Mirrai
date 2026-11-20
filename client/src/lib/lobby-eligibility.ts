import { isMemorial, sealState, taperStage } from "@shared/persona-state";

/**
 * Whether the lobby may put this persona in front of the user.
 *
 * The list still shows every persona — they are the user's. Featuring
 * is the other question: a daily pick, a conversation starter. Those
 * have to stay quiet for a persona that is paused, unreachable, ended,
 * not yet ready, sealed until a date the user picked, or kept only for
 * letters (WP13).
 */
export type LobbyPersona = {
  analysisStatus?: string | null;
  graduationStatus?: string | null;
  presence?: string | null;
  reachability?: string | null;
  relationshipEnded?: boolean;
  /** `personas.settings`; memorial, seal and taper are read from it. */
  settings?: unknown;
};

/** The lobby can put this persona in front of the user. */
export function mayFeature(persona: LobbyPersona): boolean {
  if (isMemorial(persona) || sealState(persona, new Date()) === "sealed") return false;
  if (taperStage(persona) === 3) return false;
  return persona.analysisStatus === "ready"
    && persona.graduationStatus !== "graduated"
    && persona.presence === "active"
    && persona.reachability !== "unreachable"
    && !persona.relationshipEnded;
}
