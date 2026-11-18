/**
 * Whether each generation layer has enough of the record to stand on.
 *
 * The counts come from aggregation. The thresholds are the same
 * constants the layers themselves refuse to run under — copied by
 * import, not by hand.
 */
import { ACT_MIN_SAMPLES } from "./act-profile";
import { BEHAVIOR_MIN_SAMPLES } from "./behavior-profile";
import { EVAL_MIN_ASSISTANT_LINES } from "./eval-limits";
import { OPENING_MIN_SAMPLES } from "./opening-profile";
import { PERIOD_MIN_MESSAGES, PERIOD_SILENCE_DAYS } from "./periods";
import { RECORD_KINDS, type RecordKind } from "./records";
import {
  FINGERPRINT_STATES,
  MIN_FINGERPRINT_SAMPLES,
  MIN_FINGERPRINT_STATE_SAMPLES,
  type EmotionalState,
} from "./style-fingerprint";
import { SUPPRESSION_MIN_SAMPLES } from "./suppressions";

export interface MaterialLayer {
  id: string;
  ok: boolean;
  have: number;
  need: number;
  unit: string;
  /** The state with the fewest labelled lines, when this row is per-state. */
  weakestState?: EmotionalState;
}

export interface MaterialReport {
  total: number;
  theirs: number;
  mine: number;
  others: number;
  from: string | null;
  to: string | null;
  withTimestamps: number;
  byKind: Record<RecordKind, number>;
  byEmotion: Partial<Record<EmotionalState, number>>;
  layers: MaterialLayer[];
}

export interface MaterialCounts {
  total: number;
  theirs: number;
  mine: number;
  others: number;
  from: Date | string | null;
  to: Date | string | null;
  withTimestamps: number;
  byKind: Partial<Record<string, number>>;
  byEmotion: Partial<Record<string, number>>;
  theirsText: number;
  theirsLabeledAct: number;
  timedExchanges: number;
  openings: number;
  periodHave: number;
}

export const MATERIAL_LAYER_NEEDS = {
  fingerprint: MIN_FINGERPRINT_SAMPLES,
  acts: ACT_MIN_SAMPLES,
  suppressions: SUPPRESSION_MIN_SAMPLES,
  timing: BEHAVIOR_MIN_SAMPLES,
  openings: OPENING_MIN_SAMPLES,
  periods: PERIOD_MIN_MESSAGES,
  perState: MIN_FINGERPRINT_STATE_SAMPLES,
  evalCases: EVAL_MIN_ASSISTANT_LINES,
} as const;

export { PERIOD_SILENCE_DAYS };

function emptyKinds(): Record<RecordKind, number> {
  const out = {} as Record<RecordKind, number>;
  for (const kind of RECORD_KINDS) out[kind] = 0;
  return out;
}

function isoOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function layer(
  id: string,
  have: number,
  need: number,
  unit: string,
  extra?: Pick<MaterialLayer, "weakestState">,
): MaterialLayer {
  return { id, ok: have >= need, have, need, unit, ...extra };
}

export function buildMaterialReport(counts: MaterialCounts): MaterialReport {
  const byKind = emptyKinds();
  for (const [kind, n] of Object.entries(counts.byKind)) {
    if (kind in byKind) byKind[kind as RecordKind] = n ?? 0;
  }
  const byEmotion: Partial<Record<EmotionalState, number>> = {};
  for (const state of FINGERPRINT_STATES) {
    const n = counts.byEmotion[state];
    if (typeof n === "number" && n > 0) byEmotion[state] = n;
  }
  let weakestState: EmotionalState = FINGERPRINT_STATES[0];
  let weakestHave = counts.byEmotion[weakestState] ?? 0;
  for (const state of FINGERPRINT_STATES) {
    const n = counts.byEmotion[state] ?? 0;
    if (n < weakestHave) {
      weakestState = state;
      weakestHave = n;
    }
  }
  return {
    total: counts.total,
    theirs: counts.theirs,
    mine: counts.mine,
    others: counts.others,
    from: isoOf(counts.from),
    to: isoOf(counts.to),
    withTimestamps: counts.withTimestamps,
    byKind,
    byEmotion,
    layers: [
      layer("fingerprint", counts.theirsText, MATERIAL_LAYER_NEEDS.fingerprint, "lines"),
      layer("acts", counts.theirsLabeledAct, MATERIAL_LAYER_NEEDS.acts, "turns"),
      layer("suppressions", counts.theirsText, MATERIAL_LAYER_NEEDS.suppressions, "lines"),
      layer("timing", counts.timedExchanges, MATERIAL_LAYER_NEEDS.timing, "exchanges"),
      layer("openings", counts.openings, MATERIAL_LAYER_NEEDS.openings, "openings"),
      layer("periods", counts.periodHave, MATERIAL_LAYER_NEEDS.periods, "lines"),
      layer("perState", weakestHave, MATERIAL_LAYER_NEEDS.perState, "lines", { weakestState }),
      layer("evalCases", counts.theirsText, MATERIAL_LAYER_NEEDS.evalCases, "lines"),
    ],
  };
}
