/**
 * The command line face of the evaluation.
 *
 * It answers the question the whole test suite could not: does the
 * rebuilt persona still sound like the person it was built from?
 *
 * The cases are cut from the imported chat records — one of their lines
 * is held back — and the rebuilt persona has to say it again. The answer
 * is scored against the line that was actually said, and the run is
 * compared with the baseline so that a change which makes the persona
 * worse cannot pass unnoticed.
 *
 * Usage:
 *   pnpm eval -- --persona 1 --user 1            # score one persona
 *   pnpm eval -- --persona 1 --user 1 --variant withoutRules
 *   pnpm eval -- --persona 1 --user 1 --without act,rerank
 *   pnpm eval -- --persona 1 --user 1 --cases    # only cut the cases
 *   pnpm eval -- --persona 1 --user 1 --save     # store the run
 */
import * as db from "../server/db";
import {
  buildEvalCases,
  casesFromRows,
  trainingTexts,
  type EvalCaseData,
  type EvalSourceMessage,
} from "../server/eval/dataset";
import { normalizePeriods } from "../shared/periods";
import { dayPartFromHour } from "../shared/act-profile";
import { zoneForRecords, zonedHour } from "../shared/timezone";
import { labelEvalCases } from "../server/eval/act-labels";
import { heavyModeLabelsNow } from "../server/eval/heavy-mode";
import { previewLayersUsed, runEval } from "../server/eval/run";
import {
  compareMetricCI,
  evaluateGate,
  resolveGateTolerances,
  type EvalMetrics,
} from "../server/eval/metrics";
import { copy } from "@shared/copy";
import { normalizeStyleProfile } from "@shared/style-profile";
import {
  DISCRIMINATOR_MIN_PAIRS,
  discriminatorForMetrics,
  pairsFromEvalRuns,
  pairsFromScores,
  trainDiscriminator,
} from "../server/eval/discriminator";
import { DriftNeedUserSideError, DRIFT_TURNS_DEFAULT, runDrift } from "../server/eval/drift";
import { attachComposite, runAudition, type AuditionResult } from "../server/eval/audition";
import { ablationCalls, layersFromBaseline, runAblation } from "../server/eval/ablate";
import { resolveProviderForUser } from "../server/llm/user-provider";
import { evaluateUnlockCheck, formatUnlockCheck } from "../server/eval/unlock-check";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** A number from the command line, or nothing when it is not one. */
function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const personaId = Number(flag("persona"));
const userId = Number(flag("user"));
const variant = (flag("variant") ?? "default") as
  | "default"
  | "withoutRules"
  | "withRulesOnly"
  | "withoutAct"
  | "withoutRerank";
