/**
 * Whether the two of them are no longer together.
 *
 * The prompt and the ritual table have to ask the same question: an
 * ended relationship must not keep using pet names as if nothing
 * changed.
 */
export function relationshipIsOver(
  togetherTo: string | null | undefined,
  phase?: string | null,
): boolean {
  return Boolean((togetherTo ?? "").trim()) || phase === "breakup" || phase === "apart";
}
