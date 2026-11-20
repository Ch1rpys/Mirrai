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
import type { LLMMessage, LLMOptions, LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { copy } from "@shared/copy";
import { dayPartFromHour, normalizeActProfile, sampleAct, type ActDayPart, type ActVia } from "@shared/act-profile";
import {
  isUserAsking,
  labelUserActByRule,
  USER_ACT_COPY_KEYS,
  type SpeechAct,
  type UserAct,
} from "@shared/speech-acts";
import { loadBehaviorProfile, seededRandom } from "../_core/behavior-profile";
import { preferredClockZone, zonedHour } from "@shared/timezone";
import { pickRerankWinner, type RerankResult } from "./rerank";
import { buildRerankModel, getRerankModel } from "./rerank-model";
import { sparseModelFromUnknown } from "../eval/ab-pairs";
import { retrieveExemplarsWithEmbed } from "./embeddings";
import { retrieveExemplarsFromTable } from "./exemplar-query";
import { renderExemplars, type Exemplar } from "./exemplars";
import { buildPromptBundleForPersona } from "./prompt";
import { personaAsOfPeriod } from "@shared/period-boundary";
import { clipPromptFact, isSafeSeedLine } from "@shared/seed-safety";
import {
  selectSeedExchanges,
  seedMessagesFor,
  spliceAfterSystem,
  type SeedExchange,
} from "./seed-turns";
import * as db from "../db";
import {
  applyLayerOverrides,
  LAYERS,
  layersFromSettings,
  layersInEffect,
  type LayerId,
} from "@shared/layers";
import { capReply, replyBudget } from "@shared/length-cap";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { resolveRecordScope } from "@shared/persona-sharing";
import { effectiveStyleProfile } from "@shared/style-profile";
import { defaultAddressForms, FINGERPRINT_STATES, type EmotionalState, type StyleFingerprintCore } from "@shared/style-fingerprint";
import { projectStyle } from "@shared/style-projection";
import { hasPromptLexicon } from "@shared/lexicon";
import { pickActClusterLines } from "@shared/act-clusters";
import {
  normalizeConflictProfile,
  normalizeTriggers,
  shouldForceRepair,
} from "@shared/conflicts";
import { normalizeEmotionDynamics } from "@shared/emotion-dynamics";
import {
  CLOSER_PROMPT_MAX,
  normalizeSessionProfile,
  shouldClose,
} from "@shared/session-profile";
import { minuteOfDay } from "@shared/proactive-decision";
import { normalizeInSession, pickInSessionFact } from "@shared/in-session";
import { currentRoutines, normalizeLifeEvents } from "@shared/life-events";
import { filterHarm } from "@shared/harm";
import {
  hasUnsupportedClaim,
  type VerifyClaimsContext,
} from "./fact-check";
import { relationshipIsOver } from "@shared/relationship-ended";
import {
  matchRitual,
  normalizeRituals,
  sampleRitualReply,
  RITUAL_COOLDOWN_MS,
} from "@shared/ritual-table";
import {
  detectReanchor,
  pickStyleReminderLines,
  styleReminderSeed,
  type ReanchorIssue,
} from "@shared/style-reminder";
import { normalizeAddressHistory } from "@shared/address-history";
import { renderRecordContent } from "@shared/records";
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
    timestamp?: Date | string | null;
    metadata?: unknown;
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
  /**
   * The act this turn must use, instead of sampling one (C3.2).
   *
   * The rehearsal room asks "how might this land" three times; each
   * variant is one of the record's own acts, so the act is chosen by the
   * caller and the sampling is skipped.
   */
  forcedAct?: SpeechAct;
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
  /** The current turn's attachment, when the user sent a picture or a voice note. */
  mediaType?: string | null;
  /** Memory retrieval query. Defaults to `userMessage`. */
  retrievalQuery?: string;
}

export interface TurnPlan {
  kind: "silence" | "ritual" | "model";
  sampledAct: SpeechAct | null;
  /** How the act bucket was chosen. Missing when no act was sampled. */
  actVia?: ActVia;
  /** What the other person just did, from the words alone. */
  userAct?: UserAct;
  ritual?: { trigger: string; reply: string; recordId?: number };
  messages: LLMMessage[];
  /** Planner-only messages. Set when the two-stage layer is on. */
  plannerMessages?: LLMMessage[];
  maxTokens?: number;
  stop?: string[];
  /** Character budget from the length cap. Missing means do not cut. */
  maxChars?: number;
  layersUsed: LayerId[];
  exemplarIds: number[];
  /**
   * The exemplars the prompt used, so the reranker reuses them.
   *
   * It used to read the records again to score the candidates against
   * example lines. That was a second full read of the history in one
   * turn (C8.7).
   */
  exemplars?: Exemplar[];
  seedRecordIds: number[];
  recalled: Array<{ id: number; title: string; subject: string; description?: string | null }>;
  rng: () => number;
  reanchor?: ReanchorIssue[];
  /** This turn is closing the chat the way they used to. */
  closing?: boolean;
  /** Confirmed routine window this clock is inside. */
  routine?: string;
}

function periodForTurn(
  persona: Persona,
  periodId: string | null | undefined,
) {
  if (!periodId) return undefined;
  const periods = ((persona.personaData as { periods?: Array<{ id?: string; from?: string; to?: string; actProfileDelta?: unknown }> } | null)?.periods) ?? [];
  return periods.find((item) => item.id === periodId);
}