const rerank = !args.includes("--no-rerank") && variant !== "withoutRerank";
const without = (flag("without") ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const onlyCases = args.includes("--cases");
const save = args.includes("--save");
/**
 * The gate.
 *
 * With `--gate`, the run is compared with the last saved run and the
 * process fails if the persona got less alike. Without it, the same
 * comparison happens but the process still exits zero — the run is a
 * report, not a verdict.
 */
const gate = args.includes("--gate");
/**
 * Measures the same persona both ways.
 *
 * This is the A/B the rules have to pass: if they do not move the
 * numbers, they do not belong in the prompt.
 */
const compare = args.includes("--compare");
/**
 * Whether to print the pairs the blind test needs.
 *
 * The real line and the one the persona said, side by side, with
 * nothing saying which is which.
 */
const pairs = args.includes("--pairs");
const maxFlag = flag("max");
const maxCases = maxFlag !== undefined ? Number(maxFlag) : undefined;
const samplesPerCase = Math.max(1, Number(flag("k") ?? 1));
/**
 * Train the small model that tries to tell a real line from a rebuilt one.
 *
 * The evaluation has to run first so there are pairs to learn from.
 * `--k 3` is the suggested way to get enough of them.
 */
const wantDiscriminator = args.includes("--discriminator");
/**
 * Talks to the persona for many turns and watches the fingerprint.
 *
 * A held-out line is one turn. This is the other question: does the
 * voice hold after fifty.
 */
const drift = args.includes("--drift");
const driftTurns = Math.max(1, Number(flag("turns") ?? DRIFT_TURNS_DEFAULT));
/**
 * Tries every model this user can use on the same held-out cases.
 */
const audition = args.includes("--audition");
/**
 * Measures each on layer against the same cases with that layer off.
 *
 * It costs (layers + 1) × cases × k calls, so it does not run unless
 * `--yes` is also passed.
 */
const ablate = args.includes("--ablate");
/**
 * Tries a small temperature × topP grid and ranks the sets.
 *
 * It costs 6 × cases × k calls, so it does not run unless `--yes`
 * is also passed. Nothing is written back.
 */
const tune = args.includes("--tune");
const yes = args.includes("--yes");
/**
 * Answers whether the heavy approaches are unlocked yet (B9.1/B9.2).
 *
 * It reads and prints. It does not train anything, not even when the
 * answer is yes.
 */
const unlockCheck = args.includes("--unlock-check");
/**
 * The language the records are written in.
 *
 * The emotion is read off the words, so it is read with the trigger
 * table of the language they are in. Reading an English record with the
 * Chinese table finds no emotion in any line — and every per-state
 * number is then empty rather than wrong-looking, which is worse.
 */
const locale = (flag("locale") ?? "zh") === "en" ? "en" : "zh";

/**
 * The temperature the generation runs at.
 *
 * It was never declared — the file did not compile, so the whole
 * evaluation threw a ReferenceError on every path.
 */
const temperature = Number(flag("temperature") ?? 0.7);
const topPFlag = numberOrUndefined(flag("topP"));

/**
 * The calibration.
 *
 * "How far do the numbers move when nothing has changed?" — the
 * tolerances are set from that spread rather than from a guess.
 */
const calibrate = args.includes("--calibrate");
const calibrateRuns = Math.max(1, Number(flag("calibrate-runs") ?? 3));

/**
 * The tolerances the gate uses.
 *
 * Each one is how far a number may move before it counts as a
 * regression. They are a guess until they are calibrated.
 */
const flagTolerances = {
  overlap: numberOrUndefined(flag("tolerance-overlap")),
  likelihoodGap: numberOrUndefined(flag("tolerance-likelihood")),
  emotionAccuracy: numberOrUndefined(flag("tolerance-emotion")),
  style: numberOrUndefined(flag("tolerance-style")),
};

if (!Number.isFinite(personaId) || !Number.isFinite(userId)) {
  console.error(
    "Usage: pnpm eval -- --persona <id> --user <id> [--variant withoutRules|withoutAct|withoutRerank] [--without a,b] [--no-rerank] [--locale zh|en] [--cases] [--pairs] [--save] [--gate] [--compare] [--calibrate] [--calibrate-runs n] [--temperature n] [--topP n] [--k n] [--discriminator] [--drift] [--turns n] [--audition] [--ablate] [--tune] [--yes] [--unlock-check] [--tolerance-overlap n] [--tolerance-likelihood n] [--tolerance-emotion n] [--tolerance-style n]",
  );
  process.exit(1);
}

if (unlockCheck) {
  /**
   * The unlock check (B9.1/B9.2): read only, no model, no training.
   *
   * It is answered from what is already stored — the persona's switches,
   * the blind sittings others have finished, the judge's stored AUC, and
   * the line count. A persona with no records is still answerable: the
   * verdict will simply be no.
   */
  try {
    const person = await db.getPersonaById(personaId, userId);
    if (!person) {
      console.error("No such persona.");
      process.exit(1);
    }
    const sessions = await db.listBlindSessions(personaId, userId);
    const taTextLines = await db.countRecords(personaId, userId, {
      role: "assistant",
      kinds: ["text"],
    });
    const report = evaluateUnlockCheck({ persona: person, sessions, taTextLines });
    for (const line of formatUnlockCheck(report, locale)) console.log(line);
    process.exit(0);
  } catch (error) {
    console.error("The unlock check could not read the data:", (error as Error).message);
    process.exit(1);
  }
}

/**
 * The recorded messages, in the order they were said.
 *
 * The records are the ground truth. The app's own conversation is not
 * used here — the persona wrote that one, so measuring against it would
 * measure nothing.
 */
async function loadRecords(): Promise<EvalSourceMessage[]> {
  const rows = await db.getCollectedMessagesForPersona(personaId, userId, { newest: true });
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      id: row.id,
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: row.content,
      timestamp: row.timestamp ?? null,
      kind: (row as { kind?: string | null }).kind,
      emotion: (row as { emotion?: string | null }).emotion,
      act: (row as { act?: string | null }).act,
      actSource: (row as { actSource?: string | null }).actSource,
    }))
    .filter((message) => message.content.trim().length > 0);
}

