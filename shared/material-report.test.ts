import { describe, expect, it } from "vitest";
import { ACT_MIN_SAMPLES } from "./act-profile";
import { BEHAVIOR_MIN_SAMPLES } from "./behavior-profile";
import { EVAL_MIN_ASSISTANT_LINES } from "./eval-limits";
import { OPENING_MIN_SAMPLES } from "./opening-profile";
import { PERIOD_MIN_MESSAGES } from "./periods";
import {
  MIN_FINGERPRINT_SAMPLES,
  MIN_FINGERPRINT_STATE_SAMPLES,
} from "./style-fingerprint";
import { SUPPRESSION_MIN_SAMPLES } from "./suppressions";
import { RITUAL_MIN_COUNT } from "./ritual-table";
import { buildMaterialReport, MATERIAL_LAYER_NEEDS } from "./material-report";

describe("the material report thresholds", () => {
  it("reads every layer's need from the same constant the layer uses", () => {
    expect(MATERIAL_LAYER_NEEDS.fingerprint).toBe(MIN_FINGERPRINT_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.acts).toBe(ACT_MIN_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.suppressions).toBe(SUPPRESSION_MIN_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.timing).toBe(BEHAVIOR_MIN_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.openings).toBe(OPENING_MIN_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.periods).toBe(PERIOD_MIN_MESSAGES);
    expect(MATERIAL_LAYER_NEEDS.perState).toBe(MIN_FINGERPRINT_STATE_SAMPLES);
    expect(MATERIAL_LAYER_NEEDS.evalCases).toBe(EVAL_MIN_ASSISTANT_LINES);
    expect(MATERIAL_LAYER_NEEDS.rituals).toBe(RITUAL_MIN_COUNT);
    const report = buildMaterialReport({
      total: 0,
      theirs: 0,
      mine: 0,
      others: 0,
      from: null,
      to: null,
      withTimestamps: 0,
      byKind: {},
      byEmotion: {},
      theirsText: 0,
      theirsLabeledAct: 0,
      timedExchanges: 0,
      openings: 0,
      periodHave: 0,
      ritualHave: 0,
    });
    for (const row of report.layers) {
      expect(row.need).toBe(MATERIAL_LAYER_NEEDS[row.id as keyof typeof MATERIAL_LAYER_NEEDS]);
    }
  });

  it("marks the fingerprint short when there are fewer of their lines than the minimum", () => {
    const report = buildMaterialReport({
      total: 30,
      theirs: 15,
      mine: 15,
      others: 0,
      from: null,
      to: null,
      withTimestamps: 30,
      byKind: { text: 30 },
      byEmotion: {},
      theirsText: 15,
      theirsLabeledAct: 0,
      timedExchanges: 8,
      openings: 2,
      periodHave: 0,
      ritualHave: 0,
    });
    const fingerprint = report.layers.find((row) => row.id === "fingerprint");
    expect(fingerprint?.ok).toBe(false);
    expect(fingerprint?.need).toBe(MIN_FINGERPRINT_SAMPLES);
    expect(fingerprint?.have).toBe(15);
    expect(fingerprint!.need - fingerprint!.have).toBe(MIN_FINGERPRINT_SAMPLES - 15);
  });
});
