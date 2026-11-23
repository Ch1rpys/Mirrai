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
  isUserAct,
  labelSpeechActByRule,
  type SpeechAct,
  type UserAct,
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
      usage: { userId: params.userId },
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
      // The reply is a JSON array of labels (C9.4): ask for JSON natively
      // where the provider can, and keep the tolerant parser otherwise.
      options: { temperature: 0, maxTokens: 1200, purpose: "extract", responseFormat: "json" },
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
    act?: string | null;
    emotion?: string | null;
  }>;
  userId: number;
  locale?: Locale;
  timezone?: string | null;
  relationshipPhase?: string | null;
  emotionalState?: string | null;
  /**
   * The upload-only path, which has no `collected_messages` rows to
   * label and write back.
   *
   * B1.1 says that path keeps its old behaviour. It therefore uses the
   * old labeler here (rules plus one model call for up to eighty
   * unlabelled replies) and the old `warm` bucket, instead of reading
   * labels that were never written.
   */
  legacy?: boolean;
}): Promise<ActProfile | null> {
  const theirs: Array<{
    act: SpeechAct | null;
    content: string;
    timestamp?: Date | string | null;
    previousUser: string | null;
    previousUserAct: UserAct | null;
    emotion?: string;
    relationshipPhase?: string | null;
  }> = [];
  let previousUser: string | null = null;
  let previousUserAct: UserAct | null = null;
  for (const row of params.messages) {
    if (!isTextRecord(row)) continue;
    if (row.role === "user") {
      previousUser = row.content;
      previousUserAct = isUserAct(row.act) ? row.act : null;
      continue;
    }
    if (row.role !== "assistant") continue;
    if (!params.legacy && !isSpeechAct(row.act)) continue;
    theirs.push({
      act: isSpeechAct(row.act) ? row.act : null,
      content: row.content,
      timestamp: row.timestamp,
      previousUser,
      previousUserAct,
      emotion: params.legacy
        ? (row.emotion?.trim() || "warm")
        : (row.emotion?.trim() || undefined),
      relationshipPhase: params.relationshipPhase ?? "initial",
    });
  }
  if (theirs.length < ACT_MIN_SAMPLES) return null;

  if (params.legacy) {
    const unlabeled = theirs.filter(
      (row) => !labelSpeechActByRule(row.content, row.previousUser),
    );
    const modelled = await labelWithModel({
      unlabeled: unlabeled.map((row) => ({
        content: row.content,
        previousUser: row.previousUser,
      })),
      userId: params.userId,
      locale: params.locale ?? "zh",
    });
    for (const row of theirs) {
      if (row.act) continue;
      row.act = labelSpeechActByRule(row.content, row.previousUser)
        ?? modelled.get(row.content)
        ?? null;
    }
  }

  const unconditional: ActCounts = emptyCounts();
  const bucketMap = new Map<string, ActBucket>();
  const byUserActMap = new Map<UserAct, ActCounts>();
  const byUserActEmotionMap = new Map<string, {
    userAct: UserAct;
    emotion: string;
    counts: ActCounts;
    samples: number;
  }>();

  for (const row of theirs) {
    if (!row.act) continue;
    Object.assign(unconditional, incrementCount(unconditional, row.act));
    if (row.previousUserAct) {
      const current = byUserActMap.get(row.previousUserAct) ?? {};
      byUserActMap.set(row.previousUserAct, incrementCount(current, row.act));
      if (row.emotion) {
        const key = `${row.previousUserAct}|${row.emotion}`;
        const existing = byUserActEmotionMap.get(key) ?? {
          userAct: row.previousUserAct,
          emotion: row.emotion,
          counts: {},
          samples: 0,
        };
        existing.counts = incrementCount(existing.counts, row.act);
        existing.samples += 1;
        byUserActEmotionMap.set(key, existing);
      }
    }
    const at = row.timestamp ? new Date(row.timestamp) : null;
    const hour = at && !Number.isNaN(at.getTime()) ? zonedHour(at, params.timezone) : 12;
    const asking = Boolean(row.previousUser && /[?？]$/.test(row.previousUser));
    const emotion = row.emotion || undefined;
    const key = [
      asking ? "ask" : "say",
      emotion ?? "",
      dayPartFromHour(hour),
      row.relationshipPhase ?? "initial",
    ].join("|");
    const existing = bucketMap.get(key) ?? {
      asking,
      ...(emotion ? { emotion } : {}),
      dayPart: dayPartFromHour(hour),
      relationshipPhase: row.relationshipPhase ?? "initial",
      counts: emptyCounts(),
      samples: 0,
    };
    existing.counts = incrementCount(existing.counts, row.act);
    existing.samples += 1;
    bucketMap.set(key, existing);
  }

  const samples = Object.values(unconditional).reduce((a, b) => a + (b ?? 0), 0);
  if (samples < ACT_MIN_SAMPLES) return null;

  const buckets = [...bucketMap.values()].map((bucket) => (
    bucket.samples >= 8 ? bucket : { ...bucket, fallback: true as const }
  ));

  const byUserAct = Object.fromEntries(byUserActMap) as Partial<Record<UserAct, ActCounts>>;
  const byUserActEmotion = [...byUserActEmotionMap.values()];
  return {
    samples,
    unconditional,
    buckets,
    ...(byUserActMap.size > 0 ? { byUserAct } : {}),
    ...(byUserActEmotion.length > 0 ? { byUserActEmotion } : {}),
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