const records = await loadRecords();
if (!records.length) {
  console.error("No collected records for this persona. Import the chat logs first.");
  process.exit(1);
}

/**
 * The persona and the training texts.
 *
 * They were declared further down — after the branches that use them —
 * so the `--pairs` branch could not reach them. The declarations are
 * here now, before the first use. Cutting cases also needs the periods
 * and the timezone, so the persona is loaded before the cut.
 */
const persona = await db.getPersonaById(personaId, userId);
if (!persona) {
  console.error("No such persona.");
  process.exit(1);
}

const periods = normalizePeriods(
  (persona.personaData as { periods?: unknown } | null)?.periods,
);
const timezone = zoneForRecords(
  (persona as { timezone?: string | null }).timezone,
  await db.getUserTimezone(userId),
);
if (!persona.timezone && timezone) persona.timezone = timezone;

function withDayPart(item: EvalCaseData): EvalCaseData {
  if (item.dayPart) return item;
  if (!item.expected.timestamp) return item;
  return {
    ...item,
    dayPart: dayPartFromHour(zonedHour(item.expected.timestamp, timezone)),
  };
}

// The stored cases are the ones that get measured. Cutting a fresh set
// every time would measure a different question each time — and the
// comparison with the baseline would be between two different things,
// which is the one thing a gate must never be.
const stored = casesFromRows(await db.getEvalCases(personaId, userId)).map(withDayPart);
const cut = stored.length
  ? stored
  : buildEvalCases(records, { maxCases, locale, periods, timezone });
/**
 * Labeling the cases is a model call (B8.5).
 *
 * `--ablate` and `--tune` without `--yes` only print an estimate, so they
 * must not label anything: the labeler asks the provider to name the
 * speech act of every line that has none, and "show me the cost" was
 * paying for one request before it printed the cost.
 */
const labelsNow = heavyModeLabelsNow({ ablate, tune, yes });
const cases: EvalCaseData[] = labelsNow
  ? (await labelEvalCases(cut, { userId, locale })).map(withDayPart)
  : [];
if (labelsNow && (!stored.length || cut.some((item) => !item.expectedAct))) {
  await db.saveEvalCases(
    personaId,
    userId,
    cases.map((item: EvalCaseData) => ({
      context: item.context,
      expected: item.expected,
      expectedState: item.expectedState,
      expectedAct: item.expectedAct ?? null,
      expectedActSource: item.expectedActSource ?? null,
      source: "collected",
      occurredAt: item.expected.timestamp ?? null,
      periodId: item.periodId ?? null,
    })),
  );
}
console.log(
  `[eval] ${records.length} records → ${(labelsNow ? cases : cut).length} held-out cases` +
    (stored.length ? " (the stored ones)" : ""),
);

const training = trainingTexts(records, cases);

if (pairs) {
  // The blind test needs the two lines side by side: the real one and
  // the one the persona said. It is a human measurement — a person who
  // knew the person deciding which of the two is theirs — and it needs
  // the lines themselves, not a number about them.
  const blind = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant,
    without,
    locale,
    rerank,
    sampleAct: variant !== "withoutAct",
    samplesPerCase,
  });
  console.log("");
  console.log("[eval] the pairs for the blind test:");
  for (const score of blind.scores) {
    console.log("");
    console.log(`  case ${score.caseId}`);
    console.log(`    real: ${score.expectedText ?? ""}`);
    console.log(`    said: ${score.generatedText ?? ""}`);
  }
  console.log("");
  console.log("Give each pair to someone who knew the person, without saying which is which.");
  process.exit(0);
}

if (onlyCases) {
  for (const item of cases) {
    console.log(`  · ${item.expectedState ?? "—"}  ${item.expected.content.slice(0, 48)}`);
  }
  process.exit(0);
}

