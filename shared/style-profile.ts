/**
 * What was measured from the records.
 *
 * These are measurements, not user decisions. They live on
 * `personas.styleProfile` rather than in `personaData`, which has a lock
 * and a merge of confirmations. A field that has not been measured is
 * simply absent — there is no default to fill it with.
 */
import type { AddressEntry } from "./address-history";
import { normalizeActClusters, type ActClusters } from "./act-clusters";
import {
  normalizeConflictProfile,
  normalizeTriggers,
  type ConflictProfile,
  type TriggerEntry,
} from "./conflicts";
import { normalizeSessionProfile, type SessionProfile } from "./session-profile";
import { normalizeMultiPoint, type MultiPointProfile } from "./multi-point";
import { normalizeInSession, type InSessionProfile } from "./in-session";
import { normalizeEmotionDynamics, type EmotionDynamics } from "./emotion-dynamics";
import { normalizeSamplePool, type SamplePool } from "./sample-pool";
import { normalizeReplyDelay, type DelayBuckets } from "./reply-delay";
import { normalizeRoutine, type RoutineProfile } from "./routine-profile";
import { normalizeTyping, type TypingProfile } from "./typing-profile";
import { normalizeQuirks, type QuirksProfile } from "./quirks-profile";
import type { StyleFingerprint } from "./style-fingerprint";
import type { ImperfectionDrafts } from "./imperfection-draft";
import { normalizeRituals, type RitualEntry } from "./ritual-table";
import type { UserSideProfile } from "./user-side-profile";

export const STYLE_PROFILE_KEYS = [
  "fingerprint",
  "userSide",
  "rituals",
  "samplePool",
  "imperfectionDrafts",
  "discriminator",
  "replyDelay",
  "routine",
  "typing",
  "quirks",
  "doubleText",
  "sessions",
  "inSession",
  "multiPoint",
  "emotionDynamics",
  "conflict",
  "triggers",
  "actClusters",
  "addressHistory",
  "stickers",
  "voice",
  "photos",
  "calls",
  "publicFingerprint",
  "writtenFingerprint",
  "group",
  "mirror",
  "rerankWeights",
] as const;

export type StyleProfileKey = (typeof STYLE_PROFILE_KEYS)[number];

export interface StyleProfile {
  version: 1;
  measuredAt: string;
  /** `${recordCount}:${maxId}`, used to decide whether to remeasure. */
  recordsVersion: string;
  fingerprint?: StyleFingerprint;
  userSide?: UserSideProfile;
  rituals?: RitualEntry[];
  samplePool?: SamplePool;
  imperfectionDrafts?: ImperfectionDrafts;
  discriminator?: unknown; // 由 B8.1 填
  replyDelay?: DelayBuckets;
  routine?: RoutineProfile;
  typing?: TypingProfile;
  quirks?: QuirksProfile;
  doubleText?: unknown; // 由 B5.7 填
  sessions?: SessionProfile;
  inSession?: InSessionProfile;
  multiPoint?: MultiPointProfile;
  emotionDynamics?: EmotionDynamics;
  conflict?: ConflictProfile;
  triggers?: TriggerEntry[];
  actClusters?: ActClusters;
  addressHistory?: AddressEntry[];
  stickers?: unknown; // 由 B7.1 填
  voice?: unknown; // 由 B7.4 填
  photos?: unknown; // 由 B7.9 填
  calls?: unknown; // 由 B7.13 填
  publicFingerprint?: unknown; // 由 B7.12 填
  writtenFingerprint?: unknown; // 由 C1.8 填
  group?: unknown; // 由 C9.8 填
  mirror?: unknown; // 由 C4.1 填
  rerankWeights?: unknown; // 由 B8.8 填
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keeps the three identity fields and any known measurement keys.
 *
 * Unknown keys are dropped. A missing measurement stays missing — it is
 * not filled with a default.
 */
export function normalizeStyleProfile(value: unknown): StyleProfile {
  const source = isPlainObject(value) ? value : {};
  const version = 1 as const;
  const measuredAt = typeof source.measuredAt === "string" ? source.measuredAt : "";
  const recordsVersion = typeof source.recordsVersion === "string" ? source.recordsVersion : "";
  const profile: StyleProfile = { version, measuredAt, recordsVersion };
  for (const key of STYLE_PROFILE_KEYS) {
    if (key in source && source[key] !== undefined) {
      if (key === "rituals") {
        const rituals = normalizeRituals(source.rituals);
        if (rituals.length > 0) profile.rituals = rituals;
        continue;
      }
      if (key === "samplePool") {
        const samplePool = normalizeSamplePool(source.samplePool);
        if (samplePool) profile.samplePool = samplePool;
        continue;
      }
      if (key === "actClusters") {
        const actClusters = normalizeActClusters(source.actClusters);
        if (actClusters) profile.actClusters = actClusters;
        continue;
      }
      if (key === "emotionDynamics") {
        const emotionDynamics = normalizeEmotionDynamics(source.emotionDynamics);
        if (emotionDynamics) profile.emotionDynamics = emotionDynamics;
        continue;
      }
      if (key === "conflict") {
        const conflict = normalizeConflictProfile(source.conflict);
        if (conflict) profile.conflict = conflict;
        continue;
      }
      if (key === "triggers") {
        const triggers = normalizeTriggers(source.triggers);
        if (triggers) profile.triggers = triggers;
        continue;
      }
      if (key === "sessions") {
        const sessions = normalizeSessionProfile(source.sessions);
        if (sessions) profile.sessions = sessions;
        continue;
      }
      if (key === "multiPoint") {
        const multiPoint = normalizeMultiPoint(source.multiPoint);
        if (multiPoint) profile.multiPoint = multiPoint;
        continue;
      }
      if (key === "inSession") {
        const inSession = normalizeInSession(source.inSession);
        if (inSession) profile.inSession = inSession;
        continue;
      }
      if (key === "replyDelay") {
        const replyDelay = normalizeReplyDelay(source.replyDelay);
        if (replyDelay) profile.replyDelay = replyDelay;
        continue;
      }
      if (key === "routine") {
        const routine = normalizeRoutine(source.routine);
        if (routine) profile.routine = routine;
        continue;
      }
      if (key === "typing") {
        const typing = normalizeTyping(source.typing);
        if (typing) profile.typing = typing;
        continue;
      }
      if (key === "quirks") {
        const quirks = normalizeQuirks(source.quirks);
        if (quirks) profile.quirks = quirks;
        continue;
      }
      (profile as unknown as Record<string, unknown>)[key] = source[key];
    }
  }
  return profile;
}

/**
 * The profile the generation path actually reads.
 *
 * Until C10.6 lands this is the stored profile, unchanged. Later it
 * will drop keys the user has turned off.
 */
export function effectiveStyleProfile(persona: { styleProfile?: unknown }): StyleProfile {
  return normalizeStyleProfile(persona.styleProfile);
}
