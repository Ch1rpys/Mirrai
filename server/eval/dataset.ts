/**
 * The held-out cases.
 *
 * A persona is rebuilt from a conversation, and then the conversation is
 * handed to the rebuilt persona — but the answer was in there the whole
 * time, so the question was never really asked. The rebuild would sound
 * exactly like the original and the measurement would mean nothing.
 *
 * So one of their lines is taken away. The persona has to produce it
 * again, from the conversation that came before it, and the result is
 * compared with the line that was actually said.
 *
 * The cases are cut from the *collected* records — the imported chat
 * logs — rather than from the app's own conversation, because the app's
 * conversation was already written by the persona and would measure
 * nothing.
 */
import { matchEmotionTrigger, type EmotionTriggerState } from "@shared/emotion-triggers";
import { isTextRecord } from "@shared/records";
import { dayPartFromHour, type ActDayPart } from "@shared/act-profile";
import { isSpeechAct, labelSpeechActByRule, type SpeechAct } from "@shared/speech-acts";
import { FINGERPRINT_STATES } from "@shared/style-fingerprint";
import { zonedHour } from "@shared/timezone";
import { EVAL_MIN_ASSISTANT_LINES } from "@shared/eval-limits";
import type { Locale } from "@shared/copy";

export { EVAL_MIN_ASSISTANT_LINES };

/** A message as the records store it. */
export interface EvalSourceMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  timestamp: Date | null;
  kind?: string | null;
  emotion?: string | null;
  act?: string | null;
  actSource?: string | null;
}

export interface EvalPeriodRange {
  id: string;
  from: string;
  to: string;
}

/** One held-out exchange. */
export interface EvalCaseData {
  context: EvalSourceMessage[];
  expected: EvalSourceMessage;
  /** The emotion the real line carried. Prefers the labelled row, then trigger words. */
  expectedState: EmotionTriggerState | "warm" | null;
  /** The speech act of the held-out line. Cached; evaluation does not relabel. */
  expectedAct?: SpeechAct | null;
  expectedActSource?: "rule" | "model" | null;
  /** Which stretch of the record the held-out line sat in. */
  periodId?: string | null;
  /** Day or night in the persona's timezone when the line was said. */
  dayPart?: ActDayPart | null;
  /** `collected` from the records, `feedback` from an unlike rewrite. */
  source?: "collected" | "feedback" | string;
}

export interface EvalCaseOptions {
  /** How many messages of context the persona is given. */
  contextSize?: number;
  /** The most cases to keep. */
  maxCases?: number;
  /** Lines shorter than this are not worth holding out. */
  minExpectedChars?: number;
  /**
   * How much of the record may be held out.
   *
   * The n-gram model is fitted on the lines that were *not* held out, so
   * holding out too much leaves it with nothing to learn from — and a
   * model fitted on one line rates every other line as unlikely,
   * including the real one. So at most a quarter of their lines are
   * held out.
   */
  maxHoldoutFraction?: number;
  /**
   * How long a silence has to be before it counts as a different scene.
   *
   * A case whose context runs across a night is a case whose context is
   * half of one conversation and half of another, and the persona is
   * being asked to answer a prompt that never happened.
   */
  sceneBreakHours?: number;
  /**
   * The language the records are written in.
   *
   * The emotion is read off the words, so it is read in the language the
   * words are in. Without this, an English persona's held-out lines
   * carried no state at all — and every per-state bucket was empty.
   */
  locale?: Locale;
  /** Stretches of the record, from personaData.periods. */
  periods?: EvalPeriodRange[];
  /** The persona's timezone, for day vs night. */
  timezone?: string | null;
}

const KNOWN_STATES = new Set<string>(FINGERPRINT_STATES);

/**
 * How many lines to hold out when the caller did not ask for a number.
 *
 * Two percent of their lines, never fewer than twelve and never more
 * than sixty. The quarter-of-the-record ceiling still sits on top.
 */
export function defaultEvalMaxCases(assistantCount: number): number {
  return Math.min(60, Math.max(12, Math.floor(assistantCount * 0.02)));
}

/**
 * The lines before one message, stopping at a scene break.
 *
 * A window that runs across a long silence joins two conversations that
 * were not having one, and the persona is asked to answer a prompt that
 * never happened. So the window is cut where the silence is long enough
 * to be a different scene.
 */
