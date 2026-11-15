/**
 * Character n-grams, shared by evaluation and by the reranker.
 *
 * The generation path used to be about to grow its own copy of the
 * eval model's Dice helper. Two copies of a three-line function is how
 * a ceiling of 0.75 in one file becomes 0.8 in the other.
 */
function normalise(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function characterNgrams(text: string, n = 3): Set<string> {
  const clean = normalise(text).replace(/\s+/g, "");
  const out = new Set<string>();
  if (clean.length < n) {
    if (clean) out.add(clean);
    return out;
  }
  for (let i = 0; i <= clean.length - n; i++) out.add(clean.slice(i, i + n));
  return out;
}

/** Dice coefficient over character n-grams. */
export function ngramOverlap(expected: string, generated: string, n = 3): number {
  const a = characterNgrams(expected, n);
  const b = characterNgrams(generated, n);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}
