#!/usr/bin/env node
/**
 * Measures the semantic crisis thresholds against the real local model.
 *
 * The two groups of sentences in `server/safety/crisis-semantic.ts` are
 * hand-written. The 0.72 floor and the 0.05 margin were chosen on a desk:
 * the machine they were written on has no embedding model, so the numbers
 * were never measured. This script is the measurement.
 *
 * What it prints, for the embedding model the app is configured to use:
 *
 *   - for every crisis sentence, its largest cosine with the *other*
 *     crisis sentences and with the harmless group (leave-one-out, so a
 *     sentence is not compared with itself);
 *   - the same for every harmless sentence against the crisis group;
 *   - the smallest floor at which every crisis sentence still passes, and
 *     whether the harmless group stays out at that floor (with the
 *     configured margin);
 *   - a one-line verdict: is the written threshold the right one.
 *
 * Usage:
 *   corepack pnpm crisis:semantic-thresholds
 *
 * Needs the local Ollama with the configured embedding model. Without it
 * the script says so and exits 1 — it never invents numbers.
 */
import { CRISIS_EXEMPLARS, SAFE_EXEMPLARS, CRISIS_FLOOR, SAFE_MARGIN } from "../server/safety/crisis-semantic";
import { cosine, embedModelName, embedTexts, probeEmbedStatus } from "../server/chat/embeddings";

