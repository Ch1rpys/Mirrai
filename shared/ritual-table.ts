/**
 * Short, almost-fixed replies: 晚安, 早, 在吗.
 *
 * When the other person answered the same short line the same way
 * often enough, the generator can pick one of those lines instead of
 * calling the model.
 */
import { isTextRecord } from "./records";
import { splitScenes, toTurns } from "./scenes";
import { PARTICLES } from "./style-fingerprint";

export const RITUAL_MIN_COUNT = 12;
export const RITUAL_MIN_COVERAGE = 0.7;
export const RITUAL_MAX_TRIGGER_CHARS = 6;
export const RITUAL_MAX_REPLY_CHARS = 12;
export const RITUAL_MAX_REPLIES = 6;

export interface RitualReply {
  text: string;
  n: number;
  recordId: number;
}

export interface RitualEntry {
  trigger: string;
  variants: string[];
  n: number;
  replies: RitualReply[];
  coverage: number;
  manual?: boolean;
}

export type RitualTurnLine = {
  role: string;
  content: string;
  id?: number;
  kind?: string | null;
  speaker?: string | null;
  timestamp?: Date | string | null;
};

export type RitualTurn = RitualTurnLine[];

const PARTICLE_SET = new Set<string>(PARTICLES);
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const SPACE_WAVE_RE = /[\s~～〜]+/g;
const PUNCT_RE = /\p{P}/gu;

export function normalizeTrigger(text: string): string {
  let value = text.trim().toLowerCase();
  value = value.replace(EMOJI_RE, "");
  value = value.replace(SPACE_WAVE_RE, "");
  value = value.replace(PUNCT_RE, "");
  let next = value;
  do {
    value = next;
    for (const particle of PARTICLE_SET) {
      if (value.endsWith(particle) && value.length > particle.length) {
        next = value.slice(0, -particle.length);
        break;
      }
    }
  } while (next !== value);
  return value;
}

function textBubbles(turn: RitualTurn): RitualTurnLine[] {
  return turn.filter((row) => isTextRecord(row) && row.content.trim());
}

export function turnsFromRecords(records: RitualTurnLine[]): RitualTurn[] {
  return splitScenes(records).flatMap((scene) => toTurns(scene));
}

export function mineRituals(turns: RitualTurn[]): RitualEntry[] {
  type Bucket = {
    variants: Map<string, number>;
    replies: Map<string, { n: number; recordId: number }>;
  };
  const buckets = new Map<string, Bucket>();
  for (let i = 0; i < turns.length - 1; i++) {
    const user = textBubbles(turns[i]);
    const them = textBubbles(turns[i + 1]);
    if (turns[i][0]?.role !== "user" || turns[i + 1][0]?.role !== "assistant") continue;
    if (user.length !== 1 || them.length !== 1) continue;
    const rawUser = user[0].content.trim();
    const rawThem = them[0].content.trim();
    if (!rawUser || !rawThem) continue;
    if (rawThem.length > RITUAL_MAX_REPLY_CHARS) continue;
    const trigger = normalizeTrigger(rawUser);
    if (!trigger || trigger.length > RITUAL_MAX_TRIGGER_CHARS) continue;
    let bucket = buckets.get(trigger);
    if (!bucket) {
      bucket = { variants: new Map(), replies: new Map() };
      buckets.set(trigger, bucket);
    }
    bucket.variants.set(rawUser, (bucket.variants.get(rawUser) ?? 0) + 1);
    const reply = bucket.replies.get(rawThem);
    const recordId = them[0].id ?? 0;
    if (reply) reply.n += 1;
    else bucket.replies.set(rawThem, { n: 1, recordId });
  }

  const out: RitualEntry[] = [];
  for (const [trigger, bucket] of buckets) {
    const replies = [...bucket.replies.entries()]
      .map(([text, row]) => ({ text, n: row.n, recordId: row.recordId }))
      .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, "zh"));
    const n = replies.reduce((sum, row) => sum + row.n, 0);
    if (n < RITUAL_MIN_COUNT) continue;
    const topThree = replies.slice(0, 3).reduce((sum, row) => sum + row.n, 0);
    const coverage = n > 0 ? topThree / n : 0;
    if (coverage < RITUAL_MIN_COVERAGE) continue;
    const variants = [...bucket.variants.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([text]) => text);
    out.push({
      trigger,
      variants,
      n,
      replies: replies.slice(0, RITUAL_MAX_REPLIES),
      coverage,
    });
  }
  out.sort((a, b) => b.n - a.n || a.trigger.localeCompare(b.trigger, "zh"));
  return out;
}

export function matchRitual(userMessage: string, rituals: RitualEntry[]): RitualEntry | null {
  const trigger = normalizeTrigger(userMessage);
  if (!trigger) return null;
  return rituals.find((entry) => entry.trigger === trigger) ?? null;
}

export function sampleRitualReply(
  entry: RitualEntry,
  rng: () => number,
  isAllowed: (text: string) => boolean,
): RitualReply | null {
  const allowed = entry.replies.filter((row) => isAllowed(row.text));
  const total = allowed.reduce((sum, row) => sum + row.n, 0);
  if (total <= 0) return null;
  let pick = rng() * total;
  for (const row of allowed) {
    pick -= row.n;
    if (pick < 0) return row;
  }
  return allowed[allowed.length - 1] ?? null;
}

export function mergeManualRituals(
  mined: RitualEntry[],
  previous: RitualEntry[] | null | undefined,
): RitualEntry[] {
  const manuals = (previous ?? []).filter((entry) => entry.manual);
  if (manuals.length === 0) return mined;
  const used = new Set(mined.map((entry) => entry.trigger));
  const kept = manuals.filter((entry) => !used.has(entry.trigger));
  return [...mined, ...kept];
}

export function normalizeRituals(value: unknown): RitualEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RitualEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const cue = typeof row.cue === "string" ? row.cue.trim() : "";
    const triggerRaw = typeof row.trigger === "string" ? row.trigger.trim() : cue;
    const trigger = triggerRaw ? normalizeTrigger(triggerRaw) || triggerRaw : "";
    if (!trigger) continue;
    const variants = Array.isArray(row.variants)
      ? row.variants.filter((text): text is string => typeof text === "string" && text.trim().length > 0)
      : cue
        ? [cue]
        : [triggerRaw];
    const replies: RitualReply[] = [];
    if (Array.isArray(row.replies)) {
      for (const reply of row.replies) {
        if (!reply || typeof reply !== "object") continue;
        const r = reply as Record<string, unknown>;
        if (typeof r.text !== "string" || !r.text.trim()) continue;
        replies.push({
          text: r.text,
          n: Math.max(0, Math.round(Number(r.n) || 0)),
          recordId: Number.isInteger(r.recordId) ? Number(r.recordId) : 0,
        });
      }
    } else if (typeof row.reply === "string" && row.reply.trim()) {
      replies.push({ text: row.reply.trim(), n: 1, recordId: 0 });
    }
    const n = replies.length > 0
      ? replies.reduce((sum, item) => sum + item.n, 0)
      : Math.max(0, Math.round(Number(row.n) || 0));
    out.push({
      trigger,
      variants: variants.length > 0 ? variants : [triggerRaw],
      n: n || Math.max(0, Math.round(Number(row.n) || 0)),
      replies,
      coverage: Number.isFinite(Number(row.coverage)) ? Number(row.coverage) : replies.length > 0 ? 1 : 0,
      ...(row.manual ? { manual: true } : {}),
    });
  }
  return out;
}