function actProfileForTurn(
  persona: Persona,
  periodId: string | null | undefined,
) {
  const period = periodForTurn(persona, periodId);
  if (period?.actProfileDelta) return period.actProfileDelta;
  return (persona.personaData as { actProfile?: unknown } | null)?.actProfile ?? null;
}

async function clockZoneFor(input: TurnInput): Promise<string | null> {
  const personaZone = (input.persona as { timezone?: string | null }).timezone ?? null;
  if (typeof personaZone === "string" && personaZone.trim()) {
    return preferredClockZone(personaZone, null);
  }
  let userZone: string | null = null;
  try {
    userZone = await db.getUserTimezone(input.userId);
  } catch {
    userZone = null;
  }
  return preferredClockZone(null, userZone);
}

/**
 * The exemplars for one turn, once (C8.7).
 *
 * The table path answers when every row has search tokens. The old
 * full read stays as the fallback for an unindexed persona and for a
 * caller whose database is a test double.
 */
async function exemplarsForTurn(
  input: TurnInput,
  sampledAct: SpeechAct | null,
): Promise<Exemplar[]> {
  const period = periodForTurn(input.persona, input.periodId ?? null);
  const scope = resolveRecordScope(input.persona);
  const common = {
    personaId: scope.personaId,
    userId: scope.userId,
    userMessage: input.userMessage,
    excludeIds: input.exclude?.recordIds,
    excludeTexts: input.exclude?.texts,
    personaData: input.persona.personaData as { harmReport?: never } | null,
    sampledAct,
    emotion: input.actCondition?.emotion ?? input.persona.emotionalState ?? null,
    now: input.now,
    timeZone: (input.persona as { timezone?: string | null }).timezone ?? null,
    period: period?.from && period?.to ? { from: period.from, to: period.to } : null,
    history: input.history,
  };
  const fromTable = await retrieveExemplarsFromTable(common);
  if (fromTable !== null) return fromTable;
  let records: Array<Record<string, unknown>> = [];
  try {
    records = await db.getCollectedMessagesForPersona(scope.personaId, scope.userId, {
      newest: true,
    });
  } catch {
    records = [];
  }
  return retrieveExemplarsWithEmbed({ ...common, records: records as never });
}

