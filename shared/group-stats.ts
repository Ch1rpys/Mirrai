/**
 * How a persona speaks in a group chat (C9.8).
 *
 * A group is a different room from a one-to-one chat: the persona is not
 * the only one answering, so *when* they step in matters as much as how
 * long they talk. This measurement reads only the rows that came from a
 * group export (`meta.register = "group"`), so it never learns anything
 * about the one-to-one voice.
 *
 * The definitions, all computed over the text messages in array order
 * (timestamps are irrelevant — the import already sorted the rows):
 *
 *   - `samples` — how many text lines the persona said in the group.
 *   - `afterMeRate` — for each line the user said that has at least one
 *     later message, did the persona answer within the next up-to-3
 *     messages. Hits ÷ such user lines. No such lines → 0.
 *   - `afterOthersRate` — the same for the other people in the group.
 *   - `lengthMedian` — median code-point length of the persona's lines.
 *   - `gapMedianMessages` — for each pair of consecutive persona lines,
 *     how many other messages sit between them; median of those counts.
 *     Fewer than two persona lines → 0.
 *
 * Non-text rows (stickers, images, voice notes) and empty lines are not
 * messages for this measurement: they neither count as a persona line
 * nor as somebody else's line, and they do not fill a turn window.
 *
 * Fewer than forty persona lines and there is no measurement at all —
 * the same rule the other measurements follow: no default to fill the
 * gap with.
 */

/** Forty lines in the group before the measurement is worth having. */
export const GROUP_MIN_SAMPLES = 40;

/** A reply counts as "joining in" within this many following messages. */
export const GROUP_FOLLOW_WINDOW = 3;

export interface GroupRow {
  role?: string | null;
  content?: string | null;
  kind?: string | null;
  /** The import order is the order; a timestamp is not read. */
  timestamp?: Date | string | null;
}

export interface GroupStats {
  /** The persona's text lines in the group. */
  samples: number;
  /** After one of mine, how often the persona speaks within 3 messages. */
  afterMeRate: number;
  /** The same after one of the other members. */
  afterOthersRate: number;
  /** Median code-point length of the persona's lines. */
  lengthMedian: number;
  /** Median count of other messages between two of the persona's lines. */
  gapMedianMessages: number;
}

type MessageRole = "assistant" | "user" | "other" | "unknown";

interface GroupMessage {
  role: MessageRole;
  /** Code-point length, so a surrogate pair counts as one character. */
  length: number;
}

function roleOf(row: GroupRow): MessageRole {
  if (row.role === "assistant") return "assistant";
  if (row.role === "user") return "user";
  if (row.role === "other") return "other";
  return "unknown";
}

function isTextRow(row: GroupRow): boolean {
  return (row.kind ?? "text") === "text";
}

/** The messages this measurement can see, in array order. */
function messagesOf(rows: ReadonlyArray<GroupRow>): GroupMessage[] {
  const messages: GroupMessage[] = [];
  for (const row of rows) {
    if (!isTextRow(row)) continue;
    const content = typeof row.content === "string" ? row.content : "";
    if (content.trim().length === 0) continue;
    messages.push({ role: roleOf(row), length: Array.from(content).length });
  }
  return messages;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * How often the persona joins in after a given speaker.
 *
 * Only lines that have at least one later message can be answered, so
 * the last line of the log is not part of the denominator.
 */
function followRate(messages: GroupMessage[], speaker: "user" | "other"): number {
  let chances = 0;
  let hits = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]!.role !== speaker) continue;
    const window = messages.slice(index + 1, index + 1 + GROUP_FOLLOW_WINDOW);
    if (window.length === 0) continue;
    chances += 1;
    if (window.some((message) => message.role === "assistant")) hits += 1;
  }
  return chances === 0 ? 0 : hits / chances;
}

export function measureGroup(rows: ReadonlyArray<GroupRow>): GroupStats | null {
  const messages = messagesOf(rows);
  const spoken: number[] = [];
  const spokenAt: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    spoken.push(message.length);
    spokenAt.push(index);
  }
  if (spoken.length < GROUP_MIN_SAMPLES) return null;

  const gaps: number[] = [];
  for (let index = 1; index < spokenAt.length; index += 1) {
    gaps.push(spokenAt[index]! - spokenAt[index - 1]! - 1);
  }

  return {
    samples: spoken.length,
    afterMeRate: followRate(messages, "user"),
    afterOthersRate: followRate(messages, "other"),
    lengthMedian: median(spoken),
    gapMedianMessages: median(gaps),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function clampRate(value: unknown): number {
  const n = asNumber(value);
  if (n == null) return 0;
  return Math.min(1, Math.max(0, n));
}

function nonNegative(value: unknown): number {
  const n = asNumber(value);
  return n != null && n >= 0 ? n : 0;
}

/**
 * Reads a stored `styleProfile.group` back.
 *
 * The shape is small enough to repair rather than reject: the counts are
 * coerced and the two rates clamped into 0..1. What it does not repair is
 * a missing or empty sample count — that is not a measurement, and the
 * field is left absent rather than filled with zeroes.
 */
export function normalizeGroupStats(value: unknown): GroupStats | null {
  if (!isPlainObject(value)) return null;
  const samples = asNumber(value.samples);
  const count = samples == null ? 0 : Math.floor(samples);
  if (count < 1) return null;
  return {
    samples: count,
    afterMeRate: clampRate(value.afterMeRate),
    afterOthersRate: clampRate(value.afterOthersRate),
    lengthMedian: nonNegative(value.lengthMedian),
    gapMedianMessages: nonNegative(value.gapMedianMessages),
  };
}