function contextBefore(
  messages: EvalSourceMessage[],
  index: number,
  contextSize: number,
  sceneBreakMs: number,
): EvalSourceMessage[] {
  const start = Math.max(0, index - contextSize);
  const window = messages.slice(start, index);
  if (!window.length || !sceneBreakMs) return window;

  // Walk backwards while the messages are close enough in time.
  let cut = 0;
  for (let i = window.length - 1; i > 0; i--) {
    const later = window[i].timestamp;
    const earlier = window[i - 1].timestamp;
    if (!later || !earlier) continue;
    if (later.getTime() - earlier.getTime() > sceneBreakMs) {
      cut = i;
      break;
    }
  }
  return cut ? window.slice(cut) : window;
}

function periodIdAt(at: Date | null, periods: EvalPeriodRange[]): string | null {
  if (!at || !periods.length) return null;
  const time = at.getTime();
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const from = Date.parse(period.from);
    const to = Date.parse(period.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const last = i === periods.length - 1;
    if (time >= from && (last ? time <= to : time < to)) return period.id;
  }
  return null;
}

function labelledState(value: string | null | undefined): EmotionTriggerState | "warm" | null {
  if (!value || !KNOWN_STATES.has(value)) return null;
  return value as EmotionTriggerState | "warm";
}

function dayPartOf(at: Date | null, timezone: string | null | undefined): ActDayPart | null {
  if (!at) return null;
  return dayPartFromHour(zonedHour(at, timezone));
}

function layerKey(periodId: string | null, emotion: string | null, dayPart: string | null): string {
  return `${periodId ?? "?"}|${emotion ?? "?"}|${dayPart ?? "?"}`;
}

function pickEven<T>(items: T[], n: number): T[] {
  if (n <= 0 || items.length === 0) return [];
  if (n >= items.length) return items;
  if (n === 1) return [items[Math.floor((items.length - 1) / 2)]!];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  }
  return out;
}

