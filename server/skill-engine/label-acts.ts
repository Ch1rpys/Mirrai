/**
 * Labels every round of the record with a speech act, once.
 *
 * Distillation used to send only the first eighty unlabelled replies to
 * the model. Everything after that never entered the distribution. The
 * walk here covers the whole record, writes the labels back, and a
 * later run skips rows that already have one.
 */
import { extractJsonArray } from "../_core/json";
import { seededRandom } from "../_core/behavior-profile";
import { copy, type Locale } from "@shared/copy";
import { getDistillationPreset, type DistillationMode } from "@shared/distillation-modes";
import { isTextRecord } from "@shared/records";
import { toTurns } from "@shared/scenes";
import { zonedDateKey } from "@shared/timezone";
import {
  ACT_COPY_KEYS,
  SPEECH_ACTS,
  USER_ACTS,
  USER_ACT_COPY_KEYS,
  isSpeechAct,
  isUserAct,
  labelSpeechActByRule,
  labelUserActByRule,
  type SpeechAct,
  type UserAct,
} from "@shared/speech-acts";
import type { LLMMessage } from "../llm/types";
import { asMaterial } from "./material";
import * as db from "../db";

export const ACT_LABEL_BATCH = 60;

export interface ActLabelRecord {
  id: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  speaker?: string | null;
  act?: string | null;
  actSource?: string | null;
}

export interface LabelActsResult {
  labelled: number;
  modelled: number;
  calls: number;
}

function dbFn(name: string): ((...args: never[]) => unknown) | undefined {
  try {
    const value = (db as Record<string, unknown>)[name];
    return typeof value === "function" ? (value as (...args: never[]) => unknown) : undefined;
  } catch {
    return undefined;
  }
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function actLabelBudget(mode: DistillationMode): number | "all" {
  const preset = getDistillationPreset(mode);
  if (preset.id === "fast") return 80;
  if (preset.id === "deep" || preset.id === "celebrity") return "all";
  return 1500;
}

function pickUniform<T>(items: T[], count: number, rng: () => number): T[] {
  const copyItems = items.slice();
  const n = Math.min(Math.max(0, count), copyItems.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (copyItems.length - i));
    const swap = copyItems[i];
    copyItems[i] = copyItems[j] ?? swap;
    copyItems[j] = swap ?? copyItems[j];
  }
  return copyItems.slice(0, n);
}

