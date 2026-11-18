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
  getUserById,
  iterateRecords,
  listFidelityPairs,
  setPersonaSettings,
  setPersonaStyleProfile,
} from "../db";
import { mergePersonaSettings } from "@shared/persona-settings";
import { normalizePeriods } from "@shared/periods";
import { mineAddressForms } from "@shared/address-history";
import { draftImperfection } from "@shared/imperfection-draft";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";
import {
  CHOICE_MIN_PAIRS,
  pairExamplesFromRows,
  trainRerankWeights,
} from "../eval/ab-pairs";
import {
  defaultAddressForms,
  measureFingerprint,
  type FingerprintRow,
} from "@shared/style-fingerprint";
import { measureUserSide } from "@shared/user-side-profile";
import {
  mergeManualRituals,
  mineRituals,
  normalizeRituals,
  turnsFromRecords,
} from "@shared/ritual-table";
import { measureSamplePool } from "@shared/sample-pool";
import { measureActClusters } from "@shared/act-clusters";
import { measureEmotionDynamics } from "@shared/emotion-dynamics";
import { groupConflictTriggers, mineConflictEpisodes, summarizeConflicts } from "@shared/conflicts";
import { measureSessions } from "@shared/session-profile";
import { splitScenes } from "@shared/scenes";
import { schedulePersonaEmbeddings } from "../chat/embeddings";

export async function measureStyleProfile(params: {
  personaId: number;
  userId: number;
  now?: Date;
  /**
   * Labelling does not change the records-version string, so a pool
   * measured before the emotions were written would stay `{ any }`.
   * Distillation passes true after it has labelled.
   */
  force?: boolean;
}): Promise<StyleProfile> {
  const { personaId, userId, now = new Date(), force = false } = params;
  const recordsVersion = await getRecordsVersion(personaId, userId);
  const current = await getPersonaStyleProfile(personaId, userId);
  if (!force && current && current.recordsVersion === recordsVersion && current.measuredAt) {
    return applyRerankWeightsFromPairs(personaId, userId, current, { persistAlways: false });
  }
  const rows: FingerprintRow[] = [];
  for await (const row of iterateRecords(personaId, userId)) {
    rows.push({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      act: row.act,
      emotion: row.emotion,
      speaker: row.speaker,
    });
  }
  const persona = await getPersonaById(personaId, userId);
  const user = await getUserById(userId);
  const rawData =
    persona?.personaData && typeof persona.personaData === "object" && !Array.isArray(persona.personaData)
      ? (persona.personaData as Record<string, unknown>)
      : {};
  const nickname = typeof rawData.nickname === "string" ? rawData.nickname.trim() : "";
  const userName = typeof user?.name === "string" ? user.name.trim() : "";
  const personaName = typeof persona?.name === "string" ? persona.name.trim() : "";
  const knownForms = [
    ...new Set([nickname, userName, personaName, ...defaultAddressForms()].filter(Boolean)),
  ];
  const timeZone =
    (typeof user?.timezone === "string" && user.timezone) ||
    (typeof persona?.timezone === "string" && persona.timezone) ||
    null;
  const addressHistory = mineAddressForms(rows, knownForms, { timeZone });
  const minedForms = addressHistory
    .filter((entry) => entry.direction === "them_to_me")
    .map((entry) => entry.form);
  const addressForms = minedForms.length > 0 ? minedForms : knownForms;
  const periods = normalizePeriods(rawData.periods);
  const fingerprint = measureFingerprint(rows, { addressForms, periods }) ?? undefined;
  const userSide = measureUserSide(rows);
  if (userSide) {
    const userFingerprint = measureFingerprint(rows, { role: "user", addressForms });
    if (userFingerprint) userSide.fingerprint = userFingerprint;
  }
  const locale = user?.locale === "en" ? "en" : "zh";
  const drafts = draftImperfection(
    { fingerprint, doubleText: current?.doubleText, stickers: current?.stickers, replyDelay: current?.replyDelay },
    { locale, rows },
  );
  const minedRituals = mineRituals(turnsFromRecords(rows));
  const rituals = mergeManualRituals(minedRituals, normalizeRituals(current?.rituals));
  const samplePool = measureSamplePool(rows, rawData);
  const actClusters = measureActClusters(rows, rawData);
  const labelledScenes = splitScenes(
    rows.map((row) => ({
      role: row.role,
      content: row.content,
      emotion: row.emotion,
      timestamp: row.timestamp,
      kind: row.kind,
      act: row.act,
      id: row.id,
    })),
  );
  const emotionDynamics = measureEmotionDynamics(labelledScenes);
  const conflictEpisodes = mineConflictEpisodes(labelledScenes);
  const conflict = summarizeConflicts(conflictEpisodes, rawData);
  const triggers = groupConflictTriggers(conflictEpisodes);
  const sessions = measureSessions(labelledScenes, timeZone);
  const next = normalizeStyleProfile({
    ...(current ?? {}),
    version: 1,
    measuredAt: now.toISOString(),
    recordsVersion,
    fingerprint,
    userSide: userSide ?? undefined,
    imperfectionDrafts: drafts,
    addressHistory,
    ...(rituals.length > 0 ? { rituals } : { rituals: undefined }),
    ...(samplePool ? { samplePool } : { samplePool: undefined }),
    ...(actClusters ? { actClusters } : { actClusters: undefined }),
    ...(emotionDynamics ? { emotionDynamics } : { emotionDynamics: undefined }),
    ...(conflict ? { conflict } : { conflict: undefined }),
    ...(triggers && triggers.length > 0 ? { triggers } : { triggers: undefined }),
    ...(sessions ? { sessions } : { sessions: undefined }),
  });
  return applyRerankWeightsFromPairs(personaId, userId, next, { persistAlways: true });
}

/**
 * Thirty A/B picks train the rerank weights, even when the records
 * have not moved and the rest of the profile is left alone.
 */
async function applyRerankWeightsFromPairs(
  personaId: number,
  userId: number,
  profile: StyleProfile,
  options: { persistAlways: boolean },
): Promise<StyleProfile> {
  const rows = await listFidelityPairs(personaId, userId);
  const weights =
    rows.length >= CHOICE_MIN_PAIRS
      ? trainRerankWeights(pairExamplesFromRows(rows), `ab:${personaId}`)
      : null;
  const next = weights
    ? normalizeStyleProfile({ ...profile, rerankWeights: weights })
    : profile;
  if (options.persistAlways || weights) {
    await setPersonaStyleProfile(personaId, userId, next);
  }
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
  schedulePersonaEmbeddings(params.personaId, params.userId);
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
