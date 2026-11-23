/**
 * The experimental features an account has turned on (C9.8).
 *
 * They live in `users.features` as a small jsonb object:
 * `{ groupChat: boolean }`. Nothing is on by default, and anything the
 * app does not know is dropped — an unknown key is not a feature.
 */

export interface UserFeatures {
  groupChat: boolean;
}

export const DEFAULT_USER_FEATURES: UserFeatures = { groupChat: false };

/** Reads the stored value into a complete, typed object. */
export function normalizeUserFeatures(value: unknown): UserFeatures {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { groupChat: raw.groupChat === true };
}

/** Merges a patch over the stored value; unknown keys are ignored. */
export function mergeUserFeatures(value: unknown, patch: unknown): UserFeatures {
  const current = normalizeUserFeatures(value);
  if (!patch || typeof patch !== "object") return current;
  const p = patch as Record<string, unknown>;
  return {
    groupChat: typeof p.groupChat === "boolean" ? p.groupChat : current.groupChat,
  };
}