if (drift) {
  const sampleLines = normalizeStyleProfile(persona.styleProfile).userSide?.sampleLines ?? [];
  if (!sampleLines.filter((line) => line.trim()).length) {
    console.error(copy(locale, "eval.drift.needUserSide"));
    process.exit(1);
  }
  if (!cases.length) {
    console.error("No held-out cases to start from.");
    process.exit(1);
  }
  const provider = await resolveProviderForUser({ userId });
  if (!provider) {
    console.error("No LLM provider is configured for this user.");
    process.exit(1);
  }
  let report;
  try {
    report = await runDrift({
      persona,
      userId,
      turns: driftTurns,
      startCase: cases[0]!,
      provider,
      seed: `eval-drift:${personaId}`,
      locale,
    });
  } catch (error) {
    if (error instanceof DriftNeedUserSideError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  console.log("");
  console.log("[eval] drift windows:");
  for (const window of report.windows) {
    console.log(
      `  window ${window.index}` +
        `  surprise=${window.surprise.toFixed(4)}` +
        `  residue=${window.residueRate.toFixed(4)}` +
        `  style=${window.styleDistance.total.toFixed(4)}`,
    );
  }
  console.log(`[eval] slope: ${report.slope.toFixed(4)}`);
  console.log(
    `[eval] first window over: ${report.firstWindowOver == null ? "none" : report.firstWindowOver}`,
  );
  console.log(
    report.firstWindowOver == null
      ? "[eval] the voice stayed inside the first window"
      : `[eval] the voice drifted from window ${report.firstWindowOver}`,
  );
  if (save) {
    await db.saveEvalRun(
      personaId,
      userId,
      {
        variant: "drift",
        windows: report.windows,
        slope: report.slope,
        firstWindowOver: report.firstWindowOver,
        cases: report.turns.length,
      },
      persona.personaData,
    );
    console.log("[eval] run saved");
  }
  process.exit(0);
}

if (audition) {
  if (!cases.length) {
    console.error("No held-out cases to start from.");
    process.exit(1);
  }
  const report = await runAudition({
    persona,
    userId,
    cases,
    trainingTexts: training,
    locale,
  });
  console.log("");
  console.log("[eval] audition:");
  console.log(
    "  model".padEnd(28) +
      "composite".padStart(10) +
      "overlap".padStart(10) +
      "style".padStart(10) +
      "residue".padStart(10) +
      "chars".padStart(10) +
      "ms".padStart(10),
  );
  for (const row of report.results) {
    if (row.error) {
      console.log(`  ${row.label.padEnd(26)}  ${row.error}`);
      continue;
    }
    console.log(
      `  ${row.label.slice(0, 26).padEnd(26)}` +
        `${(row.composite ?? 0).toFixed(3).padStart(10)}` +
        `${(row.overlap ?? 0).toFixed(3).padStart(10)}` +
        `${(row.styleDistance ?? 0).toFixed(3).padStart(10)}` +
        `${(row.residueRate ?? 0).toFixed(3).padStart(10)}` +
        `${(row.avgChars ?? 0).toFixed(1).padStart(10)}` +
        `${Math.round(row.avgMs ?? 0).toString().padStart(10)}`,
    );
  }
  console.log(`[eval] ${report.cases} cases × ${report.results.length} models ≈ ${report.calls} calls`);
  process.exit(0);
}

if (ablate) {
  const previewLayers = await previewLayersUsed({
    persona,
    userId,
    cases: labelsNow ? cases : cut,
    locale,
    variant,
    without,
    rerank,
    sampleAct: variant !== "withoutAct",
  });
  const previewCases = labelsNow ? cases : cut;
  const estimated = ablationCalls(previewLayers.length, previewCases.length, samplesPerCase);
  console.log(
    `[eval] ablation would make ${previewLayers.length + 1} runs × ${previewCases.length} cases × ${samplesPerCase} = ${estimated} calls`,
  );
  if (!yes) {
    console.log("[eval] pass --yes to run");
    process.exit(0);
  }
  const baseline = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant,
    without,
    locale,
    temperature,
    rerank,
    sampleAct: variant !== "withoutAct",
    samplesPerCase,
  });
  const layers = layersFromBaseline(baseline);
  const report = await runAblation({
    baseline,
    layers,
    locale,
    runWithout: (layer) =>
      runEval({
        persona,
        userId,
        cases,
        trainingTexts: training,
        variant,
        without: [...without, layer],
        locale,
        temperature,
        rerank: layer === "rerank" ? false : rerank,
        sampleAct: variant !== "withoutAct",
        samplesPerCase,
      }),
  });
  console.log("");
  console.log("[eval] ablation:");
  console.log(
    "  layer".padEnd(20) +
      "overlap".padStart(10) +
      "likelihood".padStart(12) +
      "style".padStart(10) +
      "actMatch".padStart(10) +
      "  verdict",
  );
  for (const row of report.rows) {
    console.log(
      `  ${row.layer.padEnd(18)}` +
        `${row.overlap.toFixed(3).padStart(10)}` +
        `${row.likelihoodGap.toFixed(3).padStart(12)}` +
        `${row.styleDistance.toFixed(3).padStart(10)}` +
        `${row.actMatch.toFixed(3).padStart(10)}` +
        `  ${row.verdict}`,
    );
  }
  if (save) {
    await db.saveEvalRun(
      personaId,
      userId,
      { variant: "ablate", layers: report.rows, baseline },
      persona.personaData,
    );
    console.log("[eval] run saved");
  }
  process.exit(0);
}

