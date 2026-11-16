/**
 * Labelling their replies with a speech act, once, during distillation.
 *
 * A rule that can decide does. The rest is asked of the model once and
 * cached on the persona and on the evaluation case. Chat turns do not
 * relabel.
 */
import { llmService } from "../llm";
import { resolveProviderForUser } from "../llm/user-provider";
import { extractJsonArray } from "../_core/json";
import {
  SPEECH_ACTS,
  isSpeechAct,
  labelSpeechActByRule,
  type SpeechAct,
} from "@shared/speech-acts";
import { isTextRecord } from "@shared/records";
import {
  ACT_MIN_SAMPLES,
  dayPartFromHour,
  incrementCount,
  type ActBucket,
  type ActCounts,
  type ActProfile,
  emptyCounts,
} from "@shared/act-profile";
import { zonedHour } from "@shared/timezone";
import { copy, type Locale } from "@shared/copy";
import { asMaterial } from "../_core/material";

export interface ActLabelInput {
  id?: number;
  content: string;
  timestamp?: Date | string | null;
  previousUser?: string | null;
  emotionalState?: string | null;
  relationshipPhase?: string | null;
}

export interface ActLabel {
  act: SpeechAct;
  source: "rule" | "model";
  evidence: string;
}

export function labelAct(input: ActLabelInput): ActLabel | { act: null; source: "none"; evidence: string } {
  const byRule = labelSpeechActByRule(input.content, input.previousUser);
  if (byRule) {
    return { act: byRule, source: "rule", evidence: input.content.slice(0, 200) };
  }
  return { act: null, source: "none", evidence: input.content.slice(0, 200) };
}

async function labelWithModel(params: {
  unlabeled: ActLabelInput[];
  userId: number;
  locale: Locale;
}): Promise<Map<string, SpeechAct>> {
  const out = new Map<string, SpeechAct>();
  if (!params.unlabeled.length) return out;
  const provider = await resolveProviderForUser({ userId: params.userId }).catch(() => null);
  if (!provider) return out;
  const payload = params.unlabeled.slice(0, 80).map((row, index) => ({
    i: index,
    text: row.content.slice(0, 240),
    prev: (row.previousUser ?? "").slice(0, 120),
  }));
  const acts = SPEECH_ACTS.join(", ");
  try {
    const answer = await llmService.invokeWithProvider(provider, {
      messages: [
        {
          role: "system",
          content: copy(params.locale, "prompt.actHeading") + "\n" + acts,
        },
        {
          role: "user",
          content: asMaterial(JSON.stringify(payload)),
        },
      ],
      options: { temperature: 0, maxTokens: 1200 },
    });
    const parsed = extractJsonArray(typeof answer === "string" ? answer : "");
    if (!Array.isArray(parsed)) return out;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const index = Number(record.i);
      const act = record.act;
      if (!Number.isInteger(index) || !isSpeechAct(act)) continue;
      const row = params.unlabeled[index];
      if (row) out.set(row.content, act);
    }
  } catch (error) {
    console.warn("[Acts] The model could not label:", (error as Error).message);
  }
  return out;
}

export async function buildActProfile(params: {
  messages: Array<{
    role: string;
    content: string;
    timestamp?: Date | string | null;
    kind?: string | null;
  }>;
  userId: number;
  locale?: Locale;
  timezone?: string | null;
  relationshipPhase?: string | null;
  emotionalState?: string | null;
}): Promise<ActProfile | null> {
  const locale = params.locale ?? "zh";
  const theirs: ActLabelInput[] = [];
  let previousUser: string | null = null;
  for (const row of params.messages) {
    if (!isTextRecord(row)) continue;
    if (row.role === "user") {
      previousUser = row.content;
      continue;
    }
    if (row.role !== "assistant") continue;
    theirs.push({
      content: row.content,
      timestamp: row.timestamp,
      previousUser,
      emotionalState: params.emotionalState ?? "warm",
      relationshipPhase: params.relationshipPhase ?? "initial",
    });
  }
  if (theirs.length < ACT_MIN_SAMPLES) return null;

  const unlabeled = theirs.filter((row) => !labelSpeechActByRule(row.content, row.previousUser));
  const modelled = await labelWithModel({ unlabeled, userId: params.userId, locale });

  const unconditional: ActCounts = emptyCounts();
  const bucketMap = new Map<string, ActBucket>();

  for (const row of theirs) {
    const labelled = labelSpeechActByRule(row.content, row.previousUser)
      ?? modelled.get(row.content);
    if (!labelled) continue;
    Object.assign(unconditional, incrementCount(unconditional, labelled));
    const at = row.timestamp ? new Date(row.timestamp) : null;
    const hour = at && !Number.isNaN(at.getTime()) ? zonedHour(at, params.timezone) : 12;
    const key = [
      Boolean(row.previousUser && /[?？]$/.test(row.previousUser)) ? "ask" : "say",
      row.emotionalState ?? "warm",
      dayPartFromHour(hour),
      row.relationshipPhase ?? "initial",
    ].join("|");
    const existing = bucketMap.get(key) ?? {
      asking: Boolean(row.previousUser && /[?？]$/.test(row.previousUser)),
      emotion: row.emotionalState ?? "warm",
      dayPart: dayPartFromHour(hour),
      relationshipPhase: row.relationshipPhase ?? "initial",
      counts: emptyCounts(),
      samples: 0,
    };
    existing.counts = incrementCount(existing.counts, labelled);
    existing.samples += 1;
    bucketMap.set(key, existing);
  }

  const samples = Object.values(unconditional).reduce((a, b) => a + (b ?? 0), 0);
  if (samples < ACT_MIN_SAMPLES) return null;

  const buckets = [...bucketMap.values()].map((bucket) => (
    bucket.samples >= 8 ? bucket : { ...bucket, fallback: true as const }
  ));

  return {
    samples,
    unconditional,
    buckets,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Labels lines that a rule could not decide, once, and returns both
 * the rule hits and the model hits. Evaluation stores the result on
 * the case so a later run does not ask again.
 */
export async function labelMissingActs(params: {
  items: Array<{ key: string; content: string; previousUser?: string | null }>;
  userId: number;
  locale?: Locale;
}): Promise<Map<string, { act: SpeechAct; source: "rule" | "model" }>> {
  const out = new Map<string, { act: SpeechAct; source: "rule" | "model" }>();
  const unlabeled: typeof params.items = [];
  for (const item of params.items) {
    const byRule = labelSpeechActByRule(item.content, item.previousUser);
    if (byRule) out.set(item.key, { act: byRule, source: "rule" });
    else unlabeled.push(item);
  }
  if (!unlabeled.length) return out;
  const modelled = await labelWithModel({
    unlabeled: unlabeled.map((item) => ({
      content: item.content,
      previousUser: item.previousUser,
    })),
    userId: params.userId,
    locale: params.locale ?? "zh",
  });
  for (const item of unlabeled) {
    const act = modelled.get(item.content);
    if (act) out.set(item.key, { act, source: "model" });
  }
  return out;
}
