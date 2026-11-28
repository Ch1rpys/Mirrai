/**
 * When the heavy eval modes may spend anything (B8.5).
 *
 * `--ablate` and `--tune` are gated behind `--yes`: without it they print
 * an estimate and stop. Labeling the held-out cases is already a model
 * call — it asks the provider to name the speech act of every unlabelled
 * line — so it counts as spending. It used to run before the estimate and
 * before the `--yes` check, which meant "just show me what it would cost"
 * quietly paid for one provider request first.
 *
 * The decision lives in one function so it is testable without starting
 * the CLI: the script asks it before labeling anything.
 */
export function heavyModeLabelsNow(params: {
  ablate: boolean;
  tune: boolean;
  yes: boolean;
}): boolean {
  return !((params.ablate || params.tune) && !params.yes);
}

/**
 * The preflight and the labeling together (B8.5).
 *
 * The gate above and the labeler call were two separate statements in
 * `scripts/eval-run.ts`. A test could call the gate and be told "do not
 * label", while the script called the model one statement earlier — the
 * old behaviour could be restored without a red test, because only the
 * pure function was under test.
 *
 * Handing the labeler to this function makes the gate the only door:
 * the model is called from inside it, and only after the gate says the
 * run may spend. The caller gets the decision and the cases in one
 * value, so there is no "the decision is false but here are some cases
 * anyway" shape to fall back into.
 */
export async function labelEvalCasesForRun<T>(params: {
  /** `--ablate` was passed. */
  ablate: boolean;
  /** `--tune` was passed. */
  tune: boolean;
  /** `--yes` was passed. */
  yes: boolean;
  /** The cases as cut, before labeling. Only read when the gate opens. */
  cases: T[];
  /** The model-backed labeler. Must not be called when the gate is shut. */
  label: (cases: T[]) => Promise<T[]>;
}): Promise<{ labelsNow: boolean; cases: T[] }> {
  if (!heavyModeLabelsNow(params)) return { labelsNow: false, cases: [] };
  return { labelsNow: true, cases: await params.label(params.cases) };
}