const TUNE_TEMPERATURES = [0.6, 0.8, 1.0] as const;
const TUNE_TOP_P = [0.9, 1] as const;

if (tune) {
  const combos = TUNE_TEMPERATURES.length * TUNE_TOP_P.length;
  const previewCases = labelsNow ? cases : cut;
  const estimated = combos * previewCases.length * samplesPerCase;
  console.log(
    `[eval] tune would make ${combos} grids × ${previewCases.length} cases × ${samplesPerCase} = ${estimated} calls`,
  );
  if (!yes) {
    console.log("[eval] pass --yes to run");
    process.exit(0);
  }
  if (!cases.length) {
    console.error("No held-out cases to start from.");
    process.exit(1);
  }
  const rows: Array<AuditionResult & { temperature: number; topP: number }> = [];
  for (const gridTemperature of TUNE_TEMPERATURES) {
    for (const gridTopP of TUNE_TOP_P) {
      const metrics = await runEval({
        persona,
        userId,
        cases,
        trainingTexts: training,
        variant,
        without,
        locale,
        temperature: gridTemperature,
        topP: gridTopP,
        rerank,
        sampleAct: variant !== "withoutAct",
        samplesPerCase,
      });
      rows.push({
        id: `t${gridTemperature}-p${gridTopP}`,
        providerName: "tune",
        model: "",
        label: `temperature ${gridTemperature} · topP ${gridTopP}`,
        temperature: gridTemperature,
        topP: gridTopP,
        overlap: metrics.overlap,
        likelihoodGap: metrics.likelihoodGap,
        lengthDistance: metrics.lengthDistance,
        emotionAccuracy: metrics.emotionAccuracy,
        styleDistance: metrics.styleDistance?.total ?? null,
        residueRate: metrics.residueRate ?? 0,
      });
    }
  }
  const ranked = attachComposite(rows) as Array<AuditionResult & { temperature: number; topP: number }>;
  console.log("");
  console.log("[eval] tune:");
  console.log(
    "  sampling".padEnd(32) +
      "composite".padStart(10) +
      "overlap".padStart(10) +
      "style".padStart(10),
  );
  for (const row of ranked) {
    console.log(
      `  ${row.label.padEnd(30)}` +
        `${(row.composite ?? 0).toFixed(3).padStart(10)}` +
        `${(row.overlap ?? 0).toFixed(3).padStart(10)}` +
        `${(row.styleDistance ?? 0).toFixed(3).padStart(10)}`,
    );
  }
  const best = ranked[0];
  if (best && best.composite != null) {
    console.log(
      `[eval] best: temperature ${best.temperature} topP ${best.topP}`,
    );
    console.log(
      `[eval] apply with: corepack pnpm eval -- --persona ${personaId} --user ${userId} --temperature ${best.temperature} --topP ${best.topP}`,
    );
    console.log("[eval] nothing was written; set the persona's sampling sliders yourself if you want to keep it.");
  }
  process.exit(0);
}

/**
 * The A/B.
 *
 * The rules and the per-state imperfection could make the numbers better
 * and the persona worse. The only way to know is to measure the same
 * persona both ways — with them and without them — and look at the
 * difference.
 *
 * So: "the rules are worth keeping if they make the persona measurably
 * closer to the person". If they do not, they are decoration, and a
 * prompt full of decoration is a prompt full of noise.
 */
