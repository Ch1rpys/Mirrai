import { describe, expect, it } from "vitest";
import { heavyModeLabelsNow } from "./heavy-mode";

/**
 * The heavy modes spend nothing without `--yes` (B8.5).
 *
 * `--ablate` and `--tune` are the two modes that print an estimate and
 * wait for `--yes`; everything else is a report you asked for. Labeling the
 * cases is a provider request, so the gate decides whether the run may
 * label at all — before this, `--ablate` without `--yes` labeled the cases
 * (one model call) and only then printed what it would cost.
 */
describe("when the heavy eval modes label their cases (B8.5)", () => {
  it("labels nothing while it is only printing the estimate", () => {
    expect(heavyModeLabelsNow({ ablate: true, tune: false, yes: false })).toBe(false);
    expect(heavyModeLabelsNow({ ablate: false, tune: true, yes: false })).toBe(false);
  });

  it("labels once the run is confirmed", () => {
    expect(heavyModeLabelsNow({ ablate: true, tune: false, yes: true })).toBe(true);
    expect(heavyModeLabelsNow({ ablate: false, tune: true, yes: true })).toBe(true);
  });

  it("labels for the ordinary modes, which have no --yes gate", () => {
    expect(heavyModeLabelsNow({ ablate: false, tune: false, yes: false })).toBe(true);
  });
});