function allocateLayerQuotas(sizes: Map<string, number>, maxCases: number): Map<string, number> {
  const keys = [...sizes.keys()];
  const quotas = new Map<string, number>();
  if (!keys.length || maxCases <= 0) return quotas;
  if (keys.length >= maxCases) {
    const ranked = keys
      .map((key) => ({ key, n: sizes.get(key) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    for (const row of ranked.slice(0, maxCases)) quotas.set(row.key, 1);
    return quotas;
  }
  for (const key of keys) quotas.set(key, 1);
  let remaining = maxCases - keys.length;
  const total = keys.reduce((sum, key) => sum + (sizes.get(key) ?? 0), 0);
  const extras = keys.map((key) => {
    const share = total === 0 ? 0 : remaining * ((sizes.get(key) ?? 0) / total);
    return { key, floor: Math.floor(share), frac: share - Math.floor(share) };
  });
  for (const extra of extras) quotas.set(extra.key, 1 + extra.floor);
  remaining -= extras.reduce((sum, extra) => sum + extra.floor, 0);
  extras.sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key));
  for (let i = 0; remaining > 0 && i < extras.length; i++) {
    quotas.set(extras[i]!.key, (quotas.get(extras[i]!.key) ?? 0) + 1);
    remaining -= 1;
  }
  let leftover = 0;
  for (const key of keys) {
    const cap = sizes.get(key) ?? 0;
    const quota = quotas.get(key) ?? 0;
    if (quota > cap) {
      leftover += quota - cap;
      quotas.set(key, cap);
    }
  }
  while (leftover > 0) {
    const room = keys
      .map((key) => ({ key, room: (sizes.get(key) ?? 0) - (quotas.get(key) ?? 0) }))
      .filter((row) => row.room > 0)
      .sort((a, b) => b.room - a.room || a.key.localeCompare(b.key));
    if (!room.length) break;
    quotas.set(room[0]!.key, (quotas.get(room[0]!.key) ?? 0) + 1);
    leftover -= 1;
  }
  return quotas;
}

function pickStratified(candidates: EvalCaseData[], maxCases: number): EvalCaseData[] {
  if (candidates.length <= maxCases) return candidates;
  const layers = new Map<string, EvalCaseData[]>();
  for (const item of candidates) {
    const key = layerKey(item.periodId ?? null, item.expectedState ?? null, item.dayPart ?? null);
    const list = layers.get(key) ?? [];
    list.push(item);
    layers.set(key, list);
  }
  // There is no room to give every layer one line. Spread across the
  // whole conversation instead, the way the ruler used to.
  if (layers.size > maxCases) return pickEven(candidates, maxCases);
  const sizes = new Map<string, number>();
  for (const [key, list] of layers) sizes.set(key, list.length);
  const quotas = allocateLayerQuotas(sizes, maxCases);
  const picked: EvalCaseData[] = [];
  for (const [key, list] of layers) {
    const n = quotas.get(key) ?? 0;
    if (n <= 0) continue;
    picked.push(...pickEven(list, n));
  }
  picked.sort((a, b) => {
    const aTime = a.expected.timestamp?.getTime() ?? 0;
    const bTime = b.expected.timestamp?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return (a.expected.id ?? 0) - (b.expected.id ?? 0);
  });
  return picked;
}

/**
 * Cuts the cases out of a conversation.
 *
 * The cases are spread across the conversation rather than taken from
 * the front. A conversation has a shape — the early messages are
 * tentative, the middle ones are the ordinary middle, the last ones are
 * the goodbyes — and a set of cases drawn from only one part of it
 * measures that part and nothing else.
 *
 * When the record has periods, labelled moods, and times, the spread is
 * by those layers first, then even inside each layer.
 */
export function buildEvalCases(
  messages: EvalSourceMessage[],
  options: EvalCaseOptions = {},
): EvalCaseData[] {
  const contextSize = Math.max(1, options.contextSize ?? 6);
  const minExpectedChars = Math.max(1, options.minExpectedChars ?? 2);
  const locale = options.locale ?? "zh";
  const sceneBreakMs = (options.sceneBreakHours ?? 6) * 3_600_000;
  const periods = options.periods ?? [];

  const assistantCount = messages.filter((m) => m.role === "assistant" && isTextRecord(m)).length;
  // A conversation with a single one of their lines leaves nothing to
  // measure against and nothing to learn the person's habits from.
  if (assistantCount < EVAL_MIN_ASSISTANT_LINES) return [];

  // At least one of their lines has to stay behind. The n-gram model is
  // fitted on the rest, and a model fitted on nothing would rate every
  // line as unlikely — including the real one.
  // At most a quarter of their lines are held out, so the n-gram model
  // always has the rest to learn from. At least one of their lines
  // always stays behind, for the same reason.
  const fraction = options.maxHoldoutFraction ?? 0.25;
  const holdoutCeiling = Math.max(
    1,
    Math.floor(assistantCount * Math.max(0, Math.min(1, fraction))),
  );
  const requested =
    options.maxCases === undefined ? defaultEvalMaxCases(assistantCount) : options.maxCases;
  const maxCases = Math.min(
    Math.max(1, requested),
    holdoutCeiling,
    assistantCount - 1,
  );

  const candidates: EvalCaseData[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (!isTextRecord(message)) continue;
    if (!message.content || message.content.trim().length < minExpectedChars) continue;

    // The context is cut at a scene break: a stretch of silence long
    // enough that the two halves are no longer the same conversation.
    const window = contextBefore(messages, i, contextSize, sceneBreakMs);
    // A context with no user message in it is not a conversation the
    // persona can answer; holding out the reply would only measure how
    // well it continues a monologue.
    if (!window.some((m) => m.role === "user")) continue;

    const previousUser = [...window].reverse().find((m) => m.role === "user")?.content ?? null;
    const labelledAct = message.act && isSpeechAct(message.act) ? message.act : null;
    const expectedAct = labelledAct ?? labelSpeechActByRule(message.content, previousUser);
    const periodId = periodIdAt(message.timestamp, periods);
    const expectedState =
      labelledState(message.emotion) ?? matchEmotionTrigger(message.content, locale);
    candidates.push({
      context: window,
      expected: message,
      expectedState,
      expectedAct,
      expectedActSource: labelledAct
        ? message.actSource === "model"
          ? "model"
          : "rule"
        : expectedAct
          ? "rule"
          : null,
      periodId,
      dayPart: dayPartOf(message.timestamp, options.timezone),
    });
  }

  return pickStratified(candidates, maxCases);
}

/**
 * Held-out cases from unlike marks that already have a rewrite.
 *
 * The expected line is what they would have said, not the generated
 * line that was marked. These cases do not count against the hold-out
 * ceiling — they are extra questions, not a cut of the record.
 */
export function buildFeedbackEvalCases(
  messages: EvalSourceMessage[],
  pairs: Array<{ messageId: number; rewrite: string }>,
  options: { contextSize?: number; sceneBreakHours?: number } = {},
): EvalCaseData[] {
  const contextSize = Math.max(1, options.contextSize ?? 6);
  const sceneBreakMs = (options.sceneBreakHours ?? 6) * 3_600_000;
  const indexOf = new Map<number, number>();
  for (let i = 0; i < messages.length; i++) {
    const id = messages[i]?.id;
    if (typeof id === "number") indexOf.set(id, i);
  }
  const seen = new Set<number>();
  const out: EvalCaseData[] = [];
  for (const pair of pairs) {
    const rewrite = pair.rewrite.replace(/\s+/g, " ").trim();
    if (!rewrite) continue;
    if (seen.has(pair.messageId)) continue;
    seen.add(pair.messageId);
    const index = indexOf.get(pair.messageId);
    if (index === undefined) continue;
    const marked = messages[index];
    if (!marked) continue;
    const window = contextBefore(messages, index, contextSize, sceneBreakMs);
    if (!window.some((item) => item.role === "user")) continue;
    const previousUser = [...window].reverse().find((item) => item.role === "user")?.content ?? null;
    out.push({
      context: window,
      expected: {
        role: "assistant",
        content: rewrite,
        timestamp: marked.timestamp,
      },
      expectedState: labelledState(marked.emotion),
      expectedAct: labelSpeechActByRule(rewrite, previousUser),
      expectedActSource: "rule",
      source: "feedback",
    });
  }
  return out;
}

/**
 * The cases that are already stored, read back.
 *
 * The stored cases are the *标答* — the held-out lines the persona has to
 * produce. A run that cut a fresh set every time would measure a
 * different question each time, and the comparison with the last run
 * would be between two different things.
 *
 * So the stored ones are what gets measured. They are read defensively:
 * they were written by an earlier version of this code, and a row that
 * cannot be read is a row that is skipped rather than a crash.
 */
export function casesFromRows(
  rows: Array<{
    contextJson: unknown;
    expectedJson: unknown;
    expectedState?: string | null;
    expectedAct?: string | null;
    expectedActSource?: string | null;
    periodId?: string | null;
    source?: string | null;
  }>,
): EvalCaseData[] {
  const out: EvalCaseData[] = [];
  for (const row of rows) {
    const expected = toMessage(row.expectedJson);
    if (!expected) continue;
    const context = Array.isArray(row.contextJson)
      ? row.contextJson.map(toMessage).filter((m): m is EvalSourceMessage => m !== null)
      : [];
    if (!context.length) continue;
    const previousUser = [...context].reverse().find((m) => m.role === "user")?.content ?? null;
    const storedAct = row.expectedAct && isSpeechAct(row.expectedAct) ? row.expectedAct : null;
    out.push({
      context,
      expected,
      expectedState: labelledState(row.expectedState),
      expectedAct: storedAct ?? labelSpeechActByRule(expected.content, previousUser),
      expectedActSource: (row.expectedActSource as EvalCaseData["expectedActSource"]) ?? (storedAct ? "rule" : null),
      periodId: typeof row.periodId === "string" && row.periodId ? row.periodId : null,
      dayPart: null,
      source: row.source === "feedback" ? "feedback" : row.source || "collected",
    });
  }
  return out;
}

/** One stored message, read back. */
function toMessage(value: unknown): EvalSourceMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : "";
  if (!content) return null;
  const role = record.role === "assistant" ? "assistant" : "user";
  const timestamp =
    record.timestamp instanceof Date
      ? record.timestamp
      : typeof record.timestamp === "string"
        ? new Date(record.timestamp)
        : null;
  return {
    id: typeof record.id === "number" ? record.id : undefined,
    role,
    content,
    timestamp: timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : null,
    kind: typeof record.kind === "string" ? record.kind : undefined,
    emotion: typeof record.emotion === "string" ? record.emotion : undefined,
    act: typeof record.act === "string" ? record.act : undefined,
    actSource: typeof record.actSource === "string" ? record.actSource : undefined,
  };
}

/**
 * The texts the n-gram model is fitted on.
 *
 * Every message *except* the held-out ones. A model that had seen the
 * answer would rate it as likely and rate anything else as unlikely,
 * and the measurement would be measuring the model, not the persona.
 */
export function trainingTexts(
  messages: EvalSourceMessage[],
  cases: EvalCaseData[],
): string[] {
  const heldOut = new Set(cases.map((c) => c.expected.content));
  return messages
    .filter((m) => m.role === "assistant" && isTextRecord(m) && !heldOut.has(m.content))
    .map((m) => m.content)
    .filter((text) => text.trim().length > 0);
}

/**
 * A short description of a case, for a human reading the report.
 */
export function describeCase(caseData: EvalCaseData): string {
  const last = caseData.context[caseData.context.length - 1];
  const from = last ? last.content.slice(0, 40) : "";
  return `…${from} → ${caseData.expected.content.slice(0, 40)}`;
}
