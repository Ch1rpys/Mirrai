/**
 * Running the ruler.
 *
 * This is the loop that makes "does it still sound like them" a question
 * with an answer: hold out a line the person actually said, ask the
 * rebuilt persona to say it again, and score the two against each other.
 *
 * The persona is prompted through exactly the same path the chat uses —
 * `planTurn` and `executePlan` — because a measurement taken against a
 * different prompt would be measuring a different product.
 */
import type { Persona } from "../../drizzle/schema";
import type { LLMProvider } from "../llm/types";
import { resolveProviderForUser } from "../llm/user-provider";
import { resolveStageProviders } from "../llm/stage-providers";
import { executePlan, planTurn } from "../chat/generate";
import { normalizePersonaSettings } from "@shared/persona-settings";
import {
  aggregateScores,
  buildCharNgramModel,
  scoreCase,
  type EvalCaseScore,
  type EvalMetrics,
} from "./metrics";
import type { EvalCaseData } from "./dataset";
import { isLayerId, LAYERS, type LayerId } from "@shared/layers";
import type { SpeechAct } from "@shared/speech-acts";
import { normalizeStyleProfile } from "@shared/style-profile";
import { dayPartFromHour, type ActDayPart } from "@shared/act-profile";
import { zonedHour } from "@shared/timezone";

/**
 * Which version of the persona to measure.
 *
 * The A/B exists because a change can make the numbers better and the
 * persona worse. "withoutRules" turns the discriminative rules and the
 * per-state imperfection off, so the same persona can be measured both
 * ways — and if the rules do not move the numbers, they do not belong
 * in the prompt.
 */
export type EvalVariant =
  | "default"
  | "withoutRules"
  | "withRulesOnly"
  | "withoutAct"
  | "withoutRerank";

/**
 * What each variant turns on and off.
 *
 * "withRulesOnly" used to mean exactly the same thing as "default" —
 * the rules stayed on *and* the per-state imperfection stayed on — so
 * an arm called "rules only" measured a persona that still had the
 * imperfection. The day someone used it for the rules-on/rules-off
 * comparison, it would have measured nothing and looked like a result.
 */
function variantSwitches(variant: EvalVariant): {
  rules: "on" | "off";
  imperfection: "on" | "off";
  act: "on" | "off";
  rerank: "on" | "off";
} {
  if (variant === "withoutRules") {
    return { rules: "off", imperfection: "off", act: "off", rerank: "off" };
  }
  if (variant === "withRulesOnly") {
    return { rules: "on", imperfection: "off", act: "on", rerank: "on" };
  }
  if (variant === "withoutAct") {
    return { rules: "on", imperfection: "on", act: "off", rerank: "on" };
  }
  if (variant === "withoutRerank") {
    return { rules: "on", imperfection: "on", act: "on", rerank: "off" };
  }
  return { rules: "on", imperfection: "on", act: "on", rerank: "on" };
}

/** `--variant` aliases, plus `--without a,b`. */
export function layerOverridesForEval(options: {
  variant?: EvalVariant;
  without?: string[];
  sampleAct?: boolean;
}): Partial<Record<LayerId, boolean>> {
  const switches = variantSwitches(options.variant ?? "default");
  const overrides: Partial<Record<LayerId, boolean>> = {
    rules: switches.rules === "on",
    imperfection: switches.imperfection === "on",
    act: options.sampleAct ?? switches.act === "on",
    rerank: switches.rerank === "on",
  };
  for (const name of options.without ?? []) {
    if (isLayerId(name)) overrides[name] = false;
  }
  return overrides;
}

function averageSampleScores(samples: EvalCaseScore[]): EvalCaseScore {
  const n = samples.length;
  const first = samples[0]!;
  if (n === 1) return { ...first };
  const mean = (pick: (score: EvalCaseScore) => number) =>
    samples.reduce((sum, score) => sum + pick(score), 0) / n;
  return {
    ...first,
    overlap: mean((score) => score.overlap),
    likelihoodGap: mean((score) => score.likelihoodGap),
    lengthDelta: mean((score) => score.lengthDelta),
    generatedLength: mean((score) => score.generatedLength),
    generatedShape: {
      ...first.generatedShape,
      chars: mean((score) => score.generatedShape.chars),
      sentences: mean((score) => score.generatedShape.sentences),
      addresses: mean((score) => score.generatedShape.addresses),
    },
    actMatch: mean((score) => (score.actMatch ? 1 : 0)) >= 0.5,
    residue: first.residue
      ? { ...first.residue, rate: mean((score) => score.residue?.rate ?? 0) }
      : undefined,
  };
}

