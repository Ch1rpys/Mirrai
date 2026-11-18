/**
 * What they like, dislike, fear, care about, or hold as an opinion.
 *
 * Distillation writes one card per claim. This module folds those
 * cards by topic and polarity, and keeps the row out of the prompt
 * until the user says it is real — and even then, only on the turn
 * that mentions the topic.
 */
import { copy, type Locale } from "./copy";

export const STANCE_MIN_EVIDENCE = 2;
export const STANCE_PROMPT_CAP = 4;
export const STANCE_TOPIC_MAX = 80;
export const STANCE_STATEMENT_MAX = 240;
export const STANCE_POLARITIES = ["like", "dislike", "fear", "care", "opinion"] as const;

export type StancePolarity = (typeof STANCE_POLARITIES)[number];

export interface StanceEvidence {
  at?: string;
  snippet: string;
}

export interface Stance {
  id: string;
  topic: string;
  polarity: StancePolarity;
  statement: string;
  evidence: StanceEvidence[];
  source: "auto" | "manual";
  verified: boolean;
}

export interface StanceCard {
  claim?: string | null;
  payload?: unknown;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function toPolarity(value: unknown): StancePolarity | null {
  return STANCE_POLARITIES.includes(value as StancePolarity)
    ? (value as StancePolarity)
    : null;
}

function toEvidence(value: unknown): StanceEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: StanceEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const snippet = toText(record.snippet);
    if (!snippet) continue;
    const at = toText(record.at);
    out.push(at ? { at, snippet } : { snippet });
  }
  return out;
}

function idFor(topic: string, polarity: StancePolarity): string {
  const key = `${topic}:${polarity}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `auto-stance-${Math.abs(hash).toString(36)}`;
}

export function stanceRejectedKey(topic: string, polarity: StancePolarity): string {
  return `stance:${topic}:${polarity}`;
}

function payloadField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") return "";
  return toText((payload as Record<string, unknown>)[key]);
}

function modeOf(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let n = -1;
  for (const [value, count] of counts) {
    if (count > n || (count === n && value < best)) {
      best = value;
      n = count;
    }
  }
  return best;
}

export function normalizeStances(value: unknown): Stance[] {
  if (!Array.isArray(value)) return [];
  const out: Stance[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const topic = toText(record.topic).slice(0, STANCE_TOPIC_MAX);
    const polarity = toPolarity(record.polarity);
    const statement = toText(record.statement).slice(0, STANCE_STATEMENT_MAX);
    if (!topic || !polarity || !statement) return;
    const key = `${topic}:${polarity}`;
    if (seen.has(key)) return;
    seen.add(key);
    const source = record.source === "manual" ? "manual" : "auto";
    out.push({
      id: toText(record.id) || `stance-${index + 1}`,
      topic,
      polarity,
      statement,
      evidence: toEvidence(record.evidence),
      source,
      verified: record.verified === true,
    });
  });
  return out;
}

/**
 * Fold stance-cards into one row per topic and polarity.
 *
 * A single mention is noise. Two quoted lines is a stance they
 * actually hold. Like and dislike of the same topic both stay, so
 * the user can pick.
 */
export function aggregateStances(cards: StanceCard[]): Stance[] {
  const groups = new Map<string, StanceCard[]>();
  for (const card of cards) {
    const topic = payloadField(card.payload, "topic").slice(0, STANCE_TOPIC_MAX);
    const polarity = toPolarity(payloadField(card.payload, "polarity"));
    if (!topic || !polarity) continue;
    const key = `${topic}:${polarity}`;
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }
  const stances: Stance[] = [];
  for (const [key, group] of groups) {
    const evidence = group
      .map((card) => {
        const snippet = toText(card.claim) || payloadField(card.payload, "topic");
        return snippet ? { snippet } : null;
      })
      .filter((row): row is StanceEvidence => Boolean(row));
    if (evidence.length < STANCE_MIN_EVIDENCE) continue;
    const colon = key.lastIndexOf(":");
    const topic = key.slice(0, colon);
    const polarity = key.slice(colon + 1) as StancePolarity;
    const statement = (
      modeOf(group.map((card) => toText(card.claim))) || evidence[0]!.snippet
    ).slice(0, STANCE_STATEMENT_MAX);
    stances.push({
      id: idFor(topic, polarity),
      topic,
      polarity,
      statement,
      evidence: evidence.slice(0, 6),
      source: "auto",
      verified: false,
    });
  }
  stances.sort((a, b) => b.evidence.length - a.evidence.length || a.topic.localeCompare(b.topic));
  return stances;
}

export function mergeStances(
  previous: unknown,
  mined: unknown,
  rejectedKeys: string[] = [],
): Stance[] {
  const confirmed = normalizeStances(previous).filter((row) => row.verified);
  const confirmedKeys = new Set(confirmed.map((row) => `${row.topic}:${row.polarity}`));
  const rejected = new Set(rejectedKeys);
  const fresh = normalizeStances(mined).filter((row) => {
    if (confirmedKeys.has(`${row.topic}:${row.polarity}`)) return false;
    if (rejected.has(stanceRejectedKey(row.topic, row.polarity))) return false;
    return true;
  });
  return [...confirmed, ...fresh];
}

export function mentionedStances(
  stances: Stance[],
  texts: string[],
  cap = STANCE_PROMPT_CAP,
): Stance[] {
  const hits = stances.filter((row) => {
    if (!row.verified) return false;
    return texts.some((text) => Boolean(row.topic) && text.includes(row.topic));
  });
  return hits.slice(0, cap);
}

export function renderStancesSection(stances: Stance[], locale: Locale = "zh"): string {
  if (!stances.length) return "";
  return [copy(locale, "prompt.stancesHeading"), ...stances.map((row) => row.statement)].join("\n");
}