export async function planTurn(input: TurnInput): Promise<TurnPlan> {
  const clockZone = await clockZoneFor(input);
  input = {
    ...input,
    persona: personaAsOfPeriod(
      input.persona,
      periodForTurn(input.persona, input.periodId ?? null),
      clockZone,
    ),
  };
  const layers = applyLayerOverrides(layersFromSettings(input.persona), input.layerOverrides);
  let layersUsed = layersInEffect(layers, input.persona);
  if (layersUsed.includes("rerank") && !input.exclude) {
    const scope = resolveRecordScope(input.persona);
    const model = await getRerankModel(scope.personaId, scope.userId);
    if (!model) layersUsed = layersUsed.filter((id) => id !== "rerank");
  }
  const rng = seededRandom(input.seed);
  const timingEnabled =
    Boolean((input.persona as { timingEnabled?: boolean }).timingEnabled) &&
    Boolean(loadBehaviorProfile(input.persona));
  const dropSilence = Boolean(input.exclude) || !timingEnabled;
  const userAct = labelUserActByRule(input.userMessage) ?? "other";
  const actProfile = layers.act
    ? normalizeActProfile(actProfileForTurn(input.persona, input.periodId ?? null))
    : null;
  const sampled = input.forcedAct
    ? null
    : actProfile
    ? sampleAct(
        actProfile,
        {
          asking: isUserAsking(input.userMessage),
          emotion: input.actCondition?.emotion ?? input.persona.emotionalState ?? "warm",
          dayPart:
            input.actCondition?.dayPart ??
            dayPartFromHour(zonedHour(input.now, (input.persona as { timezone?: string }).timezone)),
          relationshipPhase: (input.persona.personaData as { relationshipPhase?: string } | null)?.relationshipPhase ?? "initial",
          userAct,
        },
        { dropSilence, rng },
      )
    : null;
  let sampledAct = input.forcedAct
    ?? (sampled?.act === "silence" ? null : sampled?.act ?? null);
  const conflictTurn = conflictMaterialForTurn(input, layers.emotionInertia);
  if (conflictTurn.forceRepair) sampledAct = "repair";
  const closingTurn = await closingForTurn(input, layers.closing);
  const inSessionShare = inSessionShareForTurn(input, layers.act, clockZone);
  const routineId = routineForTurn(input, clockZone);
  const actMeta = {
    userAct,
    ...(sampled?.via ? { actVia: sampled.via } : {}),
  };
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

  if (sampled?.act === "silence" && timingEnabled && !input.exclude && !conflictTurn.forceRepair) {
    return {
      kind: "silence",
      sampledAct: "silence",
      ...actMeta,
      messages: [],
      layersUsed,
      exemplarIds: [],
      seedRecordIds: [],
      recalled: [],
      rng,
    };
  }

  const ritual = conflictTurn.forceRepair
    ? null
    : await ritualPlanForTurn(input, layers.ritual, rng);
  if (ritual) {
    return {
      kind: "ritual",
      sampledAct,
      ...actMeta,
      ritual,
      messages: [],
      layersUsed: withMeasuredLayers(
        layersUsed,
        {},
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        false,
        false,
        closingTurn.closing,
      ),
      exemplarIds: [],
      seedRecordIds: [],
      recalled: [],
      rng,
      ...(closingTurn.closing ? { closing: true } : {}),
    };
  }

  const turnExemplars = layers.exemplars || layers.seededTurns
    ? await exemplarsForTurn(input, sampledAct)
    : [];
  const seeds = await seedPlanForTurn(
    input,
    layers.seededTurns,
    sampledAct,
    Boolean(layers.styleReminder && layers.exemplars),
    turnExemplars,
  );
  /**
   * The prompt shows the exemplars that were not used as seed turns.
   *
   * The old path passed the seed plan's exclusions to the prompt
   * retrieval. Now that both read one list, the same exclusions are
   * applied here — otherwise a line the seed filter refused (a
   * hostile record line) would still appear in the fenced material.
   */
  const seedExcluded = new Set(seeds.excludeTexts);
  const promptExemplars = seedExcluded.size
    ? turnExemplars.filter((item) => {
        const lines = [
          item.content,
          ...item.turn,
          ...(item.rawTurn ?? []),
          ...item.previousUserTurn,
        ];
        return !lines.some((line) => seedExcluded.has(line));
      })
    : turnExemplars;
  const exemplarSection = layers.exemplars
    ? renderExemplars(promptExemplars, input.locale)
    : "";
  const seedMsgs = seedMessagesFor(seeds.exchanges, input.locale);
  const seededOn = seeds.exchanges.length > 0;
  const reminder = await styleReminderForTurn(input, layers.styleReminder, [
    ...seeds.foundTexts,
    ...seeds.excludeTexts,
  ]);
  const reminderOn = reminder.lines.length > 0 || reminder.issues.length > 0;
  const twoStageOn = Boolean(layers.twoStage);
  const factRewriteOn = Boolean(layers.factRewrite);
  const clusterLines = actClusterLinesForTurn(layers.actClusters, sampledAct, input, rng);
  const clustersOn = clusterLines.length > 0;
  const emotionInertiaOn = Boolean(
    layers.emotionInertia &&
      (normalizeEmotionDynamics(effectiveStyleProfile(input.persona).emotionDynamics) ||
        conflictTurn.coldLines.length > 0 ||
        conflictTurn.triggerLines.length > 0 ||
        conflictTurn.forceRepair),
  );

  if (input.exclude) {
    const built = await buildPromptBundleForPersona({
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
      peopleSection: layers.people ? undefined : null,
      stancesSection: layers.people ? undefined : null,
      skipExemplars: !layers.exemplars,
      restrictExemplarsToAct: clustersOn,
      actClusterLines: clusterLines,
      coldLines: conflictTurn.coldLines,
      repairLines: conflictTurn.repairLines,
      triggerLines: conflictTurn.triggerLines,
      closing: closingTurn.closing,
      closerLines: closingTurn.closerLines,
      inSessionShare,
      excludeExemplarIds: [...(input.exclude.recordIds ?? []), ...seeds.excludeIds],
      excludeExemplarTexts: [...(input.exclude.texts ?? []), ...seeds.excludeTexts],
      seedTurnsNote: seeds.note,
      styleReminderLines: reminder.lines,
      reanchorIssues: reminder.issues,
      exemplarSection,
      markRecalled: false,
      history: input.history,
    });
    const historyMessages: LLMMessage[] = input.history.map((row) => {
      const kind =
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as { kind?: unknown }).kind
          : null;
      return {
        role: row.role === "user" ? "user" : "assistant",
        content: kind === "sticker"
          ? renderRecordContent({ kind: "sticker", content: row.content }, input.locale)
          : row.content,
      };
    });
    const messages = spliceAfterSystem(
      [asSystemMessage(built.prompt, built.cacheBreak), ...historyMessages],
      seedMsgs,
    );
    const plannerMessages = twoStageOn
      ? await plannerMessagesForTurn(
        input,
        sampledAct,
        historyMessages,
        closingTurn.closing,
        inSessionShare,
        layers.people,
      )
      : undefined;
    return {
      kind: "model",
      sampledAct,
      ...actMeta,
      messages,
      plannerMessages,
      ...length,
      layersUsed: withMeasuredLayers(
        layersUsed,
        length,
        projectionOn,
        fingerprintRerankOn,
        lexiconOn,
        seededOn,
        false,
        reminderOn,
        twoStageOn,
        clustersOn,
        emotionInertiaOn,
        closingTurn.closing,
        peopleLayerOn(layers.people, messages, input.locale),
        factRewriteOn,
      ),
      exemplarIds: turnExemplars.map((item) => item.id),
      exemplars: turnExemplars,
      seedRecordIds: seeds.excludeIds,
      recalled: [],
      rng,
      ...(reminder.issues.length > 0 ? { reanchor: reminder.issues } : {}),
      ...(closingTurn.closing ? { closing: true } : {}),
      ...(routineId ? { routine: routineId } : {}),
    };
  }

  const { composeMessages } = await import("./service");
  const composed = await composeMessages({
    persona: input.persona,
    userId: input.userId,
    userMessage: input.userMessage,
    retrievalQuery: input.retrievalQuery,
    contextLimit: input.contextLimit ?? 20,
    providerName: input.providerName,
    locale: input.locale,
    now: input.now,
    extraConfig: input.extraConfig,
    replyToId: input.replyToId,
    sampledAct,
    periodId: input.periodId ?? null,
    excludeExemplarIds: seeds.excludeIds,
    excludeExemplarTexts: seeds.excludeTexts,
    skipExemplars: !layers.exemplars,
    restrictExemplarsToAct: clustersOn,
    actClusterLines: clusterLines,
    coldLines: conflictTurn.coldLines,
    repairLines: conflictTurn.repairLines,
    triggerLines: conflictTurn.triggerLines,
    closing: closingTurn.closing,
    closerLines: closingTurn.closerLines,
    inSessionShare,
    seedTurnsNote: seeds.note,
    styleReminderLines: reminder.lines,
    reanchorIssues: reminder.issues,
    exemplarSection,
    peopleSection: layers.people ? undefined : null,
    stancesSection: layers.people ? undefined : null,
  });
  const historyMessages = composed.messages.filter((row) => row.role !== "system");
  const plannerMessages = twoStageOn
    ? await plannerMessagesForTurn(
        input,
        sampledAct,
        historyMessages,
        closingTurn.closing,
        inSessionShare,
        layers.people,
      )
    : undefined;
  return {
    kind: "model",
    sampledAct,
    ...actMeta,
    messages: spliceAfterSystem(composed.messages, seedMsgs),
    plannerMessages,
    ...length,
    layersUsed: withMeasuredLayers(
      layersUsed,
      length,
      projectionOn,
      fingerprintRerankOn,
      lexiconOn,
      seededOn,
      false,
      reminderOn,
      twoStageOn,
      clustersOn,
      emotionInertiaOn,
      closingTurn.closing,
      peopleLayerOn(layers.people, composed.messages, input.locale),
      factRewriteOn,
    ),
    exemplarIds: [],
    seedRecordIds: seeds.excludeIds,
    recalled: composed.recalled,
    rng,
    ...(reminder.issues.length > 0 ? { reanchor: reminder.issues } : {}),
    ...(closingTurn.closing ? { closing: true } : {}),
    ...(routineId ? { routine: routineId } : {}),
  };
}

