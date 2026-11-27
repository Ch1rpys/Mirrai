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
import { preferredClockZone } from "@shared/timezone";
import { draftImperfection } from "@shared/imperfection-draft";
import { normalizeStyleProfile, type StyleProfile } from "@shared/style-profile";
import {
  CHOICE_MIN_PAIRS,
  pairExamplesFromRows,
  trainRerankWeights,
} from "../eval/ab-pairs";
import {
  MIN_FINGERPRINT_SAMPLES,
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
import { measureMultiPoint } from "@shared/multi-point";
import { measureInSessionFromScenes } from "@shared/in-session";
import { measureMirror } from "@shared/mirror";
import { measureReplyDelay } from "@shared/reply-delay";
import { measureRoutine } from "@shared/routine-profile";
import { measureTyping } from "@shared/typing-profile";
import { measureQuirks } from "@shared/quirks-profile";
import { measureStickers } from "@shared/sticker-stats";
import { measureVoice } from "@shared/voice-stats";
import { measureCalls } from "@shared/call-stats";
import { measurePhotos } from "@shared/photo-stats";
import { measureDoubleText } from "@shared/double-text";
import { measureGroup } from "@shared/group-stats";
import { toTurns } from "@shared/scenes";
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
  /**
   * Persona data to read instead of the row's own (C10.1).
   *
   * The first distillation runs before its own harm decision is stored,
   * so the measurement would read an empty report and learn the voice
   * from the lines the notice is asking about. The pipeline hands the
   * decision in instead.
   */
  personaDataOverride?: Record<string, unknown>;
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
      meta:
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null,
    });
  }
  /**
   * The public register (B7.12).
   *
   * Read separately and never mixed into the private rows: a post that
   * speaks to everyone must not change how the persona talks to one
   * person.
   */
  const publicRows: FingerprintRow[] = [];
  for await (const row of iterateRecords(personaId, userId, { register: "public" })) {
    publicRows.push({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      act: row.act,
      emotion: row.emotion,
      speaker: row.speaker,
      meta:
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null,
    });
  }
  /**
   * The written register (C1.8).
   *
   * Letters, diaries and articles are read for *content*, never for the
   * one-to-one voice: the words somebody chooses in a letter are not the
   * words they send in a chat. A separate fingerprint is stored so the
   * profile can show how they write without that being mistaken for how
   * they talk.
   */
  const writtenRows: FingerprintRow[] = [];
  for await (const row of iterateRecords(personaId, userId, { register: "written" })) {
    writtenRows.push({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      act: row.act,
      emotion: row.emotion,
      speaker: row.speaker,
      meta:
        row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null,
    });
  }
  /**
   * The group register (C9.8).
   *
   * A group is a different room, and how often they step in there says
   * nothing about how they talk to one person. Read from its own rows
   * and stored under its own key; it never touches the chat voice.
   */
  const groupRows = [];
  for await (const row of iterateRecords(personaId, userId, { register: "group" })) {
    groupRows.push(row);
  }
  const group = measureGroup(groupRows);
  const persona = await getPersonaById(personaId, userId);
  const user = await getUserById(userId);
  const rawData = {
    ...(persona?.personaData && typeof persona.personaData === "object" && !Array.isArray(persona.personaData)
      ? (persona.personaData as Record<string, unknown>)
      : {}),
    ...(params.personaDataOverride ?? {}),
  };
  const nickname = typeof rawData.nickname === "string" ? rawData.nickname.trim() : "";
  const userName = typeof user?.name === "string" ? user.name.trim() : "";
  const personaName = typeof persona?.name === "string" ? persona.name.trim() : "";
  const knownForms = [
    ...new Set([nickname, userName, personaName, ...defaultAddressForms()].filter(Boolean)),
  ];
  const userZone = typeof user?.timezone === "string" ? user.timezone : null;
  const personaZone = typeof persona?.timezone === "string" ? persona.timezone : null;
  const timeZone = userZone || personaZone || null;
  const sessionZone = preferredClockZone(personaZone, userZone);
  const addressHistory = mineAddressForms(rows, knownForms, { timeZone });
  const minedForms = addressHistory
    .filter((entry) => entry.direction === "them_to_me")
    .map((entry) => entry.form);
  const addressForms = minedForms.length > 0 ? minedForms : knownForms;
  const periods = normalizePeriods(rawData.periods);
  const fingerprint = measureFingerprint(rows, { addressForms, periods }) ?? undefined;
  const publicFingerprint =
    publicRows.length >= 40
      ? measureFingerprint(publicRows, { addressForms, periods }) ?? undefined
      : undefined;
  /**
   * The written voice, measured on its own rows only.
   *
   * It has its own floor: forty of their written lines. Below that, the
   * field does not exist, which is the honest answer.
   */
  const writtenFingerprint =
    writtenRows.length >= MIN_FINGERPRINT_SAMPLES
      ? measureFingerprint(writtenRows, { addressForms, periods }) ?? undefined
      : undefined;
  const userSide = measureUserSide(rows);
  if (userSide) {
    const userFingerprint = measureFingerprint(rows, { role: "user", addressForms });
    if (userFingerprint) userSide.fingerprint = userFingerprint;
  }
  const locale = user?.locale === "en" ? "en" : "zh";
  /**
   * The freshly measured stickers and delay, before the draft rules (B3.6).
   *
   * The draft compares one state with the others, so it has to read this
   * run's numbers. It read the last stored profile instead: on a first
   * run there was nothing, and on a re-run the drafts described the
   * previous measurement.
   */
  const replyDelay = measureReplyDelay(rows, sessionZone ?? "UTC") ?? undefined;
  const stickers = measureStickers(rows) ?? undefined;
  const drafts = draftImperfection(
    { fingerprint, stickers, replyDelay },
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
  const sessions = measureSessions(labelledScenes, sessionZone);
  const routine = measureRoutine(rows, sessionZone ?? "UTC") ?? undefined;
  const typing = measureTyping(rows, replyDelay) ?? undefined;
  const quirks = measureQuirks(rows);
  const doubleText = measureDoubleText(rows, rawData) ?? undefined;
  const voice = measureVoice(rows) ?? undefined;
  const calls = measureCalls(rows, sessionZone) ?? undefined;
  const photos = measurePhotos(rows) ?? undefined;
  const multiPoint = measureMultiPoint(labelledScenes.flatMap((scene) => toTurns(scene)));
  const inSession = measureInSessionFromScenes(labelledScenes);
  /**
   * The user's own side (C4.1).
   *
   * Read from the same rows, with the roles as they are; the mirror
   * swaps them where the question is about the user's timing. It is
   * stored on the profile but never read by a prompt.
   */
  const mirror = measureMirror(
    rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      kind: row.kind,
      emotion: row.emotion,
    })),
    { repairBy: conflict?.repairBy ?? null, personaTimeZone: sessionZone },
  );
  /**
   * Built as one record rather than a literal full of conditional
   * spreads: the type checker drops the whole expression when the
   * union of twenty optional measurements gets too large.
   */
  const nextRaw: Record<string, unknown> = { ...(current ?? {}) };
  Object.assign(nextRaw, {
    version: 1,
    measuredAt: now.toISOString(),
    recordsVersion,
    fingerprint,
    publicFingerprint,
    writtenFingerprint,
    userSide: userSide ?? undefined,
    imperfectionDrafts: drafts,
    addressHistory,
    rituals: rituals.length > 0 ? rituals : undefined,
    samplePool,
    actClusters,
    emotionDynamics,
    conflict,
    triggers: triggers && triggers.length > 0 ? triggers : undefined,
    sessions,
    replyDelay,
    routine,
    typing,
    quirks,
    doubleText,
    stickers,
    voice,
    calls,
    photos,
    multiPoint,
    inSession,
    mirror: mirror ?? undefined,
    // Only when measured: a group log below the floor leaves the field
    // absent rather than filling it with a default.
    ...(group ? { group } : {}),
  });
  const next = normalizeStyleProfile(nextRaw);
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
