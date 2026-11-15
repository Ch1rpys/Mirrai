/**
 * Splitting a reply the way this person actually sent them.
 *
 * Prefer the newlines the model already wrote. If there are none, cut
 * on this person's punctuation. If that still will not split, send one
 * line — never in the middle of a word.
 */
export function splitBurst(text: string, burstSize: number): string[] {
  const trimmed = text.trim();
  if (!trimmed || burstSize <= 1) return trimmed ? [trimmed] : [];
  const byNewline = trimmed.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (byNewline.length >= burstSize) {
    return mergeTail(byNewline, burstSize);
  }
  const byPunct = trimmed
    .split(/(?<=[。！？!?…])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byPunct.length >= burstSize) {
    return mergeTail(byPunct, burstSize);
  }
  return [trimmed];
}

function mergeTail(parts: string[], size: number): string[] {
  const head = parts.slice(0, size - 1);
  const rest = parts.slice(size - 1).join("");
  return [...head, rest].filter(Boolean);
}