/**
 * The layers a run of these cases would actually use, without calling a
 * model.
 *
 * The ablation preview asks this before it spends anything. The static
 * switch list is not enough: the generator adds data layers (a
 * fingerprint brings projection and lengthCap, a sample pool brings
 * styleReminder, and so on) only when it plans a turn. Planning is cheap
 * and deterministic, so the preview plans the cases and reads the union.
 */
export interface PreviewLayersOptions {
  persona: Persona;
  userId: number;
  cases: EvalCaseData[];
  locale?: "zh" | "en";
  variant?: EvalVariant;
  without?: string[];
  rerank?: boolean;
  sampleAct?: boolean;
}

export async function previewLayersUsed(
  options: PreviewLayersOptions,
): Promise<LayerId[]> {
  const locale = options.locale ?? "zh";
  const variant = options.variant ?? "default";
  const switches = variantSwitches(variant);
  const useRerank = options.rerank ?? false;
  const layerOverrides = layerOverridesForEval({
    variant,
    without: options.without,
    sampleAct: options.sampleAct ?? (switches.act === "on"),
  });
  if (useRerank === false) layerOverrides.rerank = false;

  const used = new Set<LayerId>();
  for (let i = 0; i < options.cases.length; i++) {
    const caseData = options.cases[i]!;
    const lastUser = [...caseData.context].reverse().find((message) => message.role === "user");
    const now = caseData.expected.timestamp ?? new Date();
    const dayPart =
      caseData.dayPart ??
      (caseData.expected.timestamp
        ? dayPartFromHour(
            zonedHour(
              caseData.expected.timestamp,
              (options.persona as { timezone?: string }).timezone,
            ),
          )
        : null);
    const plan = await planTurn({
      persona: options.persona,
      userId: options.userId,
      userMessage: lastUser?.content ?? "",
      history: caseData.context.map((row) => ({
        role: row.role === "user" ? ("user" as const) : ("assistant" as const),
        content: row.content,
      })),
      now,
      locale,
      seed: `eval:${options.persona.id}:${i}:${caseData.expected.content}`,
      periodId: caseData.periodId ?? null,
      actCondition: {
        emotion: caseData.expectedState,
        dayPart,
      },
      layerOverrides,
      exclude: {
        recordIds: caseData.expected.id ? [caseData.expected.id] : undefined,
        texts: [caseData.expected.content],
      },
    });
    for (const layer of plan.layersUsed) used.add(layer);
  }
  return LAYERS.filter((layer) => used.has(layer));
}