function maxCosineTo(vector: number[], group: number[][], skip = -1): number {
  let best = -1;
  for (let i = 0; i < group.length; i++) {
    if (i === skip) continue;
    const value = cosine(vector, group[i]!);
    if (value > best) best = value;
  }
  return best;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

function describe(name: string, values: number[]): void {
  if (values.length === 0) {
    console.log(`${name}: (empty)`);
    return;
  }
  const p = (q: number) => quantile(values, q).toFixed(3);
  console.log(
    `${name}: min ${Math.min(...values).toFixed(3)}  p10 ${p(0.1)}  median ${p(0.5)}  p90 ${p(0.9)}  max ${Math.max(...values).toFixed(3)}  (n=${values.length})`,
  );
}

async function main(): Promise<void> {
  const probe = await probeEmbedStatus();
  if (probe !== "ready") {
    console.error(
      `[crisis-semantic] the local embedding model is not available (${probe}). ` +
      `Start Ollama and install ${embedModelName()}, then run this again.`,
    );
    process.exitCode = 1;
    return;
  }

  const all = [...CRISIS_EXEMPLARS, ...SAFE_EXEMPLARS];
  const vectors = await embedTexts(all);
  if (!vectors) {
    console.error("[crisis-semantic] the embedding request failed; nothing was measured.");
    process.exitCode = 1;
    return;
  }
  const crisis = vectors.slice(0, CRISIS_EXEMPLARS.length);
  const safe = vectors.slice(CRISIS_EXEMPLARS.length);

  const crisisVsCrisis: number[] = [];
  const crisisVsSafe: number[] = [];
  for (let i = 0; i < crisis.length; i++) {
    crisisVsCrisis.push(maxCosineTo(crisis[i]!, crisis, i));
    crisisVsSafe.push(maxCosineTo(crisis[i]!, safe));
  }
  const safeVsCrisis: number[] = safe.map((vector) => maxCosineTo(vector, crisis));
  const safeVsSafe: number[] = safe.map((vector, i) => maxCosineTo(vector, safe, i));

  console.log(`[crisis-semantic] model ${embedModelName()}`);
  console.log(`[crisis-semantic] written threshold: floor ${CRISIS_FLOOR}, margin ${SAFE_MARGIN}`);
  describe("crisis ↔ crisis (leave-one-out)", crisisVsCrisis);
  describe("crisis ↔ harmless", crisisVsSafe);
  describe("harmless ↔ crisis", safeVsCrisis);
  describe("harmless ↔ harmless (leave-one-out)", safeVsSafe);

  /**
   * The written layer's own test: a crisis sentence is heard when its
   * closest safe sentence is at least the margin further away.
   */
  const heard = crisis.map((_, i) => crisisVsCrisis[i]! >= CRISIS_FLOOR && crisisVsCrisis[i]! - crisisVsSafe[i]! >= SAFE_MARGIN);
  const wronglyHeard = safeVsCrisis.map((value, i) => value >= CRISIS_FLOOR && value - safeVsSafe[i]! >= SAFE_MARGIN);
  console.log(
    `[crisis-semantic] self-check at the written thresholds: ` +
    `${heard.filter(Boolean).length}/${heard.length} crisis sentences heard, ` +
    `${wronglyHeard.filter(Boolean).length}/${wronglyHeard.length} harmless sentences wrongly heard`,
  );

  /**
   * The floor range that keeps both groups right.
   *
   * A crisis sentence is heard when its crisis score is at or above the
   * floor and beats its harmless score by the margin. The margin half
   * does not depend on the floor: either the sentence clears it or the
   * floor cannot save it. The floor has to be at most the smallest
   * crisis score that clears the margin, and greater than the largest
   * harmless score that clears own-group margin (or the harmless
   * sentence would be heard too).
   */
  const crisisClearing = crisis
    .map((_, i) => ({ score: crisisVsCrisis[i]!, safe: crisisVsSafe[i]! }))
    .filter((row) => row.score - row.safe >= SAFE_MARGIN);
  const harmlessDangerous = safeVsCrisis
    .map((value, i) => ({ score: value, own: safeVsSafe[i]! }))
    .filter((row) => row.score - row.own >= SAFE_MARGIN);
  const maxFloor = crisisClearing.length
    ? Math.min(...crisisClearing.map((row) => row.score))
    : Number.NaN;
  const minFloor = harmlessDangerous.length
    ? Math.max(...harmlessDangerous.map((row) => row.score))
    : -1;
  console.log(
    `[crisis-semantic] ${crisisClearing.length}/${crisis.length} crisis sentences clear the margin; ` +
    `${harmlessDangerous.length}/${safe.length} harmless sentences would be heard if the floor were low enough`,
  );
  if (!Number.isFinite(maxFloor) || minFloor >= maxFloor) {
    console.log(
      "[crisis-semantic] VERDICT: the two groups overlap at the written margin — no single floor separates them. " +
      "Rewrite the groups or keep the layer out.",
    );
  } else {
    console.log(
      `[crisis-semantic] VERDICT: a floor in (${minFloor.toFixed(3)}, ${maxFloor.toFixed(3)}] separates the groups; ` +
      `the written floor is ${CRISIS_FLOOR}.`,
    );
  }

  // The sentences closest to the boundary, so a wrong one can be found.
  const sortedCrisis = crisis
    .map((_, i) => ({ index: i, score: crisisVsCrisis[i]!, safe: crisisVsSafe[i]! }))
    .sort((a, b) => (a.score - a.safe) - (b.score - b.safe));
  const sortedSafe = safe
    .map((_, i) => ({ index: i, score: safeVsCrisis[i]!, safe: safeVsSafe[i]! }))
    .sort((a, b) => (b.score - b.safe) - (a.score - a.safe));
  console.log("[crisis-semantic] closest crisis sentences to the boundary:");
  for (const row of sortedCrisis.slice(0, 5)) {
    console.log(`  ${row.score.toFixed(3)} / safe ${row.safe.toFixed(3)} — ${CRISIS_EXEMPLARS[row.index]}`);
  }
  console.log("[crisis-semantic] harmless sentences closest to the crisis group:");
  for (const row of sortedSafe.slice(0, 5)) {
    console.log(`  ${row.score.toFixed(3)} / self ${row.safe.toFixed(3)} — ${SAFE_EXEMPLARS[row.index]}`);
  }
}

main().catch((error) => {
  console.error("[crisis-semantic] failed:", error);
  process.exitCode = 1;
});
