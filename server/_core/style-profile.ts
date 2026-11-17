/**
 * Measuring the style profile.
 *
 * Each later entry fills in a field of its own. At P0.4 the measurement
 * only records that it ran: version, when, and which records it saw.
 */
import {
  getPersonaById,
  getPersonaSettings,
  getPersonaStyleProfile,
  getRecordsVersion,
  iterateRecords,
  setPersonaSettings,
  setPersonaStyleProfile,
} from "../db";
import { mergePersonaSettings } from "@shared/persona-settings";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";
import { measureUserSide } from "@shared/user-side-profile";

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
  const rows: Array<{
    role: string;
    content: string;
    timestamp: Date | string | null;
    kind?: string | null;
    act?: string | null;
  }> = [];
  for await (const row of iterateRecords(personaId, userId)) {
    rows.push({
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      act: row.act,
    });
  }
  const userSide = measureUserSide(rows);
  const next = normalizeStyleProfile({
    ...(current ?? {}),
    version: 1,
    measuredAt: now.toISOString(),
    recordsVersion,
    userSide: userSide ?? undefined,
  });
  await setPersonaStyleProfile(personaId, userId, next);
  return next;
}

/**
 * After records were written (or refused as copies).
 *
 * The style profile is remade only when the version string moved. A
 * persona that is already distilled is told how many new rows arrived,
 * so the upload page can offer a rebuild.
 */
export async function afterRecordsChanged(params: {
  personaId: number;
  userId: number;
  added: number;
}): Promise<StyleProfile> {
  const profile = await measureStyleProfile(params);
  if (params.added <= 0) return profile;
  const persona = await getPersonaById(params.personaId, params.userId);
  if (persona?.analysisStatus !== "ready") return profile;
  const current = await getPersonaSettings(params.personaId, params.userId);
  const next = mergePersonaSettings(current, {
    pendingRedistillAdded: (current?.pendingRedistillAdded ?? 0) + params.added,
  });
  await setPersonaSettings(params.personaId, params.userId, next);
  return profile;
}

/**
 * After records were removed.
 *
 * The style profile is left as it was — remasuring would hide that the
 * persona was built from a larger set. A distilled persona is told the
 * table is now smaller, so the upload page can offer a rebuild.
 */
export async function afterRecordsRemoved(params: {
  personaId: number;
  userId: number;
}): Promise<void> {
  const persona = await getPersonaById(params.personaId, params.userId);
  if (persona?.analysisStatus !== "ready") return;
  const live = await getRecordsVersion(params.personaId, params.userId);
  const profile = await getPersonaStyleProfile(params.personaId, params.userId);
  if (!profile?.recordsVersion || profile.recordsVersion === live) return;
  const current = await getPersonaSettings(params.personaId, params.userId);
  const next = mergePersonaSettings(current, { pendingRedistillRemoved: true });
  await setPersonaSettings(params.personaId, params.userId, next);
}
