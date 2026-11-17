/**
 * Whether the lobby may put this persona in front of the user.
 *
 * The list still shows every persona — they are the user's. Featuring
 * is the other question: a daily pick, a conversation starter. Those
 * have to stay quiet for a persona that is paused, unreachable, ended,
 * or not yet ready.
 */
export type LobbyPersona = {
  analysisStatus?: string | null;
  graduationStatus?: string | null;
  presence?: string | null;
  reachability?: string | null;
  relationshipEnded?: boolean;
};

/** The lobby can put this persona in front of the user. */
export function mayFeature(persona: LobbyPersona): boolean {
  return persona.analysisStatus === "ready"
    && persona.graduationStatus !== "graduated"
    && persona.presence === "active"
    && persona.reachability !== "unreachable"
    && !persona.relationshipEnded;
}