async function seedPlanForTurn(
  input: TurnInput,
  enabled: boolean,
  sampledAct: SpeechAct | null,
  retrieveForSkip = false,
  precomputed?: Exemplar[],
): Promise<{
  exchanges: SeedExchange[];
  excludeIds: number[];
  excludeTexts: string[];
  note: string | null;
  foundTexts: string[];
}> {
  const empty = {
    exchanges: [] as SeedExchange[],
    excludeIds: [] as number[],
    excludeTexts: [] as string[],
    note: null as string | null,
    foundTexts: [] as string[],
  };
  if (!enabled && !retrieveForSkip) return empty;
  /**
   * The same candidates the prompt will use (C8.7).
   *
   * They are computed once per turn by `planTurn`. The fallback exists
   * only for a caller that built a seed plan by itself.
   */
  let found: Exemplar[];
  if (precomputed) {
    found = precomputed;
  } else {
    const period = ((input.persona.personaData as { periods?: Array<{ id?: string; from?: string; to?: string }> } | null)?.periods ?? [])
      .find((item) => item.id === input.periodId);
    let records: Array<{ role: string; content: string; id?: number; kind?: string | null }> = [];
    const scope = resolveRecordScope(input.persona);
    try {
      records = await db.getCollectedMessagesForPersona(scope.personaId, scope.userId, { newest: true });
    } catch {
      records = [];
    }
    if (!records.length) return empty;
    found = await retrieveExemplarsWithEmbed({
      userMessage: input.userMessage,
      records: records as never,
      excludeIds: input.exclude?.recordIds,
      excludeTexts: input.exclude?.texts,
      personaData: input.persona.personaData as never,
      sampledAct,
      emotion: input.actCondition?.emotion ?? input.persona.emotionalState ?? null,
      now: input.now,
      timeZone: (input.persona as { timezone?: string | null }).timezone ?? null,
      period: period?.from && period?.to ? { from: period.from, to: period.to } : null,
      history: input.history,
      personaId: input.persona.id,
      userId: input.userId,
    });
  }
  if (!found.length) return empty;
  const foundTexts = found.flatMap((item) => [...(item.rawTurn ?? item.turn), ...item.previousUserTurn]);
  if (!enabled) return { ...empty, foundTexts };
  const exchanges = selectSeedExchanges({
    exemplars: found,
    personaData: input.persona.personaData as { harmReport?: never } | null,
  });
  return {
    exchanges,
    excludeIds: exchanges.flatMap((item) => item.recordIds),
    excludeTexts: [
      ...exchanges.flatMap((item) => [...item.user, ...item.them]),
      ...found.flatMap((item) =>
        [...(item.rawTurn ?? item.turn), ...item.previousUserTurn].filter((line) => !isSafeSeedLine(line)),
      ),
    ],
    foundTexts,
    note: exchanges.length > 0 ? copy(input.locale, "prompt.seedTurnsNote") : null,
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

function routineForTurn(input: TurnInput, timeZone: string | null): string | null {
  const events = normalizeLifeEvents(
    (input.persona.personaData as { lifeEvents?: unknown } | null)?.lifeEvents,
  );
  return currentRoutines(events, input.now, timeZone)[0]?.id ?? null;
}

function peopleLayerOn(
  enabled: boolean,
  messages: LLMMessage[],
  locale: "zh" | "en",
): boolean {
  if (!enabled) return false;
  const prompt = String(messages[0]?.content ?? "");
  return (
    prompt.includes(copy(locale, "prompt.peopleHeading")) ||
    prompt.includes(copy(locale, "prompt.stancesHeading"))
  );
}

function withMeasuredLayers(
  layersUsed: LayerId[],
  length: { maxChars?: number },
  projectionOn: boolean,
  fingerprintRerankOn: boolean,
  lexiconOn: boolean,
  seededOn = false,
  ritualOn = false,
  styleReminderOn = false,
  twoStageOn = false,
  actClustersOn = false,
  emotionInertiaOn = false,
  closingOn = false,
  peopleOn = false,
  factRewriteOn = false,
): LayerId[] {
  const extra: LayerId[] = [];
  if (length.maxChars != null) extra.push("lengthCap");
  if (projectionOn) extra.push("projection");
  if (fingerprintRerankOn) extra.push("fingerprintRerank");
  if (lexiconOn) extra.push("lexicon");
  if (seededOn) extra.push("seededTurns");
  if (ritualOn) extra.push("ritual");
  if (styleReminderOn) extra.push("styleReminder");
  if (twoStageOn) extra.push("twoStage");
  if (actClustersOn) extra.push("actClusters");
  if (emotionInertiaOn) extra.push("emotionInertia");
  if (closingOn) extra.push("closing");
  if (peopleOn) extra.push("people");
  if (factRewriteOn) extra.push("factRewrite");
  if (extra.length === 0) return layersUsed;
  const used = new Set<LayerId>([...layersUsed, ...extra]);
  return LAYERS.filter((id) => used.has(id));
}

async function plannerMessagesForTurn(
  input: TurnInput,
  sampledAct: SpeechAct | null,
  history: LLMMessage[],
  closing = false,
  inSessionShare: string | null = null,
  peopleEnabled = true,
): Promise<LLMMessage[]> {
  const built = await buildPromptBundleForPersona({
    persona: input.persona,
    userId: input.userId,
    locale: input.locale,
    now: input.now,
    userMessage: input.userMessage,
    sampledAct,
    periodId: input.periodId ?? null,
    quotedSection: undefined,
    sceneOverlay: null,
    summarySection: "",
    memories: input.memories as never,
    promptMode: "planner",
    skipExemplars: true,
    markRecalled: false,
    history: input.history,
    microRules: null,
    imperfectionProfile: null,
    suppressions: null,
    lexicon: null,
    peopleSection: peopleEnabled ? undefined : null,
    stancesSection: peopleEnabled ? undefined : null,
    closing,
    inSessionShare,
  });
  return [asSystemMessage(built.prompt, built.cacheBreak), ...history];
}

function asSystemMessage(prompt: string, cacheBreak?: number): LLMMessage {
  return cacheBreak != null
    ? { role: "system", content: prompt, cacheBreak }
    : { role: "system", content: prompt };
}

function parsePlannerGist(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as { gist?: unknown };
    if (typeof parsed.gist !== "string") return null;
    const gist = parsed.gist.trim();
    return gist || null;
  } catch {
    return null;
  }
}

function appendVoiceInstruction(
  messages: LLMMessage[],
  gist: string,
  locale: "zh" | "en",
): LLMMessage[] {
  const line = copy(locale, "prompts.twoStage.voice", { gist });
  const first = messages[0];
  if (!first || first.role !== "system" || typeof first.content !== "string") {
    return [{ role: "system", content: line }, ...messages];
  }
  return [{ ...first, content: `${first.content}\n\n${line}` }, ...messages.slice(1)];
}

async function historyForReanchor(input: TurnInput): Promise<TurnInput["history"]> {
  if (input.history.length > 0) return input.history;
  try {
    const rows = await db.getMessagesByPersonaId(input.persona.id, input.userId, 200);
    return rows
      .filter((row) => (row as { origin?: string }).origin !== "system-notice")
      .map((row) => ({
        role: row.role === "user" ? "user" : "assistant",
        content: row.content,
      }));
  } catch {
    return [];
  }
}

async function styleReminderForTurn(
  input: TurnInput,
  enabled: boolean,
  foundTexts: string[],
): Promise<{ lines: string[]; issues: ReanchorIssue[] }> {
  if (!enabled) return { lines: [], issues: [] };
  const profile = effectiveStyleProfile(input.persona);
  const skip = new Set<string>([...foundTexts, ...(input.exclude?.texts ?? [])]);
  const lines = profile.samplePool
    ? pickStyleReminderLines({
        pool: profile.samplePool,
        state: input.actCondition?.emotion ?? input.persona.emotionalState,
        rng: seededRandom(styleReminderSeed(input.persona.id, Number(input.persona.chatCount) || 0)),
        skip,
      })
    : [];
  const history = await historyForReanchor(input);
  const detected = detectReanchor({
    history,
    fingerprint: profile.fingerprint ?? null,
    core: fingerprintCoreForTurn(input) ?? profile.fingerprint ?? null,
  });
  return { lines, issues: detected?.issues ?? [] };
}

function ritualTriggerOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const ritual = (metadata as { ritual?: unknown }).ritual;
  return typeof ritual === "string" && ritual.trim() ? ritual : null;
}

