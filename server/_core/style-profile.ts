/**
 * Measuring the style profile.
 *
 * Each later entry fills in a field of its own. At P0.4 the measurement
 * only records that it ran: version, when, and which records it saw.
 */
import {
  getPersonaStyleProfile,
  getRecordsVersion,
  setPersonaStyleProfile,
} from "../db";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";

export async function measureStyleProfile(params: {
  personaId: number;
  userId: number;
  now?: Date;
}): Promise<StyleProfile> {
  const { personaId, userId, now = new Date() } = params;
  const recordsVersion = await getRecordsVersion(personaId, userId);
  const current = await getPersonaStyleProfile(personaId, userId);
  if (current && current.recordsVersion === recordsVersion && current.measuredAt) {
    return current;
  }
  const next = normalizeStyleProfile({
    ...(current ?? {}),
    version: 1,
    measuredAt: now.toISOString(),
    recordsVersion,
  });
  await setPersonaStyleProfile(personaId, userId, next);
  return next;
}
