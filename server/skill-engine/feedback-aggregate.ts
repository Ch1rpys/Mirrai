/**
 * Turns "this didn't sound like them" into candidates the editor can
 * confirm or refuse.
 *
 * word / ask / complete become subtraction candidates.
 * act becomes a manual correction on the action counts.
 * invented becomes a memory-conflict note.
 * mood / timing are shown and not turned into a rule.
 *
 * A key the user has already refused is not offered again.
 */
import type { FeedbackReason } from "@shared/speech-acts";
import { isSpeechAct, type SpeechAct } from "@shared/speech-acts";
import type { Suppression } from "@shared/suppressions";
import { normalizeSuppressions } from "@shared/suppressions";
import { copy, type Locale } from "@shared/copy";
import { factKeyFromTitle } from "../chat/memory-extract";

export interface FeedbackRow {
  id: number;
  messageId: number;
  reason: string;
  createdAt?: Date | string | null;
}

export interface FeedbackCandidate {
  key: string;
  reason: FeedbackReason;
  messageId: number;
  kind: "suppression" | "act" | "memory" | "display";
  suppression?: Suppression;
  snippet?: string;
  sampledAct?: SpeechAct | null;
}

const SUPPRESSION_FOR: Partial<Record<FeedbackReason, Suppression["kind"]>> = {
  word: "no_word_class",
  ask: "no_question_ending",
  complete: "no_phrase",
};

export function confirmedSuppressionFromUnlike(params: {
  key: string;
  reason: FeedbackReason;
  snippet: string;
}): Suppression | null {
  const kind = SUPPRESSION_FOR[params.reason];
  if (!kind) return null;
  const snippet = params.snippet.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!snippet) return null;
  return normalizeSuppressions([
    {
      id: `feedback-${params.key}`,
      pattern: snippet.slice(0, 80),
      kind,
      confidence: 1,
      source: "manual",
      verified: true,
      evidence: [{ snippet }],
    },
  ])[0] ?? null;
}

export function inventedMemoryDraft(snippet: string, locale: Locale = "zh"): {
  title: string;
  description: string;
  factKey: string;
} {
  const description = snippet.replace(/\s+/g, " ").trim().slice(0, 2000);
  const title = description.slice(0, 80) || copy(locale, "labels.inventedMemoryTitle");
  return { title, description: description || title, factKey: factKeyFromTitle(title) };
}

export function sampledActFromMetadata(metadata: unknown): SpeechAct | null {
  if (!metadata || typeof metadata !== "object") return null;
  const sampled = (metadata as { sampledAct?: unknown }).sampledAct;
  return isSpeechAct(sampled) ? sampled : null;
}

export function feedbackKey(row: FeedbackRow): string {
  return `${row.reason}:${row.messageId}`;
}

export function aggregateFidelityFeedback(params: {
  rows: FeedbackRow[];
  rejectedKeys?: string[];
}): FeedbackCandidate[] {
  const rejected = new Set(params.rejectedKeys ?? []);
  const out: FeedbackCandidate[] = [];
  const seen = new Set<string>();
  for (const row of params.rows) {
    const reason = row.reason as FeedbackReason;
    const key = feedbackKey(row);
    if (rejected.has(key) || seen.has(key)) continue;
    seen.add(key);
    const suppressionKind = SUPPRESSION_FOR[reason];
    if (suppressionKind) {
      const suppression = normalizeSuppressions([
        {
          id: `feedback-${key}`,
          pattern: `message:${row.messageId}`,
          kind: suppressionKind,
          confidence: 0.5,
          source: "auto",
          verified: false,
          evidence: [{ snippet: `message:${row.messageId}` }],
        },
      ])[0];
      out.push({
        key,
        reason,
        messageId: row.messageId,
        kind: "suppression",
        suppression,
      });
      continue;
    }
    if (reason === "act") {
      out.push({ key, reason, messageId: row.messageId, kind: "act" });
      continue;
    }
    if (reason === "invented") {
      out.push({ key, reason, messageId: row.messageId, kind: "memory" });
      continue;
    }
    out.push({ key, reason, messageId: row.messageId, kind: "display" });
  }
  return out;
}
