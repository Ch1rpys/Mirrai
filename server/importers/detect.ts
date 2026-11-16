import { IMPORTERS } from "./registry";
import type { DetectResult, ImportSource } from "./types";

/**
 * Asks every registered importer whether the file looks like theirs.
 *
 * Text formats score the share of leading lines that match a message
 * header. Below 0.3 they return null. The caller then decides whether
 * the top score is high enough, or too close to the runner-up, to pick
 * a format without asking.
 */
export function detectFormat(source: ImportSource): DetectResult[] {
  const hits: DetectResult[] = [];
  for (const importer of IMPORTERS) {
    const hit = importer.detect(source);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.confidence - a.confidence);
  return hits;
}

/**
 * Picks a format, or says the wizard has to ask.
 *
 * `null` means nobody claimed the file. `"ambiguous"` means the best
 * score is below 0.6, or the top two are within 0.15 of each other.
 */
export function pickDetectedFormat(
  results: DetectResult[],
): DetectResult | null | "ambiguous" {
  if (results.length === 0) return null;
  const top = results[0];
  if (top.confidence < 0.6) return "ambiguous";
  const second = results[1];
  if (second && top.confidence - second.confidence < 0.15) return "ambiguous";
  return top;
}
