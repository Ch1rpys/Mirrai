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