function allocateProportional(sizes: number[], seats: number): number[] {
  const n = sizes.length;
  const out = Array.from({ length: n }, () => 0);
  if (n === 0 || seats <= 0) return out;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return out;
  const raw = sizes.map((size) => (size / total) * seats);
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(sizes[i] ?? 0, Math.floor(raw[i] ?? 0));
  }
  let used = out.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, i) => ({ i, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  while (used < seats) {
    let progressed = false;
    for (const { i } of order) {
      if (used >= seats) break;
      if ((out[i] ?? 0) < (sizes[i] ?? 0)) {
        out[i] = (out[i] ?? 0) + 1;
        used += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

function monthKey(at: Date | null, timeZone?: string | null): string {
  if (!at) return "unknown";
  return zonedDateKey(at, timeZone).slice(0, 7);
}

function sampleByMonth<T extends { at: Date | null }>(
  items: T[],
  budget: number,
  seed: string,
  timeZone?: string | null,
): T[] {
  if (items.length <= budget) return items;
  const layers = new Map<string, T[]>();
  for (const item of items) {
    const key = monthKey(item.at, timeZone);
    const list = layers.get(key) ?? [];
    list.push(item);
    layers.set(key, list);
  }
  const keys = [...layers.keys()].sort();
  const quotas = allocateProportional(
    keys.map((key) => layers.get(key)?.length ?? 0),
    budget,
  );
  const rng = seededRandom(seed);
  const out: T[] = [];
  const chosen = new Set<T>();
  for (let i = 0; i < keys.length; i++) {
    const layer = layers.get(keys[i] ?? "") ?? [];
    for (const pick of pickUniform(layer, quotas[i] ?? 0, rng)) {
      out.push(pick);
      chosen.add(pick);
    }
  }
  if (out.length < budget) {
    const rest = items.filter((item) => !chosen.has(item));
    out.push(...pickUniform(rest, budget - out.length, rng));
  }
  return out;
}

function firstTextOfTurn(turn: ActLabelRecord[], role: "assistant" | "user"): ActLabelRecord | null {
  return turn.find((row) => row.role === role && isTextRecord(row)) ?? null;
}

function lastTextOfTurn(turn: ActLabelRecord[], role: "assistant" | "user"): ActLabelRecord | null {
  const texts = turn.filter((row) => row.role === role && isTextRecord(row));
  return texts[texts.length - 1] ?? null;
}

function previousUserTurn(turns: ActLabelRecord[][], index: number): ActLabelRecord[] | null {
  for (let i = index - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.length) continue;
    if (turn[0]?.role === "assistant") return null;
    if (turn[0]?.role === "user") return turn;
  }
  return null;
}

function legend(locale: Locale): string {
  const taActs = SPEECH_ACTS.map((act) => `${act}: ${copy(locale, ACT_COPY_KEYS[act])}`).join("\n");
  const userActs = USER_ACTS.map((act) => `${act}: ${copy(locale, USER_ACT_COPY_KEYS[act])}`).join("\n");
  return copy(locale, "prompts.distill.labelActs", { taActs, userActs });
}

async function writeLabel(
  row: ActLabelRecord,
  act: string,
  source: "rule" | "model",
  userId: number,
  write: boolean,
): Promise<void> {
  row.act = act;
  row.actSource = source;
  if (!write) return;
  const update = dbFn("updateRecordLabels") as
    | ((id: number, userId: number, patch: { act: string; actSource: string }) => Promise<unknown>)
    | undefined;
  if (!update) return;
  await update(row.id, userId, { act, actSource: source });
}

interface UnlabelledPair {
  ta: ActLabelRecord;
  user: ActLabelRecord | null;
  at: Date | null;
}

async function loadRecords(
  personaId: number,
  userId: number,
  provided?: ActLabelRecord[],
): Promise<ActLabelRecord[]> {
  if (provided) return provided;
  const iterate = dbFn("iterateRecords") as
    | ((personaId: number, userId: number) => AsyncIterable<ActLabelRecord>)
    | undefined;
  if (!iterate) return [];
  const rows: ActLabelRecord[] = [];
  for await (const row of iterate(personaId, userId)) {
    rows.push(row);
  }
  return rows;
}

/**
 * Walks the record, labels each round, and writes the labels back.
 *
 * A rule that can decide does. The rest is asked of the model in
 * monthly samples, sixty pairs at a time. Rows that already have an
 * act are left alone, so a second run does not call the model again.
 */
export async function labelActsForRecords(params: {
  personaId: number;
  userId: number;
  mode: DistillationMode;
  locale?: Locale;
  timeZone?: string | null;
  records?: ActLabelRecord[];
  write?: boolean;
  invoke?: (messages: LLMMessage[]) => Promise<string>;
}): Promise<LabelActsResult> {
  const locale = params.locale ?? "zh";
  const write = params.write !== false;
  const rows = await loadRecords(params.personaId, params.userId, params.records);
  const turns = toTurns(rows);
  const unlabelled: UnlabelledPair[] = [];
  let labelled = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn?.length || turn[0]?.role !== "assistant") continue;
    const ta = firstTextOfTurn(turn, "assistant");
    if (!ta) continue;
    const userTurn = previousUserTurn(turns, i);
    const user = userTurn ? lastTextOfTurn(userTurn, "user") : null;

    if (isSpeechAct(ta.act)) {
      labelled += 1;
      continue;
    }

    const byRule = labelSpeechActByRule(ta.content, user?.content, { precisionOnly: true });
    if (byRule) {
      await writeLabel(ta, byRule, "rule", params.userId, write);
      labelled += 1;
      if (user && !isUserAct(user.act)) {
        const userRule = labelUserActByRule(user.content);
        if (userRule) await writeLabel(user, userRule, "rule", params.userId, write);
      }
      continue;
    }

    if (user && !isUserAct(user.act)) {
      const userRule = labelUserActByRule(user.content);
      if (userRule) await writeLabel(user, userRule, "rule", params.userId, write);
    }

    unlabelled.push({ ta, user, at: asDate(ta.timestamp) });
  }

  const budget = actLabelBudget(params.mode);
  const sample =
    budget === "all"
      ? unlabelled
      : sampleByMonth(
          unlabelled,
          budget,
          `act-label:${params.personaId}`,
          params.timeZone,
        );

  let calls = 0;
  let modelled = 0;
  const invoke = params.invoke;
  if (invoke && sample.length > 0) {
    const instruction = legend(locale);
    for (let offset = 0; offset < sample.length; offset += ACT_LABEL_BATCH) {
      const batch = sample.slice(offset, offset + ACT_LABEL_BATCH);
      const payload = batch.map((pair, index) => ({
        i: index,
        prev: (pair.user?.content ?? "").slice(0, 120),
        text: pair.ta.content.slice(0, 240),
      }));
      calls += 1;
      let answer = "";
      try {
        answer = await invoke([
          { role: "system", content: instruction },
          { role: "user", content: asMaterial(JSON.stringify(payload), locale) },
        ]);
      } catch {
        continue;
      }
      const parsed = extractJsonArray(answer);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const index = Number(record.i);
        if (!Number.isInteger(index)) continue;
        const pair = batch[index];
        if (!pair) continue;
        const act = record.act;
        if (isSpeechAct(act) && !isSpeechAct(pair.ta.act)) {
          await writeLabel(pair.ta, act, "model", params.userId, write);
          labelled += 1;
          modelled += 1;
        }
        const prevAct = record.prevAct;
        if (isUserAct(prevAct) && pair.user && !isUserAct(pair.user.act)) {
          await writeLabel(pair.user, prevAct, "model", params.userId, write);
        }
      }
    }
  }

  return { labelled, modelled, calls };
}

export type { SpeechAct, UserAct };
