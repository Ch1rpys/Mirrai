import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { heavyModeLabelsNow, labelEvalCasesForRun } from "./heavy-mode";

const SCRIPT = readFileSync(join(__dirname, "../../scripts/eval-run.ts"), "utf8");

type Case = { id: number; act?: string };

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

/**
 * The gate and the model call are one step (B8.5).
 *
 * The previous test file called the pure decision function and proved
 * only that it answers correctly. The script still called the labeler
 * before the decision — the reported regression — and every test stayed
 * green. These drive the real preflight: the labeler is a spy, so the
 * assertion is not "the decision says no" but "the model was not called
 * at all", which is what the user pays for.
 */
describe("the run's labeling preflight (B8.5)", () => {
  const cut: Case[] = [{ id: 1 }, { id: 2 }];
  const labelled: Case[] = [
    { id: 1, act: "question" },
    { id: 2, act: "answer" },
  ];
  const makeLabeler = () => vi.fn(async (_cases: Case[]) => labelled);

  it("does not call the labeler for --ablate without --yes", async () => {
    const label = makeLabeler();
    const result = await labelEvalCasesForRun({
      ablate: true,
      tune: false,
      yes: false,
      cases: cut,
      label,
    });

    // The user pays for this call; it must not happen at all.
    expect(label).not.toHaveBeenCalled();
    expect(result.labelsNow).toBe(false);
    expect(result.cases).toEqual([]);
  });

  it("does not call the labeler for --tune without --yes", async () => {
    const label = makeLabeler();
    const result = await labelEvalCasesForRun({
      ablate: false,
      tune: true,
      yes: false,
      cases: cut,
      label,
    });

    // The user pays for this call; it must not happen at all.
    expect(label).not.toHaveBeenCalled();
    expect(result.labelsNow).toBe(false);
    expect(result.cases).toEqual([]);
  });

  it("labels once --yes confirms the spend", async () => {
    const label = makeLabeler();
    const result = await labelEvalCasesForRun({
      ablate: true,
      tune: false,
      yes: true,
      cases: cut,
      label,
    });

    expect(result.labelsNow).toBe(true);
    expect(label).toHaveBeenCalledTimes(1);
    expect(label).toHaveBeenCalledWith(cut);
    expect(result.cases).toEqual(labelled);
  });

  it("labels for the ordinary modes, which are not waiting for --yes", async () => {
    const label = makeLabeler();
    const result = await labelEvalCasesForRun({
      ablate: false,
      tune: false,
      yes: false,
      cases: cut,
      label,
    });

    expect(result.labelsNow).toBe(true);
    expect(label).toHaveBeenCalledTimes(1);
  });

  /**
   * The wiring, so a revert to "label first, decide after" is red.
   *
   * The behavior test above pins the function; this pins that the CLI
   * uses it. The script must (a) have the guarded preflight, (b) pass
   * the labeler into it, and (c) call `labelEvalCases` exactly once —
   * from inside that call. A direct `await labelEvalCases(...)` before
   * the gate would need a second call site.
   */
  it("gets its cases from the guarded preflight in scripts/eval-run.ts", () => {
    expect(SCRIPT).toMatch(/labelEvalCasesForRun(?:<[^>]*>)?\(\{/);
    expect(SCRIPT.match(/labelEvalCases\(/g) ?? []).toHaveLength(1);
    expect(SCRIPT.indexOf("labelEvalCasesForRun(")).toBeLessThan(
      SCRIPT.indexOf("labelEvalCases("),
    );
    // The labeler is the function passed to the gate, not a call the
    // script makes on its own.
    expect(SCRIPT).toMatch(
      /labelEvalCasesForRun(?:<[^>]*>)?\(\{[\s\S]{0,400}?label:\s*async[\s\S]{0,200}?labelEvalCases\(/,
    );
    // The old "decide, then label in the same expression" shape is gone.
    expect(SCRIPT).not.toMatch(/labelsNow\s*\?\s*\(await labelEvalCases\(/);
  });
});
