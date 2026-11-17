/**
 * The snapshots of a persona, and how two of them differ.
 *
 * Distillation, a full edit, a correction, and a restore each store
 * one. The comparison is the prose fields as they were and as they
 * are, and the arrays as a count — so a restore is a choice, not a
 * wall of JSON.
 */

export const PERSONA_VERSION_REASONS = [
  "distill",
  "edit",
  "correction",
  "restore",
] as const;

export type PersonaVersionReason = (typeof PERSONA_VERSION_REASONS)[number];

export const PERSONA_PROSE_FIELDS = [
  "personality",
  "speakingStyle",
  "nickname",
  "memories",
  "attachmentStyle",
  "loveLanguage",
  "conflictStyle",
  "touchingMoments",
  "summary",
] as const;

export type PersonaProseField = (typeof PERSONA_PROSE_FIELDS)[number];

export const PERSONA_ARRAY_FIELDS = [
  "catchphrases",
  "microRules",
  "imperfectionProfile",
  "suppressions",
  "lifeEvents",
  "periods",
  "rejectedFeedbackKeys",
  "clarified",
] as const;

export type PersonaArrayField = (typeof PERSONA_ARRAY_FIELDS)[number];

export type PersonaVersionProseDiff = {
  before: string | null;
  after: string | null;
};

export type PersonaVersionArrayDiff = {
  before: number;
  after: number;
};

export type PersonaVersionDiff = {
  prose: Record<PersonaProseField, PersonaVersionProseDiff>;
  arrays: Record<PersonaArrayField, PersonaVersionArrayDiff>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** The prose and the array counts of one snapshot against another. */
export function diffPersonaData(before: unknown, after: unknown): PersonaVersionDiff {
  const oldData = asRecord(before);
  const newData = asRecord(after);
  const prose = {} as Record<PersonaProseField, PersonaVersionProseDiff>;
  for (const field of PERSONA_PROSE_FIELDS) {
    prose[field] = {
      before: asString(oldData[field]),
      after: asString(newData[field]),
    };
  }
  const arrays = {} as Record<PersonaArrayField, PersonaVersionArrayDiff>;
  for (const field of PERSONA_ARRAY_FIELDS) {
    arrays[field] = {
      before: asArrayLength(oldData[field]),
      after: asArrayLength(newData[field]),
    };
  }
  return { prose, arrays };
}

export function isPersonaVersionReason(value: string): value is PersonaVersionReason {
  return (PERSONA_VERSION_REASONS as readonly string[]).includes(value);
}
