/**
 * Recurring windows read off what they used to say.
 *
 * "刚下课" at 16:05 on a Wednesday, week after week, is a class that
 * ran 14:00–16:00. The row stays a candidate until the user confirms
 * it — the records are old, and they may not still live that way.
 */
import { copy, type Locale } from "@shared/copy";
import {
  normalizeLifeEvents,
  type LifeEvent,
  type LifeEventEvidence,
} from "@shared/life-events";
import { recordText } from "@shared/records";
import { isoWeekKey, zonedHour, zonedWeekday } from "@shared/timezone";

export const ROUTINE_MIN_WEEKS = 4;

export type RoutineActivity =
  | "class"
  | "work"
  | "overtime"
  | "meeting"
  | "duty"
  | "gym"
  | "training"
  | "piano"
  | "study";

type CueSide = "start" | "end";

interface Cue {
  pattern: string;
  activity: RoutineActivity;
  side: CueSide;
  latin: boolean;
}

// i18n:allow-input — words in the records that name a recurring activity
const CUES: Cue[] = [
  { pattern: "after class", activity: "class", side: "end", latin: true },
  { pattern: "off work", activity: "work", side: "end", latin: true },
  { pattern: "on duty", activity: "duty", side: "start", latin: true },
  { pattern: "study hall", activity: "study", side: "start", latin: true },
  { pattern: "overtime", activity: "overtime", side: "start", latin: true },
  { pattern: "meeting", activity: "meeting", side: "start", latin: true },
  { pattern: "training", activity: "training", side: "start", latin: true },
  { pattern: "class", activity: "class", side: "start", latin: true },
  { pattern: "gym", activity: "gym", side: "start", latin: true },
  { pattern: "piano", activity: "piano", side: "start", latin: true },
  { pattern: "work", activity: "work", side: "start", latin: true },
  { pattern: "上自习", activity: "study", side: "start", latin: false },
  { pattern: "下课", activity: "class", side: "end", latin: false },
  { pattern: "上课", activity: "class", side: "start", latin: false },
  { pattern: "下班", activity: "work", side: "end", latin: false },
  { pattern: "上班", activity: "work", side: "start", latin: false },
  { pattern: "加班", activity: "overtime", side: "start", latin: false },
  { pattern: "开会", activity: "meeting", side: "start", latin: false },
  { pattern: "值班", activity: "duty", side: "start", latin: false },
  { pattern: "健身", activity: "gym", side: "start", latin: false },
  { pattern: "训练", activity: "training", side: "start", latin: false },
  { pattern: "练琴", activity: "piano", side: "start", latin: false },
];

export interface RoutineRow {
  role?: string | null;
  content?: string | null;
  kind?: string | null;
  meta?: Record<string, unknown> | null;
  timestamp?: Date | string | null;
}

