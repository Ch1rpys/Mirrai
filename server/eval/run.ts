/**
 * Running the ruler.
 *
 * This is the loop that makes "does it still sound like them" a question
 * with an answer: hold out a line the person actually said, ask the
 * rebuilt persona to say it again, and score the two against each other.
 *
 * The persona is prompted through exactly the same path the chat uses —
 * `buildPromptForPersona` — because a measurement taken against a
 * different prompt would be measuring a different product.
 */
import type { Persona } from "../../drizzle/schema";
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import { buildPromptForPersona } from "../chat/prompt";
import type { LLMMessage } from "../llm/types";
import {
  aggregateScores,
  buildCharNgramModel,
  scoreCase,
  type EvalMetrics,
} from "./metrics";
import type { EvalCaseData } from "./dataset";
import { dayPartFromHour, normalizeActProfile, sampleAct } from "@shared/act-profile";
import { isUserAsking } from "@shared/speech-acts";
import { pickRerankWinner } from "../chat/rerank";
import { retrieveExemplars } from "../chat/exemplars";
import * as db from "../db";
import { zonedHour } from "@shared/timezone";
import { seededRandom } from "../_core/behavior-profile";

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

export interface EvalRunOptions {
  persona: Persona;
  userId: number;
  cases: EvalCaseData[];
  /** The persona's other lines, for the n-gram model. Never the held-out ones. */
  trainingTexts: string[];
  locale?: "zh" | "en";
  variant?: EvalVariant;
  maxTokens?: number;
  temperature?: number;
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
}

/**
 * The conversation, as the model sees it.
 *
 * The held-out line is not in it. The context is the real conversation,
 * in the real order, with the roles the real conversation had.
 */
function messagesForCase(
  systemPrompt: string,
  caseData: EvalCaseData,
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "system", content: systemPrompt }];
  for (const message of caseData.context) {
    messages.push({
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    });
  }
  return messages;
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
  const provider = await resolveProviderForUser({ userId: options.userId });
  if (!provider) {
    throw new Error("No LLM provider is configured for this user.");
  }

  const switches = variantSwitches(variant);
  const useRerank = options.rerank ?? false;
  const useAct = options.sampleAct ?? (switches.act === "on");
  const actProfile = normalizeActProfile((options.persona.personaData as any)?.actProfile);
  const model = buildCharNgramModel(options.trainingTexts);
  const scores = [];
  const whyWon: string[] = [];

  for (let i = 0; i < options.cases.length; i++) {
    const caseData = options.cases[i];
    const lastUser = [...caseData.context].reverse().find((m) => m.role === "user");
    const sampled = useAct && actProfile
      ? sampleAct(
          actProfile,
          {
            asking: isUserAsking(lastUser?.content),
            emotion: options.persona.emotionalState ?? "warm",
            dayPart: dayPartFromHour(zonedHour(new Date(), (options.persona as any).timezone)),
            relationshipPhase: (options.persona.personaData as any)?.relationshipPhase ?? "initial",
          },
          {
            dropSilence: true,
            rng: seededRandom(`eval:${options.persona.id}:${i}:${caseData.expected.content}`),
          },
        )
      : null;

    const systemPrompt = await buildPromptForPersona({
      persona: options.persona,
      userId: options.userId,
      locale,
      userMessage: lastUser?.content,
      microRules: switches.rules === "off" ? null : undefined,
      imperfectionProfile: switches.imperfection === "off" ? null : undefined,
      sampledAct: sampled && sampled.act !== "silence" ? sampled.act : null,
      excludeExemplarIds: caseData.expected.id ? [caseData.expected.id] : undefined,
      excludeExemplarTexts: [caseData.expected.content],
      markRecalled: false,
    });

    let generated = "";
    let winnerNote = "";
    try {
      const invoke = async () => {
        const answer = await llmService.invokeWithProvider(provider, {
          messages: messagesForCase(systemPrompt, caseData),
          options: {
            maxTokens: options.maxTokens ?? 200,
            temperature: options.temperature ?? 0.7,
          },
        });
        return typeof answer === "string" ? answer : "";
      };
      if (useRerank && switches.rerank === "on") {
        const texts = await Promise.all(Array.from({ length: 4 }, () => invoke().catch(() => "")));
        const records = await db
          .getCollectedMessagesForPersona(options.persona.id, options.userId)
          .catch(() => []);
        const exemplars = retrieveExemplars({
          userMessage: lastUser?.content ?? "",
          records: records as any,
          excludeTexts: [caseData.expected.content],
          excludeIds: caseData.expected.id ? [caseData.expected.id] : [],
        });
        const picked = pickRerankWinner({
          candidates: texts.map((text) => ({ text })),
          trainingTexts: options.trainingTexts.filter((text) => text !== caseData.expected.content),
          exemplars: exemplars.map((item) => item.content),
        });
        generated = picked?.text ?? texts.find(Boolean) ?? "";
        const winner = picked?.scores.find((row) => row.index === picked.index);
        winnerNote = `case ${i} picked #${picked?.index ?? 0} distance=${winner?.distanceToMedian?.toFixed(3) ?? "n/a"} discarded=${picked?.scores.filter((s) => s.discarded).length}`;
      } else {
        generated = await invoke();
      }
    } catch (error) {
      console.warn(
        `[Eval] Case ${caseData.expected.content.slice(0, 30)} failed: ${
          (error as Error).message
        }`,
      );
    }
    if (!generated.trim()) {
      options.onProgress?.(i + 1, options.cases.length);
      continue;
    }
    if (winnerNote) whyWon.push(winnerNote);
    scores.push(
      scoreCase({
        caseId: i,
        expected: caseData.expected.content,
        generated,
        model,
        declaredState: caseData.expectedState ?? null,
        locale,
        expectedAct: caseData.expectedAct ?? null,
        sampledAct: sampled?.act ?? null,
        previousUser: lastUser?.content ?? null,
      }),
    );
    options.onProgress?.(i + 1, options.cases.length);
  }

  const aggregated = aggregateScores(scores);
  if (whyWon.length) {
    aggregated.variant = `${variant}; ${whyWon.join(" | ")}`;
  }
  return aggregated;
}
