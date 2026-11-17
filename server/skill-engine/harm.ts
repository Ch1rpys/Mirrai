/**
 * Confirms which candidate lines were actually aimed at the other person.
 *
 * The cue lists over-match: a quote, a joke, a line about someone else.
 * After the map stage, each kind that has enough hits is sent to a model
 * in a fence, and only the confirmed lines become a harm report.
 */
import { extractJsonArray } from "../_core/json";
import { copy, type Locale } from "@shared/copy";
import {
  findHarmCandidates,
  type HarmCandidate,
  type HarmKind,
  type HarmReport,
} from "@shared/harm";
import type { LLMMessage } from "../llm/types";
import { asMaterial } from "./material";

const KIND_MIN = 3;
const KIND_MAX_SEND = 20;

export interface HarmConfirmRecord {
  id: number;
  role?: string;
  content?: string | null;
  kind?: string | null;
}

function isConfirmed(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "yes";
}

function parseConfirmed(
  answer: string,
  batch: HarmCandidate[],
): HarmCandidate[] {
  const parsed = extractJsonArray(answer);
  if (!Array.isArray(parsed)) return [];
  const kept: HarmCandidate[] = [];
  const seen = new Set<number>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const index = Number(record.i);
    if (!Number.isInteger(index) || index < 0 || index >= batch.length) continue;
    if (!isConfirmed(record.harm)) continue;
    const row = batch[index]!;
    if (seen.has(row.recordId)) continue;
    seen.add(row.recordId);
    kept.push(row);
  }
  return kept;
}

export async function confirmHarmFromRecords(params: {
  records: HarmConfirmRecord[];
  locale?: Locale;
  invoke?: (messages: LLMMessage[]) => Promise<string>;
}): Promise<HarmReport | null> {
  const locale = params.locale ?? "zh";
  const candidates = findHarmCandidates(params.records);
  if (candidates.length === 0) return null;

  const byKind = new Map<HarmKind, HarmCandidate[]>();
  for (const row of candidates) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }

  const invoke = params.invoke;
  const categories: HarmReport["categories"] = [];
  const instruction = copy(locale, "prompts.distill.confirmHarm");

  for (const [kind, rows] of byKind) {
    if (rows.length < KIND_MIN) continue;
    const batch = rows.slice(0, KIND_MAX_SEND);
    let confirmed = batch;
    if (invoke) {
      const payload = batch.map((row, i) => ({
        i,
        kind: row.kind,
        text: row.snippet,
      }));
      let answer = "";
      try {
        answer = await invoke([
          { role: "system", content: instruction },
          { role: "user", content: asMaterial(JSON.stringify(payload), locale) },
        ]);
      } catch {
        continue;
      }
      confirmed = parseConfirmed(answer, batch);
    }
    if (confirmed.length < KIND_MIN) continue;
    categories.push({
      kind,
      count: confirmed.length,
      examples: confirmed.slice(0, 3).map((row) => row.recordId),
      snippets: confirmed.slice(0, 3).map((row) => row.snippet),
    });
  }

  if (categories.length === 0) return null;
  return { categories, decision: "pending" };
}