function mod24(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function hoursFor(side: CueSide, hour: number): number[] {
  if (side === "end") return [mod24(hour - 2), mod24(hour - 1)];
  return [hour, mod24(hour + 1)];
}

function matchCue(text: string): Cue | null {
  const lower = text.toLowerCase();
  for (const cue of CUES) {
    if (cue.latin) {
      const escaped = cue.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(lower)) return cue;
    } else if (text.includes(cue.pattern)) {
      return cue;
    }
  }
  return null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function slotKey(startHour: number): "lateNight" | "morning" | "noon" | "afternoon" | "evening" | "night" {
  if (startHour < 6) return "lateNight";
  if (startHour < 12) return "morning";
  if (startHour < 14) return "noon";
  if (startHour < 18) return "afternoon";
  if (startHour < 22) return "evening";
  return "night";
}

function titleFor(
  weekday: number,
  startHour: number,
  activity: RoutineActivity,
  locale: Locale,
): string {
  const day = copy(locale, `labels.routine.weekday.${weekday}` as "labels.routine.weekday.3");
  const slot = copy(locale, `labels.routine.slot.${slotKey(startHour)}` as "labels.routine.slot.afternoon");
  const act = copy(locale, `labels.routine.activity.${activity}` as "labels.routine.activity.class");
  return locale === "zh" ? `${day}${slot}${act}` : `${day} ${slot} ${act}`;
}

function idFor(activity: RoutineActivity, weekday: number, startHour: number, endHour: number): string {
  return `auto-routine-${activity}-${weekday}-${startHour}-${endHour}`;
}

function mergeRanges(hours: number[]): Array<{ startHour: number; endHour: number; hours: number[] }> {
  if (!hours.length) return [];
  const sorted = [...hours].sort((a, b) => a - b);
  const ranges: Array<{ startHour: number; endHour: number; hours: number[] }> = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  const bucket = [sorted[0]!];
  for (const hour of sorted.slice(1)) {
    if (hour === prev + 1) {
      bucket.push(hour);
      prev = hour;
      continue;
    }
    ranges.push({ startHour: start, endHour: prev + 1, hours: [...bucket] });
    start = hour;
    prev = hour;
    bucket.length = 0;
    bucket.push(hour);
  }
  ranges.push({ startHour: start, endHour: prev + 1, hours: [...bucket] });
  return ranges;
}

/**
 * Fold TA's talk of class, work, and the rest into candidate windows.
 *
 * A start word covers the two hours after it. An end word covers the
 * two hours before. Adjacent hours on the same weekday merge. Four
 * distinct weeks is the floor — three is still a coincidence.
 */
export function mineRoutines(
  rows: RoutineRow[],
  personaTimeZone?: string | null,
  options: { locale?: Locale; minWeeks?: number } = {},
): LifeEvent[] {
  const locale = options.locale ?? "zh";
  const minWeeks = options.minWeeks ?? ROUTINE_MIN_WEEKS;
  type Hit = { weeks: Set<string>; evidence: LifeEventEvidence[] };
  const hits = new Map<string, Hit>();

  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const text = recordText({
      kind: row.kind,
      content: String(row.content ?? ""),
      meta: row.meta ?? null,
    }).trim();
    if (!text) continue;
    const cue = matchCue(text);
    if (!cue) continue;
    const at = toDate(row.timestamp);
    if (!at) continue;
    const hour = zonedHour(at, personaTimeZone);
    const weekday = zonedWeekday(at, personaTimeZone);
    const week = isoWeekKey(at, personaTimeZone);
    const evidence: LifeEventEvidence = { snippet: text.slice(0, 400), at: at.toISOString() };
    for (const covered of hoursFor(cue.side, hour)) {
      const key = `${cue.activity}:${weekday}:${covered}`;
      const bucket = hits.get(key) ?? { weeks: new Set<string>(), evidence: [] };
      bucket.weeks.add(week);
      if (bucket.evidence.length < 6) bucket.evidence.push(evidence);
      hits.set(key, bucket);
    }
  }

  const grouped = new Map<string, Map<number, Hit>>();
  for (const [key, hit] of hits) {
    const [activity, weekdayRaw, hourRaw] = key.split(":");
    const weekday = Number(weekdayRaw);
    const hour = Number(hourRaw);
    const groupKey = `${activity}:${weekday}`;
    const hours = grouped.get(groupKey) ?? new Map<number, Hit>();
    hours.set(hour, hit);
    grouped.set(groupKey, hours);
  }

  const out: LifeEvent[] = [];
  for (const [groupKey, hourMap] of grouped) {
    const colon = groupKey.lastIndexOf(":");
    const activity = groupKey.slice(0, colon) as RoutineActivity;
    const weekday = Number(groupKey.slice(colon + 1));
    for (const range of mergeRanges([...hourMap.keys()])) {
      const weeks = new Set<string>();
      const evidence: LifeEventEvidence[] = [];
      const seenSnippet = new Set<string>();
      for (const hour of range.hours) {
        const hit = hourMap.get(hour);
        if (!hit) continue;
        for (const week of hit.weeks) weeks.add(week);
        for (const row of hit.evidence) {
          if (seenSnippet.has(row.snippet)) continue;
          seenSnippet.add(row.snippet);
          evidence.push(row);
        }
      }
      if (weeks.size < minWeeks) continue;
      const startHour = range.startHour;
      const endHour = Math.min(24, range.endHour);
      if (endHour <= startHour) continue;
      out.push({
        id: idFor(activity, weekday, startHour, endHour),
        kind: "routine",
        title: titleFor(weekday, startHour, activity, locale),
        detail: "",
        whoSaid: "them",
        closed: false,
        source: "auto",
        verified: false,
        evidence: evidence.slice(0, 3),
        schedule: { weekdays: [weekday], startHour, endHour },
      });
    }
  }
  out.sort((a, b) => (b.evidence.length - a.evidence.length) || a.title.localeCompare(b.title));
  return normalizeLifeEvents(out);
}
