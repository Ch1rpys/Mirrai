/**
 * What was measured from the records.
 *
 * These are measurements, not user decisions. They live on
 * `personas.styleProfile` rather than in `personaData`, which has a lock
 * and a merge of confirmations. A field that has not been measured is
 * simply absent — there is no default to fill it with.
 */

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
  fingerprint?: unknown; // 由 B3.1 填
  userSide?: unknown; // 由 B1.10 填 UserSideProfile
  rituals?: unknown; // 由 B2.2 填
  samplePool?: unknown; // 由 B2.6 填
  imperfectionDrafts?: unknown; // 由 B3.6 填
  discriminator?: unknown; // 由 B8.1 填
  replyDelay?: unknown; // 由 B5.3 填
  routine?: unknown; // 由 B5.4 填
  typing?: unknown; // 由 B5.5 填
  quirks?: unknown; // 由 B5.6 填
  doubleText?: unknown; // 由 B5.7 填
  sessions?: unknown; // 由 B4.6 填
  inSession?: unknown; // 由 B4.8 填
  multiPoint?: unknown; // 由 B4.7 填
  emotionDynamics?: unknown; // 由 B4.3 填
  conflict?: unknown; // 由 B4.4 填
  triggers?: unknown; // 由 B4.5 填
  actClusters?: unknown; // 由 B4.2 填
  addressHistory?: unknown; // 由 B3.8 填
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
      profile[key] = source[key];
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
