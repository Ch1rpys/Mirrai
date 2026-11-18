/**
 * How far the rebuilt persona drifts across a long conversation.
 *
 * A held-out line is one turn. A person who sounds like themselves on
 * one turn can still wander after fifty — the helpful-assistant voice
 * creeps in, the length stretches, the surprise goes up. This ruler
 * talks to the persona for many turns, with a simulated other side,
 * and watches the fingerprint window by window.
 *
 * Nothing here is written to the database. The history lives in
 * memory. The product conversation is not this conversation.
 */
import type { Persona } from "../../drizzle/schema";
import type { LLMMessage, LLMProvider } from "../llm/types";
import { llmService } from "../llm";
import { executePlan, planTurn } from "../chat/generate";
import { copy } from "@shared/copy";
import { asMaterial } from "@shared/material";
import { scoreResidue, type ResidueScore } from "@shared/assistant-residue";
import {
  lineSurprise,
  styleDistance,
  type StyleDistance,
  type StyleFingerprintCore,
} from "@shared/style-fingerprint";
import { normalizeStyleProfile } from "@shared/style-profile";
import type { EvalCaseData } from "./dataset";

export const DRIFT_WINDOW_SIZE = 10;
export const DRIFT_TURNS_DEFAULT = 50;
/** How much a later window may rise above the first before it counts as drift. */
export const DRIFT_WINDOW_DELTA = 0.1;

export interface DriftTurn {
  surprise: number;
  residue: ResidueScore;
  chars: number;
  text: string;
}

export interface DriftWindow {
  index: number;
  surprise: number;
  residueRate: number;
  styleDistance: StyleDistance;
}

export interface DriftReport {
  windows: DriftWindow[];
  slope: number;
  firstWindowOver: number | null;
  turns: DriftTurn[];
}

export class DriftNeedUserSideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftNeedUserSideError";
  }
}

/**
 * The instruction the simulated user sees, with the real lines fenced.
 */
export function simUserSystemPrompt(locale: "zh" | "en", sampleLines: string[]): string {
  return [copy(locale, "prompts.eval.simUser"), asMaterial(sampleLines.join("\n"), locale)].join(
    "\n\n",
  );
}

/**
 * Ordinary least squares slope of `values` against their index.
 *
 * One window is not a slope. Two or more: the line through the points.
 */
export function windowSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i] ?? 0;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return 0;
  return (n * sumXY - sumX * sumY) / den;
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

function asHistory(
  rows: Array<{ role: string; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  return rows.map((row) => ({
    role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: row.content,
  }));
}

function toMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): LLMMessage[] {
  return history.map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

function lastUserContent(history: Array<{ role: "user" | "assistant"; content: string }>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") return history[i]!.content;
  }
  return "";
}

function emptyDistance(): StyleDistance {
  return { total: 0, endings: 0, particles: 0, laugh: 0, emoji: 0, length: 0 };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface DriftOptions {
  persona: Persona;
  userId: number;
  turns?: number;
  startCase: EvalCaseData;
  provider: LLMProvider;
  seed?: string;
  locale?: "zh" | "en";
}

/**
 * Talks to the persona for `turns` rounds and measures the windows.
 */
export async function runDrift(options: DriftOptions): Promise<DriftReport> {
  const locale = options.locale ?? "zh";
  const profile = normalizeStyleProfile(options.persona.styleProfile);
  const sampleLines = profile.userSide?.sampleLines?.filter((line) => line.trim()) ?? [];
  if (sampleLines.length === 0) {
    throw new DriftNeedUserSideError(copy(locale, "eval.drift.needUserSide"));
  }

  const fingerprint: StyleFingerprintCore | null = profile.fingerprint ?? null;
  const ceiling = fingerprint?.length.p90 ?? null;
  const turns = Math.max(1, options.turns ?? DRIFT_TURNS_DEFAULT);
  const seed = options.seed ?? "drift";
  const history = asHistory(options.startCase.context);
  const recorded: DriftTurn[] = [];
  const now = options.startCase.expected.timestamp ?? new Date("2023-01-01T12:00:00.000Z");

  for (let turn = 0; turn < turns; turn++) {
    let userLine = "";
    try {
      userLine = await llmService.invokeWithProvider(options.provider, {
        messages: [
          { role: "system", content: simUserSystemPrompt(locale, sampleLines) },
          ...toMessages(history),
        ],
        options: { maxTokens: 80, temperature: 0.7, purpose: "eval" },
      });
    } catch (error) {
      console.warn(`[Drift] simulated user failed on turn ${turn}: ${(error as Error).message}`);
    }
    userLine = typeof userLine === "string" ? userLine.trim() : "";
    if (userLine) history.push({ role: "user", content: userLine });

    const turnInput = {
      persona: options.persona,
      userId: options.userId,
      userMessage: lastUserContent(history),
      history,
      now,
      locale,
      seed: `${seed}:${turn}`,
      periodId: options.startCase.periodId ?? null,
      actCondition: {
        emotion: options.startCase.expectedState,
        dayPart: options.startCase.dayPart ?? null,
      },
      layerOverrides: { rerank: false },
      exclude: {
        recordIds: options.startCase.expected.id ? [options.startCase.expected.id] : undefined,
        texts: [options.startCase.expected.content],
      },
    };

    let generated = "";
    try {
      const plan = await planTurn(turnInput);
      for await (const event of executePlan(plan, turnInput, {
        provider: options.provider,
        mode: "once",
        rerank: false,
        options: { maxTokens: 200, temperature: 0.7 },
        emitDeltas: false,
        emptyAsSilence: false,
      })) {
        if (event.type === "final") generated = typeof event.text === "string" ? event.text : "";
      }
    } catch (error) {
      console.warn(`[Drift] persona failed on turn ${turn}: ${(error as Error).message}`);
    }

    generated = generated.trim();
    if (generated) history.push({ role: "assistant", content: generated });

    recorded.push({
      surprise: fingerprint ? lineSurprise(generated, fingerprint) : 0,
      residue: scoreResidue(generated, { ceiling }),
      chars: codePoints(generated),
      text: generated,
    });
  }

  const windows: DriftWindow[] = [];
  for (let start = 0; start + DRIFT_WINDOW_SIZE <= recorded.length; start += DRIFT_WINDOW_SIZE) {
    const slice = recorded.slice(start, start + DRIFT_WINDOW_SIZE);
    const lines = slice.map((row) => row.text);
    windows.push({
      index: windows.length,
      surprise: mean(slice.map((row) => row.surprise)),
      residueRate: mean(slice.map((row) => row.residue.rate)),
      styleDistance: fingerprint ? styleDistance(lines, fingerprint) : emptyDistance(),
    });
  }

  const totals = windows.map((window) => window.styleDistance.total);
  const first = totals[0] ?? 0;
  let firstWindowOver: number | null = null;
  for (const window of windows) {
    if (window.styleDistance.total > first + DRIFT_WINDOW_DELTA) {
      firstWindowOver = window.index;
      break;
    }
  }

  return {
    windows,
    slope: windowSlope(totals),
    firstWindowOver,
    turns: recorded,
  };
}