function spokenMillis(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function addressFormsForRitual(input: TurnInput): string[] {
  const history = normalizeAddressHistory(effectiveStyleProfile(input.persona).addressHistory);
  const them = history.filter((entry) => entry.direction === "them_to_me").map((entry) => entry.form);
  return [...new Set([...them, ...defaultAddressForms()].filter(Boolean))];
}

function ritualTurnBlocked(input: TurnInput): boolean {
  if (input.replyToId) return true;
  if (input.quotedSection) return true;
  if (input.sceneOverlay) return true;
  if ((input.persona as { activeSceneId?: number | null }).activeSceneId) return true;
  if (input.mediaType && input.mediaType !== "text") return true;
  return false;
}

function ritualReplyAllowed(
  reply: { text: string; recordId: number },
  input: TurnInput,
  isOver: boolean,
  forms: string[],
): boolean {
  if (input.exclude?.recordIds?.includes(reply.recordId)) return false;
  if (input.exclude?.texts?.includes(reply.text)) return false;
  const kept = filterHarm(
    [{ content: reply.text, role: "assistant" }],
    input.persona.personaData as { harmReport?: never } | null,
  );
  if (kept.length === 0) return false;
  if (isOver && forms.some((form) => form && reply.text.includes(form))) return false;
  return true;
}

async function ritualUsedRecently(input: TurnInput, trigger: string): Promise<boolean> {
  const since = input.now.getTime() - RITUAL_COOLDOWN_MS;
  for (const row of input.history) {
    if (row.role !== "assistant") continue;
    if (ritualTriggerOf(row.metadata) !== trigger) continue;
    const at = spokenMillis(row.timestamp);
    if (at == null || at >= since) return true;
  }
  try {
    const rows = await db.getMessagesSince(
      input.persona.id,
      input.userId,
      new Date(since),
      50,
      "assistant",
    );
    return rows.some((row) => ritualTriggerOf((row as { metadata?: unknown }).metadata) === trigger);
  } catch {
    return false;
  }
}

async function ritualPlanForTurn(
  input: TurnInput,
  enabled: boolean,
  rng: () => number,
): Promise<{ trigger: string; reply: string; recordId?: number } | null> {
  if (!enabled) return null;
  if (ritualTurnBlocked(input)) return null;
  const rituals = normalizeRituals(effectiveStyleProfile(input.persona).rituals);
  if (rituals.length === 0) return null;
  const entry = matchRitual(input.userMessage, rituals);
  if (!entry) return null;
  if (await ritualUsedRecently(input, entry.trigger)) return null;
  const phase = (input.persona.personaData as { relationshipPhase?: string } | null)?.relationshipPhase ?? null;
  const isOver = relationshipIsOver(input.persona.togetherTo, phase);
  const forms = addressFormsForRitual(input);
  const picked = sampleRitualReply(entry, rng, (text) => {
    const row = entry.replies.find((item) => item.text === text);
    if (!row) return false;
    return ritualReplyAllowed(row, input, isOver, forms);
  });
  if (!picked) return null;
  return { trigger: entry.trigger, reply: picked.text, recordId: picked.recordId };
}

function inSessionShareForTurn(
  input: TurnInput,
  enabled: boolean,
  timeZone: string | null,
): string | null {
  if (!enabled) return null;
  const profile = normalizeInSession(effectiveStyleProfile(input.persona).inSession);
  if (!profile) return null;
  const draw = seededRandom(`${input.seed}:in-session`)();
  if (draw >= profile.selfStartRate) return null;
  const raw = pickInSessionFact(
    normalizeLifeEvents((input.persona.personaData as { lifeEvents?: unknown } | null)?.lifeEvents),
    input.now,
    timeZone,
  );
  const fact = raw ? clipPromptFact(raw) : null;
  if (!fact) return null;
  return copy(input.locale, "prompt.inSessionShare", { fact });
}

async function closingForTurn(
  input: TurnInput,
  enabled: boolean,
): Promise<{ closing: boolean; closerLines: string[] }> {
  const empty = { closing: false, closerLines: [] as string[] };
  if (!enabled) return empty;
  const profile = normalizeSessionProfile(effectiveStyleProfile(input.persona).sessions);
  if (!profile) return empty;
  let sessionStart: Date | null = null;
  try {
    sessionStart = await db.getSessionStartAt(input.persona.id, input.userId);
  } catch {
    sessionStart = null;
  }
  if (!sessionStart) return empty;
  const sessionMin = (input.now.getTime() - sessionStart.getTime()) / 60_000;
  let closedThisSession = false;
  try {
    const recent = await db.getMessagesSince(input.persona.id, input.userId, sessionStart);
    closedThisSession = recent.some((row) => {
      const meta = row.metadata as { closing?: unknown } | null | undefined;
      return Boolean(meta && typeof meta === "object" && meta.closing === true);
    });
  } catch {
    closedThisSession = false;
  }
  const personaZone = (input.persona as { timezone?: string | null }).timezone ?? null;
  let userZone: string | null = null;
  if (!personaZone?.trim()) {
    try {
      userZone = await db.getUserTimezone(input.userId);
    } catch {
      userZone = null;
    }
  }
  const timeZone = preferredClockZone(personaZone, userZone);
  const closing = shouldClose({
    sessionMin,
    personaMinuteOfDay: minuteOfDay(input.now, timeZone),
    profile,
    closedThisSession,
  });
  /**
   * The closers are material, like the other lines measured from the
   * records. A line the user asked to remove for harm must not come
   * back through the closing block after the exemplar and conflict
   * blocks have already filtered it.
   */
  const closers = closing
    ? filterHarm(
        profile.closers.map((row) => ({ content: row.text, role: "assistant" as const })),
        input.persona.personaData as { harmReport?: never } | null,
      )
        .slice(0, CLOSER_PROMPT_MAX)
        .map((row) => row.content)
    : [];
  return { closing, closerLines: closers };
}

function conflictMaterialForTurn(
  input: TurnInput,
  enabled: boolean,
): { coldLines: string[]; repairLines: string[]; triggerLines: string[]; forceRepair: boolean } {
  const empty = {
    coldLines: [] as string[],
    repairLines: [] as string[],
    triggerLines: [] as string[],
    forceRepair: false,
  };
  if (!enabled) return empty;
  const profile = effectiveStyleProfile(input.persona);
  const conflict = normalizeConflictProfile(profile.conflict);
  const triggers = normalizeTriggers(profile.triggers) ?? [];
  const state = String(input.actCondition?.emotion ?? input.persona.emotionalState ?? "");
  const coldLines =
    conflict && (state === "distant" || state === "melancholy") ? conflict.coldLines.slice(0, 5) : [];
  const since = sinceStamp(input.persona);
  const forceRepair =
    Boolean(conflict) &&
    Boolean(since) &&
    shouldForceRepair({
      state,
      sinceMin: (input.now.getTime() - since!.at) / 60_000,
      profile: conflict!,
      random: seededRandom(`${input.persona.id}:${since!.iso}`),
    });
  const triggerLines = triggers.slice(0, 5).map((entry) => {
    const label = copy(input.locale, USER_ACT_COPY_KEYS[entry.userAct]);
    const example = entry.examples[0]?.text ?? "";
    return example ? `${label} ${example}` : label;
  });
  return {
    coldLines,
    repairLines: forceRepair && conflict ? conflict.repairLines.slice() : [],
    triggerLines,
    forceRepair,
  };
}

function sinceStamp(persona: { emotionalStateSince?: Date | string | null }): { at: number; iso: string } | null {
  const raw = persona.emotionalStateSince;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  const at = date.getTime();
  if (!Number.isFinite(at)) return null;
  return { at, iso: date.toISOString() };
}

function actClusterLinesForTurn(
  enabled: boolean,
  sampledAct: SpeechAct | null,
  input: TurnInput,
  rng: () => number,
): string[] {
  if (!enabled || !sampledAct) return [];
  const clusters = effectiveStyleProfile(input.persona).actClusters?.[sampledAct];
  if (!clusters || clusters.length === 0) return [];
  return pickActClusterLines(clusters, rng);
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

function withFactRewriteInstruction(messages: LLMMessage[], locale: "zh" | "en"): LLMMessage[] {
  const line = copy(locale, "prompt.factRewrite");
  if (messages.length === 0) return [{ role: "system", content: line }];
  const first = messages[0]!;
  if (first.role !== "system") return [{ role: "system", content: line }, ...messages];
  return [{ ...first, content: `${first.content}\n\n${line}` }, ...messages.slice(1)];
}

function claimsContextFor(plan: TurnPlan, input: TurnInput): VerifyClaimsContext {
  return {
    personaId: input.persona.id,
    userId: input.userId,
    memories: plan.recalled.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
    })),
  };
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