export interface EvalRunOptions {
  persona: Persona;
  userId: number;
  cases: EvalCaseData[];
  /** The persona's other lines, for the n-gram model. Never the held-out ones. */
  trainingTexts: string[];
  locale?: "zh" | "en";
  variant?: EvalVariant;
  /** Extra layers to turn off, from `--without a,b`. */
  without?: string[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** Called after each case, so a long run can show progress. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Whether four candidates are generated and picked.
   *
   * The CLI treats this as on. Unit tests keep one call, so they pass
   * false.
   */
  rerank?: boolean;
  /** Whether an action is sampled into the prompt. */
  sampleAct?: boolean;
  /**
   * Fixes the plan seed for every case.
   *
   * Evaluation normally seeds each case from the persona, the index and
   * the held-out line. Tests that compare the chat path with this one
   * pass the same seed to both.
   */
  seed?: string;
  /** The clock the turn is planned against. Defaults to now, per case. */
  now?: Date;
  /** How many lines to generate per case. Averaged; styleDistance uses all of them. */
  samplesPerCase?: number;
  /**
   * The provider to measure.
   *
   * The audition passes one so each candidate is the one being timed.
   * Chat and the CLI leave it unset and resolve the user's default.
   */
  provider?: LLMProvider;
}

/**
 * Runs the cases and scores them.
 *
 * A provider that fails on one case does not fail the run: the case is
 * skipped and the run reports how many it managed to score. A ruler
 * that stops at the first bad answer is not a ruler.
 */
export async function runEval(options: EvalRunOptions): Promise<EvalMetrics> {
  const locale = options.locale ?? "zh";
  const variant = options.variant ?? "default";
  const provider =
    options.provider ?? (await resolveProviderForUser({ userId: options.userId }));
  if (!provider) {
    throw new Error("No LLM provider is configured for this user.");
  }

  const switches = variantSwitches(variant);
  const useRerank = options.rerank ?? false;
  const layerOverrides = layerOverridesForEval({
    variant,
    without: options.without,
    sampleAct: options.sampleAct ?? (switches.act === "on"),
  });
  if (useRerank === false) layerOverrides.rerank = false;
  const settings = normalizePersonaSettings(options.persona.settings);
  /**
   * An audition passes one provider so that provider is the one timed.
   * The CLI and the chat leave it unset and honour the persona's
   * planner / voice names, the same way the conversation does.
   */
  const stageProviders =
    !options.provider && settings.layers.twoStage && layerOverrides.twoStage !== false
      ? await resolveStageProviders({
          userId: options.userId,
          fallback: provider,
          personaProviderName: (options.persona as { llmProvider?: string | null }).llmProvider ?? undefined,
          settings,
        })
      : null;
  const model = buildCharNgramModel(options.trainingTexts);
  const scores = [];
  const whyWon: string[] = [];
  const usedLayers = new Set<LayerId>();
  const samplesPerCase = Math.max(1, options.samplesPerCase ?? 1);

  for (let i = 0; i < options.cases.length; i++) {
    const caseData = options.cases[i];
    const lastUser = [...caseData.context].reverse().find((m) => m.role === "user");
    const now = caseData.expected.timestamp ?? options.now ?? new Date();
    const dayPart: ActDayPart | null =
      caseData.dayPart ??
      (caseData.expected.timestamp
        ? dayPartFromHour(
            zonedHour(
              caseData.expected.timestamp,
              (options.persona as { timezone?: string }).timezone,
            ),
          )
        : null);
    const sampleScores: ReturnType<typeof scoreCase>[] = [];
    const sampleTexts: string[] = [];
    for (let sample = 0; sample < samplesPerCase; sample++) {
      const seed =
        options.seed ??
        (`eval:${options.persona.id}:${i}:${caseData.expected.content}` +
          (samplesPerCase === 1 ? "" : `:s${sample}`));
      const turnInput = {
        persona: options.persona,
        userId: options.userId,
        userMessage: lastUser?.content ?? "",
        history: caseData.context.map((row) => ({
          role: row.role === "user" ? ("user" as const) : ("assistant" as const),
          content: row.content,
        })),
        now,
        locale,
        seed,
        periodId: caseData.periodId ?? null,
        actCondition: {
          emotion: caseData.expectedState,
          dayPart,
        },
        layerOverrides,
        exclude: {
          recordIds: caseData.expected.id ? [caseData.expected.id] : undefined,
          texts: [caseData.expected.content],
        },
      };

      let generated = "";
      let winnerNote = "";
      let sampledAct: SpeechAct | null = null;
      try {
        const plan = await planTurn(turnInput);
        sampledAct = plan.sampledAct;
        for (const id of plan.layersUsed) usedLayers.add(id);
        for await (const event of executePlan(plan, turnInput, {
          provider,
          plannerProvider: stageProviders?.planner,
          voiceProvider: stageProviders?.voice,
          mode: "once",
          rerank: useRerank && layerOverrides.rerank !== false,
          options: {
            maxTokens: options.maxTokens ?? 200,
            temperature: options.temperature ?? 0.7,
            topP: options.topP,
          },
          emitDeltas: false,
          emptyAsSilence: false,
          trainingTexts: options.trainingTexts.filter(
            (text) => text !== caseData.expected.content,
          ),
        })) {
          if (event.type !== "final") continue;
          generated = typeof event.text === "string" ? event.text : "";
          const picked = event.rerank;
          if (picked) {
            const winner = picked.scores.find((row) => row.index === picked.index);
            winnerNote = `case ${i} picked #${picked.index ?? 0} distance=${winner?.distanceToMedian?.toFixed(3) ?? "n/a"} discarded=${picked.scores.filter((s) => s.discarded).length}`;
          }
        }
      } catch (error) {
        console.warn(
          `[Eval] Case ${caseData.expected.content.slice(0, 30)} failed: ${
            (error as Error).message
          }`,
        );
      }
      if (!generated.trim()) continue;
      if (winnerNote) whyWon.push(winnerNote);
      sampleTexts.push(generated);
      sampleScores.push(
        scoreCase({
          caseId: i,
          expected: caseData.expected.content,
          generated,
          model,
          declaredState: caseData.expectedState ?? null,
          expectedState: caseData.expectedState ?? null,
          periodId: caseData.periodId ?? null,
          dayPart,
          locale,
          expectedAct: caseData.expectedAct ?? null,
          sampledAct,
          previousUser: lastUser?.content ?? null,
        }),
      );
    }
    if (!sampleScores.length) {
      options.onProgress?.(i + 1, options.cases.length);
      continue;
    }
    const averaged = averageSampleScores(sampleScores);
    averaged.generatedSamples = sampleTexts;
    scores.push(averaged);
    options.onProgress?.(i + 1, options.cases.length);
  }

  const fingerprint = normalizeStyleProfile(options.persona.styleProfile).fingerprint ?? null;
  const aggregated = aggregateScores(scores, { fingerprint });
  aggregated.layersUsed = [...usedLayers];
  if (whyWon.length) {
    aggregated.variant = `${variant}; ${whyWon.join(" | ")}`;
  }
  return aggregated;
}
