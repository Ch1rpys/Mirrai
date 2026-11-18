/**
 * The one generation path.
 *
 * Chat and evaluation used to each sample an action, build a prompt and
 * call the model. A new layer would have to be written twice, and the
 * ruler would then measure something the conversation did not do.
 *
 * Both now call `planTurn` and `executePlan`. This file is the move:
 * the behaviour is the behaviour `runConversationTurn` and `runEval`
 * already had.
 */
import type { Persona } from "../../drizzle/schema";
import type { LLMMessage, LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { copy } from "@shared/copy";
import { dayPartFromHour, normalizeActProfile, sampleAct, type ActDayPart } from "@shared/act-profile";
import { isUserAsking, type SpeechAct } from "@shared/speech-acts";
import { loadBehaviorProfile, seededRandom } from "../_core/behavior-profile";
import { zonedHour } from "@shared/timezone";
import { pickRerankWinner, type RerankResult } from "./rerank";
import { buildRerankModel, getRerankModel } from "./rerank-model";
import { sparseModelFromUnknown } from "../eval/ab-pairs";
import { retrieveExemplarsWithEmbed } from "./embeddings";
import { buildPromptForPersona } from "./prompt";
import * as db from "../db";
import {
  applyLayerOverrides,
  LAYERS,
  layersFromSettings,
  layersInEffect,
  type LayerId,
} from "@shared/layers";
import { capReply, replyBudget } from "@shared/length-cap";
import { effectiveStyleProfile } from "@shared/style-profile";
import { FINGERPRINT_STATES, type EmotionalState, type StyleFingerprintCore } from "@shared/style-fingerprint";
import { projectStyle } from "@shared/style-projection";
import { hasPromptLexicon } from "@shared/lexicon";
import type { ScoredMemory } from "./retrieval";

export interface TurnInput {
  persona: Persona;
  userId: number;
  userMessage: string;
  history: Array<{
    role: "user" | "assistant";
    content: string;
    messageType?: string;
    mediaUrl?: string | null;
  }>;
  now: Date;
  locale: "zh" | "en";
  periodId?: string | null;
  quotedSection?: string;
  sceneOverlay?: string | null;
  sceneEmotion?: string | null;
  summarySection?: string;
  memories?: ScoredMemory[];
  layerOverrides?: Partial<Record<LayerId, boolean>>;
  exclude?: { recordIds?: number[]; texts?: string[] };
  seed: string;
  /**
   * When set, the act is sampled as if the persona were in this mood at
   * this hour. Evaluation uses the held-out line's own state and day
   * part; chat leaves it unset and uses the live persona and the clock.
   */
  actCondition?: { emotion?: string | null; dayPart?: ActDayPart | null };
  /** Chat-only extras so `composeMessages` keeps the same callers. */
  contextLimit?: number;
  providerName?: string;
  extraConfig?: Record<string, any>;
  replyToId?: number | null;
}

export interface TurnPlan {
  kind: "silence" | "ritual" | "model";
  sampledAct: SpeechAct | null;
  ritual?: { trigger: string; reply: string; recordId?: number };
  messages: LLMMessage[];
  maxTokens?: number;
  stop?: string[];
  /** Character budget from the length cap. Missing means do not cut. */
  maxChars?: number;
  layersUsed: LayerId[];
  exemplarIds: number[];
  seedRecordIds: number[];
  recalled: Array<{ id: number; title: string; subject: string }>;
  rng: () => number;
}

function actProfileForTurn(
  persona: Persona,
  periodId: string | null | undefined,
) {
  if (periodId) {
    const periods = ((persona.personaData as { periods?: Array<{ id?: string; actProfileDelta?: unknown }> } | null)?.periods) ?? [];
    const period = periods.find((item) => item.id === periodId);
    if (period?.actProfileDelta) return period.actProfileDelta;
  }
  return (persona.personaData as { actProfile?: unknown } | null)?.actProfile ?? null;
}

export async function planTurn(input: TurnInput): Promise<TurnPlan> {
  const layers = applyLayerOverrides(layersFromSettings(input.persona), input.layerOverrides);
  let layersUsed = layersInEffect(layers, input.persona);
  if (layersUsed.includes("rerank") && !input.exclude) {
    const model = await getRerankModel(input.persona.id, input.userId);
    if (!model) layersUsed = layersUsed.filter((id) => id !== "rerank");
  }
  const rng = seededRandom(input.seed);
  const timingEnabled =
    Boolean((input.persona as { timingEnabled?: boolean }).timingEnabled) &&
    Boolean(loadBehaviorProfile(input.persona));
  const dropSilence = Boolean(input.exclude) || !timingEnabled;
  const actProfile = layers.act
    ? normalizeActProfile(actProfileForTurn(input.persona, input.periodId ?? null))
    : null;
  const sampled = actProfile
    ? sampleAct(
        actProfile,
        {
          asking: isUserAsking(input.userMessage),
          emotion: input.actCondition?.emotion ?? input.persona.emotionalState ?? "warm",
          dayPart:
            input.actCondition?.dayPart ??
            dayPartFromHour(zonedHour(input.now, (input.persona as { timezone?: string }).timezone)),
          relationshipPhase: (input.persona.personaData as { relationshipPhase?: string } | null)?.relationshipPhase ?? "initial",
        },
        { dropSilence, rng },
      )
    : null;
  const sampledAct = sampled?.act === "silence" ? null : sampled?.act ?? null;
  const length = lengthCapForTurn(layers.lengthCap, input);
  const projectionOn = Boolean(layers.projection && fingerprintCoreForTurn(input));
  const fingerprintRerankOn = Boolean(
    layers.fingerprintRerank &&
      layersUsed.includes("rerank") &&
      fingerprintCoreForTurn(input),
  );
  const lexiconOn = Boolean(
    layers.lexicon && hasPromptLexicon((input.persona.personaData as { lexicon?: unknown } | null)?.lexicon),
  );

  if (sampled?.act === "silence" && timingEnabled && !input.exclude) {
    return {
      kind: "silence",
      sampledAct: "silence",
      messages: [],
      layersUsed,
      exemplarIds: [],
      seedRecordIds: [],
      recalled: [],
      rng,
    };
  }

  if (input.exclude) {
    const systemPrompt = await buildPromptForPersona({
      persona: input.persona,
      userId: input.userId,
      locale: input.locale,
      now: input.now,
      userMessage: input.userMessage,
      sampledAct,
      periodId: input.periodId ?? null,
      quotedSection: input.quotedSection,
      sceneOverlay: input.sceneOverlay ?? null,
      summarySection: input.summarySection,
      memories: input.memories as never,
      microRules: layers.rules ? undefined : null,
      imperfectionProfile: layers.imperfection ? undefined : null,
      suppressions: layers.suppressions ? undefined : null,
      lexicon: layers.lexicon ? undefined : null,
      skipExemplars: !layers.exemplars,
      excludeExemplarIds: input.exclude.recordIds,
      excludeExemplarTexts: input.exclude.texts,
      markRecalled: false,
      history: input.history,
    });
    const messages: LLMMessage[] = [{ role: "system", content: systemPrompt }];
    for (const row of input.history) {
      messages.push({
        role: row.role === "user" ? "user" : "assistant",
        content: row.content,
      });
    }
    return {
      kind: "model",
      sampledAct,
      messages,
      ...length,
      layersUsed: withMeasuredLayers(layersUsed, length, projectionOn, fingerprintRerankOn, lexiconOn),
      exemplarIds: [],
      seedRecordIds: [],
      recalled: [],
      rng,
    };
  }

  const { composeMessages } = await import("./service");
  const composed = await composeMessages({
    persona: input.persona,
    userId: input.userId,
    userMessage: input.userMessage,
    contextLimit: input.contextLimit ?? 20,
    providerName: input.providerName,
    locale: input.locale,
    now: input.now,
    extraConfig: input.extraConfig,
    replyToId: input.replyToId,
    sampledAct,
    periodId: input.periodId ?? null,
  });
  return {
    kind: "model",
    sampledAct,
    messages: composed.messages,
    ...length,
    layersUsed: withMeasuredLayers(layersUsed, length, projectionOn, fingerprintRerankOn, lexiconOn),
    exemplarIds: [],
    seedRecordIds: [],
    recalled: composed.recalled,
    rng,
  };
}

function lengthCapForTurn(
  enabled: boolean,
  input: TurnInput,
): { maxTokens?: number; stop?: string[]; maxChars?: number } {
  if (!enabled) return {};
  const fingerprint = effectiveStyleProfile(input.persona).fingerprint ?? null;
  const behavior = loadBehaviorProfile(input.persona);
  const burstMax = behavior ? Math.max(0, ...behavior.burstSizes) : 0;
  const userMaxTokens =
    typeof input.extraConfig?.maxTokens === "number" ? input.extraConfig.maxTokens : undefined;
  const budget = replyBudget(fingerprint, burstMax, {
    userMaxTokens,
    newlineRate: behavior?.newlineRate ?? null,
  });
  if (!budget) return {};
  return {
    maxTokens: budget.maxTokens,
    stop: budget.stop,
    maxChars: budget.maxChars,
  };
}

function withMeasuredLayers(
  layersUsed: LayerId[],
  length: { maxChars?: number },
  projectionOn: boolean,
  fingerprintRerankOn: boolean,
  lexiconOn: boolean,
): LayerId[] {
  const extra: LayerId[] = [];
  if (length.maxChars != null) extra.push("lengthCap");
  if (projectionOn) extra.push("projection");
  if (fingerprintRerankOn) extra.push("fingerprintRerank");
  if (lexiconOn) extra.push("lexicon");
  if (extra.length === 0) return layersUsed;
  const used = new Set<LayerId>([...layersUsed, ...extra]);
  return LAYERS.filter((id) => used.has(id));
}

function fingerprintCoreForTurn(input: TurnInput): StyleFingerprintCore | null {
  const fp = effectiveStyleProfile(input.persona).fingerprint ?? null;
  if (!fp || fp.samples < 1 || !fp.endings) return null;
  const emotion = input.actCondition?.emotion ?? input.persona.emotionalState;
  if (typeof emotion === "string" && (FINGERPRINT_STATES as readonly string[]).includes(emotion)) {
    const per = fp.perState?.[emotion as EmotionalState];
    if (per) return per;
  }
  return fp;
}

function finalizeGenerated(
  text: string,
  plan: TurnPlan,
  input: TurnInput,
): { text: string; projection: string[] } {
  let next = text;
  let projection: string[] = [];
  if (plan.layersUsed.includes("projection")) {
    const core = fingerprintCoreForTurn(input);
    if (core) {
      const styled = projectStyle(next, core, seededRandom(input.seed));
      next = styled.text;
      projection = [...styled.applied];
    }
  }
  return applyLengthCap(next, plan, projection);
}

function tighterTokenBudget(plan: number | undefined, requested: number | undefined): number | undefined {
  if (plan == null) return requested;
  if (requested == null) return plan;
  return Math.min(plan, requested);
}

function applyLengthCap(text: string, plan: TurnPlan, projection: string[]): {
  text: string;
  projection: string[];
} {
  if (plan.maxChars == null) return { text, projection };
  const capped = capReply(text, plan.maxChars);
  if (!capped.capped) return { text, projection };
  return { text: capped.text, projection: [...projection, "length_cap"] };
}

export async function* executePlan(
  plan: TurnPlan,
  input: TurnInput,
  io: {
    provider: LLMProvider;
    mode: "stream" | "once";
    rerank: boolean;
    signal?: AbortSignal;
    options: { temperature?: number; maxTokens?: number; provider?: string };
    emitDeltas?: boolean;
    trainingTexts?: string[];
    /** Chat fills an empty answer with the silence copy. Evaluation leaves it empty so the case is skipped. */
    emptyAsSilence?: boolean;
  },
): AsyncGenerator<
  | { type: "thinking" }
  | { type: "delta"; text: string }
  | { type: "final"; text: string; projection: string[]; rerank?: RerankResult }
> {
  if (plan.kind === "silence" || plan.kind === "ritual") {
    const text = plan.ritual?.reply ?? "";
    if (text && io.emitDeltas) yield { type: "delta", text };
    yield { type: "final", text, projection: [] };
    return;
  }

  const invokeOptions = {
    provider: io.options.provider,
    temperature: io.options.temperature,
    maxTokens: tighterTokenBudget(plan.maxTokens, io.options.maxTokens),
    stop: plan.stop,
    signal: io.signal,
  };
  const locale = input.locale;
  const useRerank = io.rerank && plan.layersUsed.includes("rerank");
  const rerankModel = useRerank
    ? io.trainingTexts
      ? buildRerankModel(
          input.exclude?.texts
            ? io.trainingTexts.filter((text) => !input.exclude?.texts?.includes(text))
            : io.trainingTexts,
        )
      : await getRerankModel(input.persona.id, input.userId)
    : null;

  if (useRerank && rerankModel) {
    yield { type: "thinking" };
    const texts = await Promise.all(
      Array.from({ length: 4 }, async () => {
        try {
          const answer = await llmService.invokeWithProvider(io.provider, {
            messages: plan.messages,
            options: invokeOptions,
          });
          return typeof answer === "string" ? answer : "";
        } catch {
          return "";
        }
      }),
    );
    let records: Array<{ role: string; content: string; id?: number; kind?: string | null }> = [];
    try {
      records = await db.getCollectedMessagesForPersona(input.persona.id, input.userId, { newest: true });
    } catch {
      records = [];
    }
    const personaData = input.persona.personaData as { harmReport?: unknown } | null;
    const period = ((input.persona.personaData as { periods?: Array<{ id?: string; from?: string; to?: string }> } | null)?.periods ?? [])
      .find((item) => item.id === input.periodId);
    const exemplars = await retrieveExemplarsWithEmbed({
      userMessage: input.userMessage,
      records: records as never,
      excludeTexts: input.exclude?.texts,
      excludeIds: input.exclude?.recordIds,
      personaData: personaData as never,
      sampledAct: plan.sampledAct,
      emotion: input.actCondition?.emotion ?? input.persona.emotionalState ?? null,
      now: input.now,
      timeZone: (input.persona as { timezone?: string | null }).timezone ?? null,
      period: period?.from && period?.to ? { from: period.from, to: period.to } : null,
      history: input.history,
      personaId: input.persona.id,
      userId: input.userId,
    });
    const profile = effectiveStyleProfile(input.persona);
    const picked = pickRerankWinner({
      candidates: texts.map((text) => ({ text })),
      model: rerankModel,
      exemplars: exemplars.map((item) => item.content),
      fingerprint: fingerprintCoreForTurn(input),
      fingerprintRerank: plan.layersUsed.includes("fingerprintRerank"),
      sampledAct: plan.sampledAct,
      discriminator: sparseModelFromUnknown(profile.discriminator),
      weights: profile.rerankWeights as Record<string, number> | undefined,
    });
    const surviving = texts.filter(Boolean);
    if (!picked && !surviving.length) {
      throw new Error("rerank produced no candidates");
    }
    const replyText = picked?.text || surviving[0] || copy(locale, "prompt.silence");
    console.info(
      "[Rerank]",
      JSON.stringify({
        sampledAct: plan.sampledAct,
        exemplarIds: exemplars.map((item) => item.id),
        scores: picked?.scores ?? [],
        picked: picked?.index ?? null,
      }),
    );
    const capped = finalizeGenerated(replyText, plan, input);
    if (io.emitDeltas) yield { type: "delta", text: capped.text };
    yield { type: "final", text: capped.text, projection: capped.projection, rerank: picked ?? undefined };
    return;
  }

  if (io.mode === "stream" && io.provider.stream && io.provider.capabilities.streaming) {
    let replyText = "";
    for await (const chunk of llmService.streamWithProvider(io.provider, {
      messages: plan.messages,
      options: invokeOptions,
    })) {
      replyText += chunk.text;
      // Always yield the chunk so a mid-stream failure still leaves the
      // half-answer in the caller's buffer. The caller decides whether
      // the user sees it live.
      yield { type: "delta", text: chunk.text };
    }
    const streamed = finalizeGenerated(replyText, plan, input);
    yield { type: "final", text: streamed.text, projection: streamed.projection };
    return;
  }

  let replyText = await llmService.invokeWithProvider(io.provider, {
    messages: plan.messages,
    options: invokeOptions,
  });
  if (io.emptyAsSilence === false) {
    replyText = typeof replyText === "string" ? replyText : "";
  } else {
    replyText = replyText || copy(locale, "prompt.silence");
  }
  const once = finalizeGenerated(replyText, plan, input);
  if (io.emitDeltas) yield { type: "delta", text: once.text };
  yield { type: "final", text: once.text, projection: once.projection };
}
