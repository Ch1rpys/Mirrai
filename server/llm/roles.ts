/**
 * Cheap-work roles on the user's default LLM configuration.
 *
 * Classify, extract and summarise can point at a cheaper provider.
 * Anything that is not one of those three names, or is not a string,
 * is dropped.
 */
export const LLM_ROLE_KEYS = ["classify", "extract", "summarize"] as const;
export type LlmRoleKey = (typeof LLM_ROLE_KEYS)[number];

export function sanitizeRoles(value: unknown): Partial<Record<LlmRoleKey, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<LlmRoleKey, string>> = {};
  for (const key of LLM_ROLE_KEYS) {
    const name = source[key];
    if (typeof name === "string" && name.trim()) out[key] = name.trim();
  }
  return Object.keys(out).length ? out : undefined;
}
