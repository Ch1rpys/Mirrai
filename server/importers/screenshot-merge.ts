/**
 * Turning the JSON a vision model read off some screenshots into rows
 * a person can correct (B7.11).
 *
 * Three things are decided here, and only here:
 *
 *   - a time bar applies to the messages after it, one second apart;
 *   - a batch with no time bar gets the date the user chose, from noon,
 *     one minute apart, and is marked as approximate;
 *   - the seam between two screenshots keeps an overlapping message
 *     once, not twice.
 *
 * Left is the other person, right is the user.
 */
import { parseZoneless } from "@shared/timezone";
import { isRecordKind, type RecordKind } from "@shared/records";

export interface ScreenshotMessage {
  side: "left" | "right" | "center";
  text: string;
  kind?: string;
  /** The words on a time bar, when the model read one. */
  time?: string;
  unclear?: boolean;
}

export interface MergedScreenshotRow {
  role: "user" | "assistant";
  content: string;
  kind: RecordKind;
  at: Date | null;
  /** True when the time came from the date the user chose, not a time bar. */
  timeApprox: boolean;
  unclear: boolean;
  page: number;
}

const SIDES = new Set(["left", "right", "center"]);

function asSide(value: unknown): ScreenshotMessage["side"] | null {
  return typeof value === "string" && SIDES.has(value)
    ? (value as ScreenshotMessage["side"])
    : null;
}

/**
 * Reads a time bar.
 *
 * The forms a phone's chat app draws: a full date and clock, a clock
 * alone, and a Chinese half of the day in front of it. The year is the
 * one from the date the user gave; a time bar has no year.
 */