async function invokeAbortable(
  provider: LLMProvider,
  params: Parameters<typeof llmService.invokeWithProvider>[1],
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
  const work = llmService.invokeWithProvider(provider, {
    ...params,
    options: {
      ...params.options,
      purpose: params.options?.purpose ?? "reply",
      signal,
    },
  });
  if (!signal) return work;
  return await Promise.race([
    work,
    new Promise<string>((_, reject) => {
      const fail = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail, { once: true });
    }),
  ]);
}

export async function* executePlan(
  plan: TurnPlan,
  input: TurnInput,
  io: {
    provider: LLMProvider;
    plannerProvider?: LLMProvider;
    voiceProvider?: LLMProvider;
    mode: "stream" | "once";
    rerank: boolean;
    signal?: AbortSignal;
    options: Pick<
      LLMOptions,
      | "temperature"
      | "maxTokens"
      | "provider"
      | "topP"
      | "presencePenalty"
      | "frequencyPenalty"
      | "extraBody"
    >;
    emitDeltas?: boolean;
    trainingTexts?: string[];
    /** Chat fills an empty answer with the silence copy. Evaluation leaves it empty so the case is skipped. */
    emptyAsSilence?: boolean;
  },
): AsyncGenerator<
  | { type: "thinking" }
  | { type: "delta"; text: string }
  | { type: "final"; text: string; projection: string[]; rerank?: RerankResult; twoStage?: "ok" | "fallback" }
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
    topP: io.options.topP,
    presencePenalty: io.options.presencePenalty,
    frequencyPenalty: io.options.frequencyPenalty,
    extraBody: io.options.extraBody,
    stop: plan.stop,
    signal: io.signal,
  };
  const plannerOptions = {
    provider: io.options.provider,
    temperature: io.options.temperature,
    topP: io.options.topP,
    presencePenalty: io.options.presencePenalty,
    frequencyPenalty: io.options.frequencyPenalty,
    extraBody: io.options.extraBody,
    signal: io.signal,
    purpose: "plan" as const,
  };
  const sampling = normalizePersonaSettings(input.persona.settings).sampling;
  const replyOptions = {
    ...invokeOptions,
    purpose: "reply" as const,
    ...(sampling?.temperature != null ? { temperature: sampling.temperature } : {}),
    ...(sampling?.topP != null ? { topP: sampling.topP } : {}),
    ...(sampling?.presencePenalty != null ? { presencePenalty: sampling.presencePenalty } : {}),
    ...(sampling?.frequencyPenalty != null ? { frequencyPenalty: sampling.frequencyPenalty } : {}),
  };
  const locale = input.locale;
  const plannerProvider = io.plannerProvider ?? io.provider;
  const voiceProvider = io.voiceProvider ?? io.provider;
  let replyMessages = plan.messages;
  let twoStage: "ok" | "fallback" | undefined;
  if (plan.layersUsed.includes("twoStage") && plan.kind === "model") {
    let gist: string | null = null;
    try {
      const raw = await llmService.invokeWithProvider(plannerProvider, {
        messages: plan.plannerMessages ?? plan.messages,
        options: { ...plannerOptions, purpose: "plan" },
      });
      gist = parsePlannerGist(typeof raw === "string" ? raw : "");
    } catch {
      gist = null;
    }
    if (!gist || !isSafeSeedLine(gist)) {
      twoStage = "fallback";
    } else {
      twoStage = "ok";
      replyMessages = appendVoiceInstruction(plan.messages, gist, locale);
    }
  }
  const useRerank = io.rerank && plan.layersUsed.includes("rerank");
  const rerankModel = useRerank
    ? io.trainingTexts
      ? buildRerankModel(
          input.exclude?.texts
            ? io.trainingTexts.filter((text) => !input.exclude?.texts?.includes(text))
            : io.trainingTexts,
        )
      : await getRerankModel(
          resolveRecordScope(input.persona).personaId,
          resolveRecordScope(input.persona).userId,
        )
    : null;

  if (useRerank && rerankModel) {
    yield { type: "thinking" };
    let texts = await Promise.all(
      Array.from({ length: 4 }, async () => {
        try {
          const answer = await llmService.invokeWithProvider(voiceProvider, {
            messages: replyMessages,
            options: { ...replyOptions, purpose: "reply" },
          });
          return typeof answer === "string" ? answer : "";
        } catch {
          return "";
        }
      }),
    );
    const rewriteOn = plan.layersUsed.includes("factRewrite");
    if (rewriteOn) {
      const ctx = claimsContextFor(plan, input);
      const judged = await Promise.all(
        texts.map(async (text) => ({
          text,
          unsupported: text ? await hasUnsupportedClaim(text, ctx, locale) : true,
        })),
      );
      const kept = judged.filter((row) => row.text && !row.unsupported).map((row) => row.text);
      if (kept.length > 0) {
        texts = kept;
      } else {
        try {
          const rewritten = await llmService.invokeWithProvider(voiceProvider, {
            messages: withFactRewriteInstruction(replyMessages, locale),
            options: { ...replyOptions, purpose: "reply" },
          });
          texts = [typeof rewritten === "string" ? rewritten : ""];
        } catch {
          texts = judged.map((row) => row.text).filter(Boolean);
        }
      }
    }
    /**
     * The exemplars the prompt already used (C8.7).
     *
     * Reading the whole history again just to score the four rerank
     * candidates was the second full read of a single turn.
     */
    const exemplars = plan.exemplars ?? [];
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
    yield {
      type: "final",
      text: capped.text,
      projection: capped.projection,
      rerank: picked ?? undefined,
      ...(twoStage ? { twoStage } : {}),
    };
    return;
  }

  // Two-stage plus a fact rewrite has to see the whole reply before it
  // goes out. The web route always streams; that path still rewrites.
  const rewriteTwoStage = plan.layersUsed.includes("factRewrite")
    && plan.layersUsed.includes("twoStage");
  if (
    io.mode === "stream"
    && voiceProvider.stream
    && voiceProvider.capabilities.streaming
    && !rewriteTwoStage
  ) {
    let replyText = "";
    const stream = llmService.streamWithProvider(voiceProvider, {
      messages: replyMessages,
      options: { ...replyOptions, purpose: "reply" },
    });
    const aborted = io.signal
      ? new Promise<never>((_, reject) => {
          const fail = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (io.signal?.aborted) fail();
          else io.signal?.addEventListener("abort", fail, { once: true });
        })
      : null;
    const iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const next = aborted
        ? await Promise.race([iterator.next(), aborted])
        : await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      replyText += chunk.text;
      // Always yield the chunk so a mid-stream failure still leaves the
      // half-answer in the caller's buffer. The caller decides whether
      // the user sees it live.
      yield { type: "delta", text: chunk.text };
    }
    const streamed = finalizeGenerated(replyText, plan, input);
    yield {
      type: "final",
      text: streamed.text,
      projection: streamed.projection,
      ...(twoStage ? { twoStage } : {}),
    };
    return;
  }

  let replyText = await invokeAbortable(voiceProvider, {
    messages: replyMessages,
    options: { ...replyOptions, purpose: "reply" },
  }, io.signal);
  if (io.emptyAsSilence === false) {
    replyText = typeof replyText === "string" ? replyText : "";
  } else {
    replyText = replyText || copy(locale, "prompt.silence");
  }
  if (plan.layersUsed.includes("factRewrite") && typeof replyText === "string" && replyText) {
    try {
      if (await hasUnsupportedClaim(replyText, claimsContextFor(plan, input), locale)) {
        const rewritten = await llmService.invokeWithProvider(voiceProvider, {
          messages: withFactRewriteInstruction(replyMessages, locale),
          options: { ...replyOptions, purpose: "reply" },
        });
        if (typeof rewritten === "string" && rewritten) replyText = rewritten;
      }
    } catch {
      // The first reply still goes out.
    }
  }
  const once = finalizeGenerated(replyText, plan, input);
  if (io.emitDeltas) yield { type: "delta", text: once.text };
  yield {
    type: "final",
    text: once.text,
    projection: once.projection,
    ...(twoStage ? { twoStage } : {}),
  };
}
