/**
 * Deleting a persona because the person it was built from said no
 * (C10.3).
 *
 * This is not the ordinary delete. The ordinary delete puts the persona
 * in the recycle bin for thirty days, which is the owner taking it back.
 * This one is a promise made to somebody else, so it is immediate and it
 * leaves nothing to restore: no bin, no undo, no version.
 *
 * The name has to be typed in confirmation, because there is no undo to
 * fall back on.
 */
import { copy } from "@shared/copy";
import type { Locale } from "@shared/copy";
import { getPersonaById, purgePersona, createConsentRemoval } from "../db";

export type PurgeForConsentOutcome =
  | { status: "removed" }
  | { status: "not_found" }
  | { status: "name_mismatch" };

/** The pieces, injectable so the decision can be tested without a database. */
export interface PurgeForConsentDeps {
  getPersonaById: typeof getPersonaById;
  purgePersona: typeof purgePersona;
  createConsentRemoval: typeof createConsentRemoval;
  locale?: Locale;
}

/**
 * Removes one persona and leaves a content-free tombstone.
 *
 * `confirmName` is compared with the persona's name after trimming. The
 * comparison is exact otherwise: the point is that the person paused to
 * type it, not that the app can guess typos.
 */
export async function purgeForConsent(
  params: { personaId: number; userId: number; confirmName: string },
  deps: PurgeForConsentDeps = {
    getPersonaById,
    purgePersona,
    createConsentRemoval,
  },
): Promise<PurgeForConsentOutcome & { message?: string }> {
  const persona = await deps.getPersonaById(params.personaId, params.userId);
  if (!persona) return { status: "not_found" };
  const expected = String(persona.name ?? "").trim();
  const typed = String(params.confirmName ?? "").trim();
  if (!expected || typed !== expected) {
    return {
      status: "name_mismatch",
      message: copy(deps.locale ?? "zh", "errors.consentNameMismatch"),
    };
  }
  /**
   * The hard delete is the same one the recycle bin's "delete now" and
   * the thirty-day purge use: every persona-scoped table, every file.
   * The bin never sees this persona.
   */
  await deps.purgePersona(persona.id, params.userId);
  await deps.createConsentRemoval(params.userId);
  return { status: "removed" };
}