// i18n:allow-input — a time bar is Chinese in Chinese chat apps; these
// words are matched against what the screenshot says.
export function parseTimeBar(
  text: string,
  date: string | null | undefined,
  timeZone?: string | null,
): Date | null {
  const cleaned = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const day = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

  const full = cleaned.match(
    /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(?:[^\d]{0,4})?(\d{1,2}):(\d{2})/,
  );
  if (full) {
    const [, year, month, dayOfMonth, hour, minute] = full;
    return parseZoneless(
      `${year}-${pad(month!)}-${pad(dayOfMonth!)} ${pad(hour!)}:${minute}:00`,
      timeZone,
    );
  }

  const yesterday = /昨天/.test(cleaned);
  const clock = cleaned.match(/(上午|中午|下午|晚上|凌晨)?\s*(\d{1,2}):(\d{2})/);
  if (!clock) return null;
  let base = day;
  if (yesterday && day) {
    const shifted = new Date(`${day}T12:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    base = shifted.toISOString().slice(0, 10);
  }
  if (!base) return null;

  let hour = Number(clock[2]);
  const half = clock[1] ?? "";
  if ((half === "下午" || half === "晚上") && hour < 12) hour += 12;
  if (half === "中午" && hour < 11) hour += 12;
  if ((half === "上午" || half === "凌晨") && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return parseZoneless(`${base} ${pad(String(hour))}:${clock[3]}:00`, timeZone);
}

function pad(value: string): string {
  return value.padStart(2, "0");
}

/** How a non-text message is stored in the record table. */
export function contentForKind(kind: RecordKind, text: string): string {
  const value = String(text ?? "").trim();
  switch (kind) {
    case "text":
    case "system":
      return value;
    case "sticker":
      return `[sticker:${value || "?"}]`;
    case "image":
      return "[image]";
    case "voice":
      return "[voice:0]";
    case "video":
      return "[video:0]";
    case "location":
      return value ? `[location:${value}]` : "[location]";
    case "link":
      return value ? `[link:${value}]` : "[link]";
    case "music":
      return value ? `[music:${value}]` : "[music]";
    case "transfer":
      return value ? `[transfer:${value}]` : "[transfer]";
    case "file":
      return value ? `[file:${value}]` : "[file]";
    case "call":
      return "[call:voice:0]";
    case "redpacket":
      return "[redpacket]";
    case "pat":
      return "[pat]";
    case "recall":
      return "[recall]";
    default:
      return value;
  }
}

function keyOf(message: ScreenshotMessage): string {
  return `${message.side}\u0000${String(message.text ?? "").trim()}`;
}

/**
 * Drops the part of a screenshot the previous one already showed.
 *
 * The two screenshot makers do not agree on where they overlap; the
 * longest suffix of the previous page that is the prefix of the next
 * is the part that is the same message twice.
 */
export function dedupeSeam(
  previous: ScreenshotMessage[],
  next: ScreenshotMessage[],
): ScreenshotMessage[] {
  const limit = Math.min(previous.length, next.length);
  for (let size = limit; size > 0; size -= 1) {
    const tail = previous.slice(previous.length - size).map(keyOf);
    const head = next.slice(0, size).map(keyOf);
    if (tail.every((key, index) => key === head[index])) {
      return next.slice(size);
    }
  }
  return next;
}

function flattenPages(pages: ScreenshotMessage[][]): Array<{ message: ScreenshotMessage; page: number }> {
  const out: Array<{ message: ScreenshotMessage; page: number }> = [];
  let previous: ScreenshotMessage[] = [];
  for (const [page, messages] of pages.entries()) {
    const deduped = page === 0 ? messages : dedupeSeam(previous, messages);
    for (const message of deduped) out.push({ message, page });
    previous = messages;
  }
  return out;
}

export function mergeScreenshotPages(
  pages: ScreenshotMessage[][],
  options: { date?: string | null; timeZone?: string | null } = {},
): { rows: MergedScreenshotRow[]; timeApprox: boolean; needsDate: boolean } {
  const flattened = flattenPages(pages);
  const date = typeof options.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ? options.date
    : null;

  let clock: Date | null = null;
  let hasTimeBar = false;
  for (const { message } of flattened) {
    if (asSide(message.side) !== "center") continue;
    if (parseTimeBar(message.time ?? message.text, date, options.timeZone)) {
      hasTimeBar = true;
      break;
    }
  }

  const rows: MergedScreenshotRow[] = [];
  if (hasTimeBar) {
    let seconds = 0;
    for (const { message, page } of flattened) {
      const side = asSide(message.side);
      if (!side) continue;
      if (side === "center") {
        const parsed = parseTimeBar(message.time ?? message.text, date, options.timeZone);
        if (parsed) {
          clock = parsed;
          seconds = 0;
        }
        continue;
      }
      const kind = message.kind && isRecordKind(message.kind) ? message.kind : "text";
      const at = clock ? new Date(clock.getTime() + seconds * 1000) : null;
      seconds += 1;
      rows.push({
        role: side === "left" ? "assistant" : "user",
        content: contentForKind(kind, message.text),
        kind,
        at,
        timeApprox: false,
        unclear: message.unclear === true,
        page,
      });
    }
    return { rows, timeApprox: false, needsDate: false };
  }

  const base = date ? parseZoneless(`${date} 12:00:00`, options.timeZone) : null;
  if (!base) {
    for (const { message, page } of flattened) {
      const side = asSide(message.side);
      if (!side || side === "center") continue;
      const kind = message.kind && isRecordKind(message.kind) ? message.kind : "text";
      rows.push({
        role: side === "left" ? "assistant" : "user",
        content: contentForKind(kind, message.text),
        kind,
        at: null,
        timeApprox: false,
        unclear: message.unclear === true,
        page,
      });
    }
    return { rows, timeApprox: false, needsDate: rows.length > 0 };
  }

  for (const [index, { message, page }] of flattened.entries()) {
    const side = asSide(message.side);
    if (!side || side === "center") continue;
    const kind = message.kind && isRecordKind(message.kind) ? message.kind : "text";
    rows.push({
      role: side === "left" ? "assistant" : "user",
      content: contentForKind(kind, message.text),
      kind,
      at: new Date(base.getTime() + index * 60_000),
      timeApprox: true,
      unclear: message.unclear === true,
      page,
    });
  }
  return { rows, timeApprox: true, needsDate: false };
}

