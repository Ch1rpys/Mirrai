/**
 * Private request fields the user may add to an OpenAI-compatible body.
 *
 * The object is merged as-is, so it cannot name the fields the app
 * already fills: `model`, `messages`, `stream`, `tools`. It also has
 * to stay small — it is stored on the configuration row and sent on
 * every call.
 */
export const EXTRA_BODY_MAX_BYTES = 2048;
export const EXTRA_BODY_FORBIDDEN = [
  "model",
  "messages",
  "stream",
  "tools",
  // The tool layer (C9.4) fills these two itself; a stored body must not
  // be able to widen or force tool use.
  "tool_choice",
  "response_format",
] as const;

export type ExtraBodyError = "not_object" | "too_large" | "forbidden";

export function inspectExtraBody(
  value: unknown,
): { ok: true; value?: Record<string, unknown> } | { ok: false; error: ExtraBodyError } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "not_object" };
  }
  const record = value as Record<string, unknown>;
  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return { ok: false, error: "not_object" };
  }
  if (Buffer.byteLength(serialized, "utf8") > EXTRA_BODY_MAX_BYTES) {
    return { ok: false, error: "too_large" };
  }
  for (const key of EXTRA_BODY_FORBIDDEN) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return { ok: false, error: "forbidden" };
    }
  }
  return { ok: true, value: record };
}

export function stripForbiddenExtraBody(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const key of EXTRA_BODY_FORBIDDEN) delete out[key];
  return out;
}
