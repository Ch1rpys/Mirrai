/**
 * Which layers actually move the numbers.
 *
 * A layer that is on in the prompt is not necessarily doing work. This
 * measures the same cases with the layer off, and reads the difference
 * against the noise of the run — the same three verdicts `--compare`
 * already uses.
 */
import { copy } from "@shared/copy";
import { isLayerId, type LayerId } from "@shared/layers";
import { compareMetricCI, type EvalMetrics } from "./metrics";
import type { Locale } from "@shared/copy";

export interface AblationRow {
  layer: LayerId;
  overlap: number;
  likelihoodGap: number;
  styleDistance: number;
  actMatch: number;
  verdict: string;
}

export interface AblationReport {
  baseline: EvalMetrics;
  rows: AblationRow[];
}

const MEASURES = [
  ["overlap", "higher"],
  ["likelihoodGap", "closer"],
  ["style", "closer"],
  ["actMatch", "higher"],
] as const;

export function ablationVerdict(on: EvalMetrics, off: EvalMetrics, locale: Locale): string {
  const verdicts = MEASURES.map(([key, better]) => compareMetricCI(on, off, key, better));
  if (verdicts.some((verdict) => verdict === "worse")) return copy(locale, "eval.ablate.worse");
  if (verdicts.some((verdict) => verdict === "better")) return copy(locale, "eval.ablate.helps");
  return copy(locale, "eval.ablate.noise");
}

export function ablationCalls(layers: number, cases: number, k: number): number {
  return (layers + 1) * cases * Math.max(1, k);
}

export function layersFromBaseline(metrics: EvalMetrics): LayerId[] {
  return (metrics.layersUsed ?? []).filter(isLayerId);
}

/**
 * Turns the default run and the per-layer off runs into one table.
 */
export function tabulateAblation(
  baseline: EvalMetrics,
  offByLayer: Array<{ layer: LayerId; metrics: EvalMetrics }>,
  locale: Locale = "zh",
): AblationReport {
  const rows: AblationRow[] = offByLayer.map(({ layer, metrics }) => ({
    layer,
    overlap: baseline.overlap - metrics.overlap,
    likelihoodGap: baseline.likelihoodGap - metrics.likelihoodGap,
    styleDistance: (baseline.styleDistance?.total ?? 0) - (metrics.styleDistance?.total ?? 0),
    actMatch: (baseline.actMatch ?? 0) - (metrics.actMatch ?? 0),
    verdict: ablationVerdict(baseline, metrics, locale),
  }));
  return { baseline, rows };
}

export async function runAblation(options: {
  baseline: EvalMetrics;
  layers?: LayerId[];
  locale?: Locale;
  runWithout: (layer: LayerId) => Promise<EvalMetrics>;
}): Promise<AblationReport> {
  const locale = options.locale ?? "zh";
  const layers = options.layers ?? layersFromBaseline(options.baseline);
  const offByLayer: Array<{ layer: LayerId; metrics: EvalMetrics }> = [];
  for (const layer of layers) {
    offByLayer.push({ layer, metrics: await options.runWithout(layer) });
  }
  return tabulateAblation(options.baseline, offByLayer, locale);
}