if (compare) {
  const withThem = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "default",
    without,
    locale,
    temperature,
    rerank,
    samplesPerCase,
  });
  const withoutThem = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "withoutRules",
    without,
    locale,
    temperature,
    rerank: false,
    samplesPerCase,
  });
  const withoutAct = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "withoutAct",
    without,
    locale,
    temperature,
    rerank,
    samplesPerCase,
  });
  const withoutRerank = await runEval({
    persona,
    userId,
    cases,
    trainingTexts: training,
    variant: "withoutRerank",
    without,
    locale,
    temperature,
    rerank: false,
    samplesPerCase,
  });

  const valueOf = (metrics: EvalMetrics, key: "overlap" | "likelihoodGap" | "style" | "actMatch" | "emotion" | "residue") => {
    if (key === "overlap") return metrics.overlap;
    if (key === "likelihoodGap") return metrics.likelihoodGap;
    if (key === "style") return metrics.styleDistance?.total ?? 0;
    if (key === "actMatch") return metrics.actMatch ?? 0;
    if (key === "emotion") return metrics.emotionAccuracy;
    return metrics.residueRate ?? 0;
  };

  const row = (
    label: string,
    a: EvalMetrics,
    b: EvalMetrics,
    key: "overlap" | "likelihoodGap" | "style" | "actMatch",
    better: "higher" | "closer",
  ) => {
    const left = valueOf(a, key);
    const right = valueOf(b, key);
    const delta = left - right;
    const verdict = compareMetricCI(a, b, key, better);
    console.log(
      `  ${label.padEnd(12)} with=${left.toFixed(4)}  without=${right.toFixed(4)}  ` +
        `delta=${delta > 0 ? "+" : ""}${delta.toFixed(4)}  ${verdict}`,
    );
    return verdict;
  };

  console.log("");
  console.log("[eval] the same persona, measured both ways:");
  const overlapV = row("overlap", withThem, withoutThem, "overlap", "higher");
  const likelihoodV = row("likelihood", withThem, withoutThem, "likelihoodGap", "closer");
  const actV = row("actMatch", withThem, withoutThem, "actMatch", "higher");
  const styleV = row("style", withThem, withoutThem, "style", "closer");
  console.log(
    `  ${"emotion".padEnd(12)} with=${withThem.emotionAccuracy.toFixed(4)}  without=${withoutThem.emotionAccuracy.toFixed(4)}`,
  );
  console.log(
    `  ${"residue".padEnd(12)} with=${(withThem.residueRate ?? 0).toFixed(4)}  without=${(withoutThem.residueRate ?? 0).toFixed(4)}`,
  );
  console.log("");
  console.log("[eval] action sampling on vs off:");
  row("actMatch", withThem, withoutAct, "actMatch", "higher");
  row("likelihood", withThem, withoutAct, "likelihoodGap", "closer");
  console.log("");
  console.log("[eval] rerank on vs off:");
  row("actMatch", withThem, withoutRerank, "actMatch", "higher");
  row("likelihood", withThem, withoutRerank, "likelihoodGap", "closer");
  if (withThem.variant?.includes("picked")) {
    console.log(`[eval] why it won   : ${withThem.variant}`);
  }

  const useful = [overlapV, likelihoodV, styleV, actV].filter((verdict) => verdict === "better").length;
  const note =
    useful === 0
      ? "The rules do not make the persona measurably closer. They are decoration — remove them."
      : `The rules help on ${useful} of 4 measures.`;
  console.log("");
  if (save) {
    await db.saveEvalRun(
      personaId,
      userId,
      { ...withThem, variant: "default" },
      persona.personaData,
    );
    console.log("[eval] run saved");
  }
  // The run is saved before the gate decides, so `--save` saves whether
  // or not the gate passes. A flag that quietly stops working when
  // something else fails is a flag nobody can rely on.
  if (useful === 0) {
    console.error(`[eval] ${note}`);
    if (gate) process.exit(3);
  } else {
    console.log(`[eval] ${note}`);
  }
  process.exit(0);
}

/**
 * The calibration.
 *
 * The tolerances above are a guess. A guess is not good enough for a
 * gate, because the measurement is sampled: two runs of an unchanged
 * persona do not agree, and if the tolerance is narrower than that
 * disagreement the gate is measuring the weather.
 *
 * So this runs the same persona several times, with nothing changed,
 * and reports how far the numbers move. The tolerances are then set from
 * that spread rather than from a guess — and the guess can be replaced
 * with a number that means something.
 */
