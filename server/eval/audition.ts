/**
 * Which configured model still sounds like them.
 *
 * The persona is pointed at one provider. The user may have several.
 * This runs the same held-out cases against each one — no rerank, one
 * sample — and ranks them on the same numbers the ruler already has.
 *
 * A candidate that throws is recorded and skipped. The rest still get
 * a score. The composite is the mean of the batch's own z-scores, so
 * it only means something inside this sitting.
 */
import type { Persona } from "../../drizzle/schema";
import type { LLMProvider } from "../llm/types";
import { registry } from "../llm";
import { buildUserProvider } from "../llm/user-provider";
import * as db from "../db";
import { copy } from "@shared/copy";
import { runEval, type EvalRunOptions } from "./run";
import type { EvalCaseData } from "./dataset";
import type { EvalMetrics } from "./metrics";
import type { Locale } from "@shared/copy";

export interface AuditionSlot {
  id: string;
  providerName: string;
  model: string;
  provider: LLMProvider;
}

export interface AuditionResult {
  id: string;
  providerName: string;
  model: string;
  label: string;
  overlap?: number;
  likelihoodGap?: number;
  lengthDistance?: number;
  emotionAccuracy?: number;
  styleDistance?: number | null;
  residueRate?: number;
  avgChars?: number;
  avgMs?: number;
  composite?: number;
  error?: string;
}

export interface AuditionReport {
  results: AuditionResult[];
  cases: number;
  calls: number;
}

export interface AuditionOptions {
  persona: Persona;
  userId: number;
  cases: EvalCaseData[];
  trainingTexts: string[];
  locale?: Locale;
  providers?: AuditionSlot[];
}

const COMPOSITE_METRICS: Array<{
  key: keyof Pick<
    AuditionResult,
    | "overlap"
    | "likelihoodGap"
    | "lengthDistance"
    | "emotionAccuracy"
    | "styleDistance"
    | "residueRate"
    | "avgChars"
    | "avgMs"
  >;
  lowerBetter: boolean;
  transform?: (value: number) => number;
}> = [
  { key: "overlap", lowerBetter: false },
  { key: "likelihoodGap", lowerBetter: true, transform: Math.abs },
  { key: "lengthDistance", lowerBetter: true },
  { key: "emotionAccuracy", lowerBetter: false },
  { key: "styleDistance", lowerBetter: true },
  { key: "residueRate", lowerBetter: true },
  { key: "avgChars", lowerBetter: true },
  { key: "avgMs", lowerBetter: true },
];

export function auditionLabel(providerName: string, model: string): string {
  const name = providerName.trim();
  const trimmed = model.trim();
  return trimmed ? `${name} · ${trimmed}` : name;
}

/**
 * Every environment-configured provider, plus every row the user saved.
 */
export async function listAuditionProviders(userId: number): Promise<AuditionSlot[]> {
  const slots: AuditionSlot[] = [];
  for (const row of registry.list()) {
    if (!row.configured) continue;
    const provider = registry.get(row.name);
    if (!provider) continue;
    slots.push({
      id: `env:${row.name}`,
      providerName: row.name,
      model: registry.getBaseConfig(row.name)?.model ?? "",
      provider,
    });
  }
  const configs = await db.getLlmConfigsByUserId(userId);
  for (const config of configs) {
    const provider = await buildUserProvider(userId, config);
    if (!provider) continue;
    slots.push({
      id: `user:${config.id}`,
      providerName: config.providerName,
      model: config.model ?? "",
      provider,
    });
  }
  return slots;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function zScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((value) => (value - avg) / std);
}

function numeric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fills `composite` from this batch and sorts highest first.
 *
 * Failed rows stay at the bottom, in the order they were tried.
 */
export function attachComposite(results: AuditionResult[]): AuditionResult[] {
  const scored = results.filter((row) => !row.error);
  const failed = results.filter((row) => row.error);
  const sums = new Map<AuditionResult, { total: number; n: number }>();
  for (const row of scored) sums.set(row, { total: 0, n: 0 });
  for (const spec of COMPOSITE_METRICS) {
    const pairs: Array<{ row: AuditionResult; value: number }> = [];
    for (const row of scored) {
      const raw = numeric(row[spec.key] as number | null | undefined);
      if (raw == null) continue;
      pairs.push({ row, value: spec.transform ? spec.transform(raw) : raw });
    }
    if (pairs.length === 0) continue;
    const zs = zScores(pairs.map((pair) => pair.value));
    for (let i = 0; i < pairs.length; i++) {
      const row = pairs[i]!.row;
      const bucket = sums.get(row);
      if (!bucket) continue;
      bucket.total += spec.lowerBetter ? -zs[i]! : zs[i]!;
      bucket.n += 1;
    }
  }
  for (const row of scored) {
    const bucket = sums.get(row);
    row.composite = !bucket || bucket.n === 0 ? 0 : bucket.total / bucket.n;
  }
  scored.sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0) || a.label.localeCompare(b.label));
  return [...scored, ...failed];
}

function avgCharsOf(metrics: EvalMetrics): number {
  return mean(metrics.scores.map((score) => score.generatedLength));
}

/**
 * Runs the same cases against each candidate.
 */
export async function runAudition(options: AuditionOptions): Promise<AuditionReport> {
  const locale = options.locale ?? "zh";
  const providers = options.providers ?? (await listAuditionProviders(options.userId));
  const results: AuditionResult[] = [];
  const evalOptions: Omit<EvalRunOptions, "provider"> = {
    persona: options.persona,
    userId: options.userId,
    cases: options.cases,
    trainingTexts: options.trainingTexts,
    locale,
    rerank: false,
    samplesPerCase: 1,
  };

  for (const slot of providers) {
    const base: AuditionResult = {
      id: slot.id,
      providerName: slot.providerName,
      model: slot.model,
      label: auditionLabel(slot.providerName, slot.model),
    };
    const started = Date.now();
    try {
      const metrics = await runEval({ ...evalOptions, provider: slot.provider });
      const avgMs = Date.now() - started;
      if (!metrics.cases) {
        results.push({
          ...base,
          error: copy(locale, "eval.audition.failed"),
        });
        continue;
      }
      results.push({
        ...base,
        overlap: metrics.overlap,
        likelihoodGap: metrics.likelihoodGap,
        lengthDistance: metrics.lengthDistance,
        emotionAccuracy: metrics.emotionAccuracy,
        styleDistance: metrics.styleDistance?.total ?? null,
        residueRate: metrics.residueRate ?? 0,
        avgChars: avgCharsOf(metrics),
        avgMs: options.cases.length ? avgMs / options.cases.length : avgMs,
      });
    } catch (error) {
      results.push({
        ...base,
        error: error instanceof Error && error.message.trim()
          ? error.message
          : copy(locale, "eval.audition.failed"),
      });
    }
  }

  return {
    results: attachComposite(results),
    cases: options.cases.length,
    calls: providers.length * options.cases.length,
  };
}
