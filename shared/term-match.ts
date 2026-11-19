/**
 * Whether a name or a topic actually shows up in a line.
 *
 * A two-character name is specific enough to find with a substring.
 * A single character is not: 「海」sits inside 「上海」, and 「强」sits
 * inside 「坚强」. Those compounds are closed words, so the character
 * there is not the person or the topic.
 */

// i18n:allow-input — compounds in what people type, where one character is not the topic
const CLOSED_BIGRAMS = new Set([
  "上海",
  "海鲜",
  "海关",
  "海外",
  "海军",
  "海峡",
  "海报",
  "海拔",
  "海味",
  "海带",
  "海藻",
  "海参",
  "海啸",
  "坚强",
  "强烈",
  "强制",
  "强调",
  "强大",
  "强壮",
  "强硬",
  "强盗",
]);

function isHan(char: string): boolean {
  return /[\u4e00-\u9fff]/.test(char);
}

export function containsTerm(text: string, term: string): boolean {
  const needle = term.trim();
  const haystack = String(text ?? "");
  if (!needle || !haystack) return false;
  if ([...needle].length >= 2) return haystack.includes(needle);
  let from = 0;
  while (from < haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const prev = at > 0 ? haystack.charAt(at - 1) : "";
    const next = haystack.charAt(at + needle.length);
    const gluedPrev = isHan(prev) && CLOSED_BIGRAMS.has(prev + needle);
    const gluedNext = isHan(next) && CLOSED_BIGRAMS.has(needle + next);
    if (!gluedPrev && !gluedNext) return true;
    from = at + needle.length;
  }
  return false;
}
