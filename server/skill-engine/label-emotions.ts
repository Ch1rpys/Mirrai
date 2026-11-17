/**
 * Labels each scene of the record with an emotional state, once.
 *
 * Distillation used to put every act-profile bucket in "warm" because
 * no emotion was ever written on a row. The walk here decides a scene
 * from the trigger words when they are enough, asks a model for the
 * rest, and writes the state onto every line they said in that scene.
 * A scene nobody can decide is left empty — never defaulted.
 */
import { extractJsonArray } from "../_core/json";
import { isEmotionalState, type EmotionalState } from "../_core/emotion";
import { copy, type Locale } from "@shared/copy";
import { getDistillationPreset, type DistillationMode } from "@shared/distillation-modes";
import { matchEmotionTrigger } from "@shared/emotion-triggers";
import { isTextRecord } from "@shared/records";
import { splitScenes } from "@shared/scenes";
import type { LLMMessage } from "../llm/types";
import { asMaterial } from "./material";
import { sampleByMonth } from "./label-acts";
import * as db from "../db";

export const EMOTION_LABEL_BATCH = 25;
const SCENE_TA_LINES = 12;
const SCENE_USER_LINES = 6;
const SCENE_MAX_CHARS = 600;

export interface EmotionLabelRecord {
  id: number;
  role: string;
  content: string;
  timestamp?: Date | string | null;
  kind?: string | null;
  speaker?: string | null;
  emotion?: string | null;
  emotionSource?: string | null;
}

export interface LabelEmotionsResult {
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

function emotionBudget(mode: DistillationMode): number | "all" | 0 {
  const preset = getDistillationPreset(mode);
  if (preset.id === "fast") return 0;
  if (preset.id === "deep" || preset.id === "celebrity") return "all";
  return 600;
}

function decideByRule(scene: EmotionLabelRecord[], locale: Locale): EmotionalState | null {
  const hits = new Map<string, number>();
  let n = 0;
  for (const row of scene) {
    if (row.role !== "assistant" || !isTextRecord(row)) continue;
    const state = matchEmotionTrigger(row.content, locale === "en" ? "en" : "zh");
    if (!state) continue;
    hits.set(state, (hits.get(state) ?? 0) + 1);
    n += 1;
  }
  if (n < 2) return null;
  let best: string | null = null;
  let bestCount = 0;
  let ties = 0;
  for (const [state, count] of hits) {
    if (count > bestCount) {
      best = state;
      bestCount = count;
      ties = 1;
    } else if (count === bestCount) {
      ties += 1;
    }
  }
  if (!best || ties !== 1 || bestCount < 2) return null;
  return isEmotionalState(best) ? best : null;
}

function sceneAlreadyLabeled(scene: EmotionLabelRecord[]): boolean {
  return scene.some((row) => row.role === "assistant" && Boolean(row.emotion?.trim()));
}

function renderScene(scene: EmotionLabelRecord[]): string {
  const ta = scene.filter((row) => row.role === "assistant" && isTextRecord(row)).slice(0, SCENE_TA_LINES);
  const user = scene.filter((row) => row.role === "user" && isTextRecord(row)).slice(0, SCENE_USER_LINES);
  const allowed = new Set([...ta, ...user]);
  const lines: string[] = [];
  let chars = 0;
  for (const row of scene) {
    if (!allowed.has(row)) continue;
    const who = row.role === "assistant" ? "them" : "me";
    const line = `${who}: ${row.content}`;
    if (chars + line.length > SCENE_MAX_CHARS) break;
    lines.push(line);
    chars += line.length + 1;
  }
  return lines.join("\n");
}

async function writeEmotion(
  row: EmotionLabelRecord,
  state: EmotionalState,
  source: "rule" | "model",
  userId: number,
  write: boolean,
): Promise<void> {
  row.emotion = state;
  row.emotionSource = source;
  if (!write) return;
  const update = dbFn("updateRecordLabels") as
    | ((id: number, userId: number, patch: { emotion: string; emotionSource: string }) => Promise<unknown>)
    | undefined;
  if (!update) return;
  await update(row.id, userId, { emotion: state, emotionSource: source });
}

async function writeScene(
  scene: EmotionLabelRecord[],
  state: EmotionalState,
  source: "rule" | "model",
  userId: number,
  write: boolean,
): Promise<number> {
  let n = 0;
  for (const row of scene) {
    if (row.role !== "assistant") continue;
    await writeEmotion(row, state, source, userId, write);
    n += 1;
  }
  return n;
}

async function loadRecords(
  personaId: number,
  userId: number,
  provided?: EmotionLabelRecord[],
): Promise<EmotionLabelRecord[]> {
  if (provided) return provided;
  const iterate = dbFn("iterateRecords") as
    | ((personaId: number, userId: number) => AsyncIterable<EmotionLabelRecord>)
    | undefined;
  if (!iterate) return [];
  const rows: EmotionLabelRecord[] = [];
  for await (const row of iterate(personaId, userId)) {
    rows.push(row);
  }
  return rows;
}

/**
 * Walks the record scene by scene and writes an emotion on their lines.
 *
 * A rule that can decide does. The rest is asked of the model in
 * monthly samples, twenty-five scenes at a time, except the fast
 * preset which never calls. Scenes that already have an emotion are
 * left alone.
 */
export async function labelEmotionsForRecords(params: {
  personaId: number;
  userId: number;
  mode: DistillationMode;
  locale?: Locale;
  timeZone?: string | null;
  records?: EmotionLabelRecord[];
  write?: boolean;
  invoke?: (messages: LLMMessage[]) => Promise<string>;
}): Promise<LabelEmotionsResult> {
  const locale = params.locale ?? "zh";
  const write = params.write !== false;
  const rows = await loadRecords(params.personaId, params.userId, params.records);
  const scenes = splitScenes(rows);
  const unlabelled: Array<{ scene: EmotionLabelRecord[]; at: Date | null }> = [];
  let labelled = 0;

  for (const scene of scenes) {
    if (sceneAlreadyLabeled(scene)) {
      labelled += scene.filter((row) => row.role === "assistant" && row.emotion).length;
      continue;
    }
    const byRule = decideByRule(scene, locale);
    if (byRule) {
      labelled += await writeScene(scene, byRule, "rule", params.userId, write);
      continue;
    }
    unlabelled.push({ scene, at: asDate(scene.find((row) => asDate(row.timestamp))?.timestamp) });
  }

  const budget = emotionBudget(params.mode);
  const sample =
    budget === 0
      ? []
      : budget === "all"
        ? unlabelled
        : sampleByMonth(unlabelled, budget, `emotion-label:${params.personaId}`, params.timeZone);

  let calls = 0;
  let modelled = 0;
  const invoke = params.invoke;
  if (invoke && sample.length > 0) {
    const instruction = copy(locale, "prompts.distill.labelEmotions");
    for (let offset = 0; offset < sample.length; offset += EMOTION_LABEL_BATCH) {
      const batch = sample.slice(offset, offset + EMOTION_LABEL_BATCH);
      const payload = batch.map((item, index) => ({
        i: index,
        text: renderScene(item.scene),
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
        if (!pair || sceneAlreadyLabeled(pair.scene)) continue;
        const state = record.state;
        if (!isEmotionalState(state)) continue;
        const wrote = await writeScene(pair.scene, state, "model", params.userId, write);
        labelled += wrote;
        modelled += wrote;
      }
    }
  }

  return { labelled, modelled, calls };
}