if (calibrate) {
  const runs: EvalMetrics[] = [];
  for (let i = 0; i < calibrateRuns; i++) {
    console.log(`[eval] calibration run ${i + 1} of ${calibrateRuns}…`);
    runs.push(
      await runEval({
        persona,
        userId,
        cases,
        trainingTexts: training,
        variant,
        without,
        locale,
        temperature,
        rerank,
        sampleAct: variant !== "withoutAct",
        samplesPerCase,
      }),
    );
  }

  const spread = (values: number[]): { min: number; max: number; width: number } => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, width: max - min };
  };

  console.log("");
  console.log("[eval] how far the numbers move when nothing has changed:");
  const overlaps = spread(runs.map((r) => r.overlap));
  const likelihoods = spread(runs.map((r) => r.likelihoodGap));
  const emotions = spread(runs.map((r) => r.emotionAccuracy));
  console.log(`  overlap        ${overlaps.min.toFixed(4)} … ${overlaps.max.toFixed(4)}   (moves ${overlaps.width.toFixed(4)})`);
  console.log(`  likelihoodGap  ${likelihoods.min.toFixed(4)} … ${likelihoods.max.toFixed(4)}   (moves ${likelihoods.width.toFixed(4)})`);
  console.log(`  emotionAccuracy ${emotions.min.toFixed(4)} … ${emotions.max.toFixed(4)}   (moves ${emotions.width.toFixed(4)})`);
  console.log("");
  console.log("[eval] Set the tolerances wider than that spread, or the gate is");
  console.log("[eval] measuring the weather rather than the persona:");
  console.log("  pnpm eval -- --tolerance-overlap " + (overlaps.width * 1.5).toFixed(3) +
    " --tolerance-likelihood " + (likelihoods.width * 1.5).toFixed(3) +
    " --tolerance-emotion " + (emotions.width * 1.5).toFixed(3) +
    " --tolerance-style " + ((spread(runs.map((r) => r.styleDistance?.total ?? 0)).width) * 1.5).toFixed(3));
  const measured = {
    overlap: overlaps.width * 1.5,
    likelihoodGap: likelihoods.width * 1.5,
    emotionAccuracy: emotions.width * 1.5,
    style: spread(runs.map((r) => r.styleDistance?.total ?? 0)).width * 1.5,
  };
  if (save) {
    await db.saveEvalRun(
      personaId,
      userId,
      { ...runs[runs.length - 1]!, variant, tolerances: measured },
      persona.personaData,
    );
    console.log("[eval] run saved with calibrated tolerances");
  }
  process.exit(0);
}

const metrics = await runEval({
  persona,
  userId,
  cases,
  trainingTexts: training,
  variant,
  without,
  locale,
  temperature,
  rerank,
  sampleAct: variant !== "withoutAct",
  samplesPerCase,
});

if (wantDiscriminator) {
  const version = await db.getLatestPersonaVersion(personaId, userId);
  const historical = await db.getEvalRuns(personaId, userId, 20);
  const pairs = [
    ...pairsFromEvalRuns(historical, version?.createdAt ?? null),
    ...pairsFromScores(metrics.scores),
  ];
  const fingerprint = normalizeStyleProfile(persona.styleProfile).fingerprint ?? null;
  const trained = trainDiscriminator(pairs, fingerprint, `eval-discriminator:${personaId}`);
  metrics.discriminator = discriminatorForMetrics(trained);
  if (!trained.insufficient) {
    const current = await db.getPersonaStyleProfile(personaId, userId);
    await db.setPersonaStyleProfile(
      personaId,
      userId,
      normalizeStyleProfile({
        ...(current ?? {}),
        discriminator: {
          ...discriminatorForMetrics(trained),
          model: trained.model,
          trainedAt: new Date().toISOString(),
        },
      }),
    );
  }
}

