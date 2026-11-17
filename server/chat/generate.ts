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
import { isTextRecord } from "@shared/records";
import { dayPartFromHour, normalizeActProfile, sampleAct } from "@shared/act-profile";
import { isUserAsking, type SpeechAct } from "@shared/speech-acts";
import { loadBehaviorProfile, seededRandom } from "../_core/behavior-profile";
import { zonedHour } from "@shared/timezone";
import { pickRerankWinner, type RerankResult } from "./rerank";
import { retrieveExemplars } from "./exemplars";
import { filterHarm } from "@shared/harm";
import { buildPromptForPersona } from "./prompt";
import * as db from "../db";
import {
  applyLayerOverrides,
  enabledLayerIds,
  layersFromSettings,
  type LayerId,
} from "@shared/layers";
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
  const layersUsed = enabledLayerIds(layers);
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
          emotion: input.persona.emotionalState ?? "warm",
          dayPart: dayPartFromHour(zonedHour(input.now, (input.persona as { timezone?: string }).timezone)),
          relationshipPhase: (input.persona.personaData as { relationshipPhase?: string } | null)?.relationshipPhase ?? "initial",
        },
        { dropSilence, rng },
      )
    : null;
  const sampledAct = sampled?.act === "silence" ? null : sampled?.act ?? null;

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
      skipExemplars: !layers.exemplars,
      excludeExemplarIds: input.exclude.recordIds,
      excludeExemplarTexts: input.exclude.texts,
      markRecalled: false,
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
      layersUsed,
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
    layersUsed,
    exemplarIds: [],
    seedRecordIds: [],
    recalled: composed.recalled,
    rng,
  };
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
    maxTokens: io.options.maxTokens,
    signal: io.signal,
  };
  const locale = input.locale;
  const useRerank = io.rerank && plan.layersUsed.includes("rerank");

  if (useRerank) {
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
    const exemplars = retrieveExemplars({
      userMessage: input.userMessage,
      records: records as never,
      excludeTexts: input.exclude?.texts,
      excludeIds: input.exclude?.recordIds,
      personaData: personaData as never,
    });
    const filteredRecords = filterHarm(records, personaData as never);
    const training =
      io.trainingTexts ??
      filteredRecords
        .filter((row) => row.role === "assistant" && isTextRecord(row))
        .map((row) => row.content)
        .slice(-80);
    const picked = pickRerankWinner({
      candidates: texts.map((text) => ({ text })),
      trainingTexts: input.exclude?.texts
        ? training.filter((text) => !input.exclude?.texts?.includes(text))
        : training,
      exemplars: exemplars.map((item) => item.content),
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
    if (io.emitDeltas) yield { type: "delta", text: replyText };
    yield { type: "final", text: replyText, projection: [], rerank: picked ?? undefined };
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
    yield { type: "final", text: replyText, projection: [] };
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
  if (io.emitDeltas) yield { type: "delta", text: replyText };
  yield { type: "final", text: replyText, projection: [] };
}