console.log("");
console.log(`[eval] variant: ${variant}`);
console.log(`[eval] cases scored : ${metrics.cases}`);
console.log(`[eval] overlap      : ${metrics.overlap.toFixed(4)}  (higher is closer)`);
console.log(`[eval] likelihood   : ${metrics.likelihoodGap.toFixed(4)}  (zero means indistinguishable)`);
console.log(`[eval] length dist  : ${metrics.lengthDistance.toFixed(2)} characters`);
console.log(`[eval] emotion      : ${(metrics.emotionAccuracy * 100).toFixed(1)}% agreement`);
console.log(`[eval] actMatch     : ${((metrics.actMatch ?? 0) * 100).toFixed(1)}%`);
console.log(`[eval] residue      : ${((metrics.residueRate ?? 0) * 100).toFixed(1)}%`);
const styleTotal = metrics.styleDistance?.total;
console.log(
  `[eval] style        : ${styleTotal == null ? "n/a" : styleTotal.toFixed(4)}  (smaller is closer)`,
);
if (metrics.discriminator?.insufficient) {
  console.log(
    `[eval] discriminator: ${copy(locale, "eval.discriminator.insufficient", {
      n: metrics.discriminator.pairs,
      need: DISCRIMINATOR_MIN_PAIRS,
    })}`,
  );
} else if (metrics.discriminator) {
  console.log(
    `[eval] discriminator AUC : ${metrics.discriminator.auc.toFixed(4)} ± ${metrics.discriminator.aucStd.toFixed(4)}  (n=${metrics.discriminator.pairs})`,
  );
  console.log("[eval] tells:");
  for (const tell of metrics.discriminator.tells) {
    console.log(`  · ${tell.feature.padEnd(24)} ${tell.side.padEnd(8)} ${tell.weight.toFixed(3)}`);
  }
}
if (metrics.variant?.includes("picked")) {
  console.log(`[eval] why it won   : ${metrics.variant}`);
}

function printBuckets(
  title: string,
  buckets:
    | Record<string, { count: number; overlap: number; lengthGap: number; sentenceGap: number; addressGap: number }>
    | undefined,
) {
  if (!buckets || !Object.keys(buckets).length) return;
  console.log(`[eval] ${title}:`);
  for (const [key, bucket] of Object.entries(buckets)) {
    console.log(
      `  · ${key.padEnd(10)} n=${String(bucket.count).padStart(2)}` +
        `  overlap=${bucket.overlap.toFixed(4)}` +
        `  length±${bucket.lengthGap.toFixed(1)}` +
        `  sentences±${bucket.sentenceGap.toFixed(2)}` +
        `  address±${bucket.addressGap.toFixed(2)}`,
    );
  }
}

printBuckets("per state (words, then the shape of the line)", metrics.perState);
printBuckets("per period", metrics.perPeriod);
printBuckets("per day part", metrics.perDayPart);
printBuckets("per act", metrics.perAct);

const matrix = (metrics as any).emotionMatrix as
  | Record<string, Record<string, number>>
  | undefined;
if (matrix && Object.keys(matrix).length) {
  console.log("[eval] which emotion was confused with which:");
  for (const [expected, row] of Object.entries(matrix)) {
    const cells = Object.entries(row)
      .map(([actual, count]) => `${actual}×${count}`)
      .join("  ");
    console.log(`  · ${expected.padEnd(10)} ${cells}`);
  }
}

// The baseline has to be a run of the *same* persona: a run with the
// rules switched off is a different persona, and comparing the two
// would say nothing about either.
const baselineRow = await db.getLatestEvalRun(personaId, userId);
const storedBaseline = baselineRow ? (baselineRow.metricsJson as EvalMetrics) : null;
const baseline =
  storedBaseline && (!storedBaseline.variant || storedBaseline.variant === variant)
    ? storedBaseline
    : null;
if (save) {
  // The run is saved before the gate decides, so `--save` saves whether
  // or not the gate passes. A flag that quietly stops working when
  // something else fails is a flag nobody can rely on.
  const id = await db.saveEvalRun(
    personaId,
    userId,
    { ...metrics, variant },
    persona.personaData,
  );
  console.log(`[eval] run ${id} saved`);
}

const tolerances = resolveGateTolerances(flagTolerances, storedBaseline?.tolerances);
const outcome = evaluateGate(baseline, metrics, variant, tolerances);
console.log("");
if (outcome.regressed) {
  console.error(`[eval] ${outcome.note}`);
  // The gate fails whether or not the run is being saved. `--save` is
  // about keeping the measurement, not about whether a regression
  // counts — and a flag that turns the gate off is a flag nobody should
  // be able to pass by accident.
  if (gate) process.exit(outcome.exitCode);
} else if (gate && outcome.exitCode !== 0) {
  // There is nothing to regress against. Saying so is more useful than
  // passing quietly — a green run with no baseline proves nothing. The
  // gate was asked to check something and could not, so it fails.
  console.warn(`[eval] ${outcome.note}`);
  process.exit(outcome.exitCode);
} else {
  console.log(`[eval] ${outcome.note}`);
}

