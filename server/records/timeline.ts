/**
 * The relationship's electrocardiogram (C2.5)
 *
 * Six curves, one point a week. A turning point is where one of them
 * moves more than half again the spread of the two windows around it.
 * It only says a number moved; why it moved is the user's to know.
 */
import { isoWeekKey, zonedDateKey } from "@shared/timezone";
import { splitScenes, toTurns } from "@shared/scenes";
import { isTextRecord } from "@shared/records";
import * as db from "../db";

export const TIMELINE_SERIES = [
  "total",
  "myShare",
  "replyMedianSec",
  "charsMedian",
  "startsMeShare",
  "negativeShare",
] as const;
export type TimelineSeriesId = (typeof TIMELINE_SERIES)[number];

export interface WeeklyPoint {
  week: string;
  total: number;
  myShare: number;
  replyMedianSec: number | null;
  charsMedian: number | null;
  startsMeShare: number;
  negativeShare: number | null;
}

export interface TurningChange {
  series: TimelineSeriesId;
  before: number;
  after: number;
}

export interface TurningPoint {
  /** The week the change is dated to. */
  id: string;
  at: string;
  /** The first day of that week, for a jump into the reader. */
  weekStart?: string;
  changes: TurningChange[];
  status: "auto" | "confirmed" | "rejected";
  note?: string;
}

export interface TimelineRow {
  id: number;
  role: string;
  content: string;
  kind: string;
  timestamp: Date | null;
  createdAt: Date;
  /** The B1.5 label, on the record's own column. */
  emotion?: string | null;
  meta?: unknown;
}

function atOf(row: TimelineRow): Date {
  return row.timestamp ?? row.createdAt;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : Math.round(sorted[middle]);
}

function negativeScene(rows: TimelineRow[]): boolean {
  const labels = rows
    .filter((row) => row.role === "assistant" && isTextRecord(row))
    .map((row) => row.emotion)
    .filter((state): state is string => typeof state === "string");
  if (labels.length === 0) return false;
  const bad = labels.filter((state) => state === "distant" || state === "melancholy").length;
  return bad * 2 > labels.length;
}

export function weeklySeries(
  rows: TimelineRow[],
  timeZone?: string | null,
): WeeklyPoint[] {
  const sorted = [...rows].sort((a, b) => atOf(a).getTime() - atOf(b).getTime() || a.id - b.id);
  const weeks = new Map<string, {
    total: number;
    me: number;
    chars: number[];
    startsMe: number;
    starts: number;
    negative: number;
    scenes: number;
    replyDelays: number[];
  }>();
  const ensure = (week: string) => {
    let entry = weeks.get(week);
    if (!entry) {
      entry = {
        total: 0,
        me: 0,
        chars: [],
        startsMe: 0,
        starts: 0,
        negative: 0,
        scenes: 0,
        replyDelays: [],
      };
      weeks.set(week, entry);
    }
    return entry;
  };

  for (const row of sorted) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const week = isoWeekKey(atOf(row), timeZone);
    const entry = ensure(week);
    entry.total += 1;
    if (row.role === "user") entry.me += 1;
    else if (isTextRecord(row)) entry.chars.push(String(row.content ?? "").trim().length);
  }

  for (const scene of splitScenes(sorted)) {
    const first = scene[0];
    if (!first) continue;
    const week = isoWeekKey(atOf(first), timeZone);
    const entry = ensure(week);
    entry.scenes += 1;
    if (first.role === "user") entry.startsMe += 1;
    entry.starts += 1;
    if (negativeScene(scene)) entry.negative += 1;
    const turns = toTurns(scene);
    for (let index = 0; index + 1 < turns.length; index++) {
      const left = turns[index];
      const right = turns[index + 1];
      const leftSide = left[0]?.role;
      const rightSide = right[0]?.role;
      if (leftSide === rightSide || (leftSide !== "user" && leftSide !== "assistant")) continue;
      if (rightSide !== "assistant") continue;
      /**
       * The curve is "how quickly *they* answered me". My own replies
       * to them belong to a different number and must not pull the
       * median towards my response time.
       */
      const leftAt = [...left].reverse().find((row) => row.timestamp)?.timestamp;
      const rightAt = right.find((row) => row.timestamp)?.timestamp;
      if (!leftAt || !rightAt) continue;
      const weekOfReply = isoWeekKey(rightAt, timeZone);
      ensure(weekOfReply).replyDelays.push(
        Math.max(0, Math.round((rightAt.getTime() - leftAt.getTime()) / 1000)),
      );
    }
  }

  return [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, entry]) => ({
      week,
      total: entry.total,
      myShare: entry.total > 0 ? entry.me / entry.total : 0,
      replyMedianSec: median(entry.replyDelays),
      charsMedian: median(entry.chars),
      startsMeShare: entry.starts > 0 ? entry.startsMe / entry.starts : 0,
      negativeShare: entry.scenes > 0 ? entry.negative / entry.scenes : null,
    }));
}

function valuesFor(series: WeeklyPoint[], id: TimelineSeriesId): Array<number | null> {
  return series.map((week) => {
    const value = week[id];
    return typeof value === "number" ? value : null;
  });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

export function findTurningPoints(
  series: WeeklyPoint[],
  options: { window?: number; threshold?: number; max?: number } = {},
): TurningPoint[] {
  const window = Math.max(2, options.window ?? 8);
  const threshold = options.threshold ?? 1.5;
  const max = options.max ?? 8;
  const candidates: Array<{ index: number; week: string; change: TurningChange; magnitude: number }> = [];
  for (const id of TIMELINE_SERIES) {
    const values = valuesFor(series, id);
    for (let boundary = window; boundary + window <= values.length; boundary++) {
      const before = values.slice(boundary - window, boundary).filter((value): value is number => value != null);
      const after = values.slice(boundary, boundary + window).filter((value): value is number => value != null);
      if (before.length < 4 || after.length < 4) continue;
      const diff = Math.abs(mean(after) - mean(before));
      const pooled = Math.sqrt((spread(before) ** 2 + spread(after) ** 2) / 2);
      const magnitude = pooled > 0 ? diff / pooled : diff > 0 ? 99 : 0;
      if (magnitude < threshold) continue;
      candidates.push({
        index: boundary,
        week: series[boundary].week,
        change: {
          series: id,
          before: Math.round(mean(before) * 100) / 100,
          after: Math.round(mean(after) * 100) / 100,
        },
        magnitude,
      });
    }
  }
  candidates.sort((a, b) => a.index - b.index || b.magnitude - a.magnitude);
  const points: Array<TurningPoint & { magnitude: number }> = [];
  for (const candidate of candidates) {
    const near = points.find((point) => {
      const existing = series.findIndex((week) => week.week === point.id);
      return Math.abs(existing - candidate.index) < 4;
    });
    if (near) {
      /**
       * One line moves once at a turn. Several boundaries around the
       * same move are the same change seen a week apart, so the
       * series keeps its strongest reading instead of listing itself
       * three times.
       */
      const existing = near.changes.findIndex(
        (change) => change.series === candidate.change.series,
      );
      if (existing >= 0) {
        const current = near.changes[existing];
        if (
          Math.abs(candidate.change.after - candidate.change.before) >
          Math.abs(current.after - current.before)
        ) {
          near.changes[existing] = candidate.change;
        }
      } else {
        near.changes.push(candidate.change);
      }
      near.magnitude = Math.max(near.magnitude, candidate.magnitude);
      continue;
    }
    points.push({
      id: candidate.week,
      at: candidate.week,
      weekStart: weekStartDate(candidate.week) ?? undefined,
      changes: [candidate.change],
      status: "auto",
      magnitude: candidate.magnitude,
    });
  }
  return points
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, max)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ magnitude: _magnitude, ...point }) => point);
}

/** A week key for display: `2023-W27`. */
export function weekLabel(week: string): string {
  return week;
}

/** The date of the first day of a week key, for a jump into the reader. */
export function weekStartDate(week: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  // ISO week 1 contains the fourth of January.
  const fourth = new Date(Date.UTC(year, 0, 4));
  const fourthDay = fourth.getUTCDay() || 7;
  const monday = new Date(fourth.getTime() - (fourthDay - 1) * 86_400_000);
  const start = new Date(monday.getTime() + (weekNumber - 1) * 7 * 86_400_000);
  return zonedDateKey(start, "UTC");
}

/** What is stored on the persona: only the user's decisions. */
export interface StoredTurningPoint {
  id: string;
  at: string;
  changes: TurningChange[];
  status: "auto" | "confirmed" | "rejected";
  note?: string;
}

/**
 * Reads stored change rows, keeping only the fields the page knows.
 *
 * The store is `personaData`, which is user-controllable JSON: whatever
 * is not a `{ series, before, after }` row is dropped rather than handed
 * to the chart.
 */
function normalizeChanges(value: unknown): TurningChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((change) => {
    if (!change || typeof change !== "object") return [];
    const entry = change as Record<string, unknown>;
    if (typeof entry.series !== "string") return [];
    if (typeof entry.before !== "number" || typeof entry.after !== "number") return [];
    return [{
      series: entry.series as TimelineSeriesId,
      before: entry.before,
      after: entry.after,
    }];
  });
}

export function normalizeStoredTurningPoints(value: unknown): StoredTurningPoint[] {
  if (!Array.isArray(value)) return [];
  const out: StoredTurningPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    const status = row.status;
    if (status !== "auto" && status !== "confirmed" && status !== "rejected") continue;
    const changes = normalizeChanges(row.changes);
    out.push({
      id: row.id.trim(),
      at: typeof row.at === "string" && row.at ? row.at : row.id,
      changes,
      status,
      ...(typeof row.note === "string" && row.note ? { note: row.note } : {}),
    });
  }
  return out;
}

/**
 * The detected turns, with the user's own decisions applied (C2.5).
 *
 * A confirmed turn is part of what the user said about their own
 * relationship. When the records change — a file is deleted, an import
 * is confirmed again, a row is corrected — a week that used to qualify
 * can stop qualifying, and the old code then dropped the decision with
 * it: the confirmation and the note were still in the persona data, but
 * the page showed neither. So a stored turn that this run did not
 * re-detect is kept, as the user left it. A rejected one is still
 * dropped: "not a turn" is also a decision, and the point is not shown.
 */
export function mergeTimelinePoints(
  detected: TurningPoint[],
  stored: StoredTurningPoint[],
): TurningPoint[] {
  const decisions = new Map(stored.map((point) => [point.id, point]));
  const merged: TurningPoint[] = [];
  const seen = new Set<string>();
  for (const point of detected) {
    const decision = decisions.get(point.id);
    seen.add(point.id);
    if (decision?.status === "rejected") continue;
    merged.push(
      decision
        ? {
            ...point,
            status: decision.status,
            ...(decision.note ? { note: decision.note } : {}),
          }
        : point,
    );
  }
  for (const decision of stored) {
    if (decision.status === "rejected" || seen.has(decision.id)) continue;
    merged.push({
      id: decision.id,
      at: decision.at || decision.id,
      weekStart: weekStartDate(decision.id) ?? undefined,
      changes: decision.changes,
      status: decision.status,
      ...(decision.note ? { note: decision.note } : {}),
    });
  }
  return merged.sort((a, b) => a.id.localeCompare(b.id));
}

/** The curves and the turns, with the user's decisions applied. */
export interface TimelineEvent {
  at: string;
  week: string;
  kind: string;
  title: string;
}

export async function buildTimeline(params: {
  personaId: number;
  userId: number;
}): Promise<{ series: WeeklyPoint[]; points: TurningPoint[]; events: TimelineEvent[] }> {
  const persona = await db.getPersonaById(params.personaId, params.userId);
  const timeZone = (persona as { timezone?: string | null } | null)?.timezone ?? null;
  const rows: TimelineRow[] = [];
  for await (const row of db.iterateRecords(params.personaId, params.userId)) {
    rows.push({
      id: row.id,
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      createdAt: row.createdAt,
      emotion: row.emotion,
      meta: row.meta,
    });
  }
  const series = weeklySeries(rows, timeZone);
  const stored = normalizeStoredTurningPoints(
    (persona?.personaData as { turningPoints?: unknown } | null)?.turningPoints,
  );
  const points = mergeTimelinePoints(findTurningPoints(series), stored);
  /**
   * The relationship events the user already recorded, on the same
   * week axis as the curves. They are markers, not measurements: the
   * timeline says when something happened, not why a number moved.
   */
  const relationshipEvents = await db.getRelationshipEvents(params.personaId, params.userId, 100);
  const events: TimelineEvent[] = relationshipEvents
    .filter((event) => event.happenedAt instanceof Date && !Number.isNaN(event.happenedAt.getTime()))
    .map((event) => ({
      at: event.happenedAt.toISOString(),
      week: isoWeekKey(event.happenedAt, timeZone),
      kind: event.kind,
      title: event.title,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { series, points, events };
}

/**
 * Records one decision about a turning point.
 *
 * `changes` are the changes the user was looking at when they decided
 * (C2.5). They are stored with the decision: when the records later
 * change, a run can stop detecting the week, and the detector cannot
 * re-measure what it no longer sees — without the stored changes the
 * page would have the point but no vertical line and no "what changed".
 * When they are not passed, the store keeps what it already had.
 */
export async function setTurningPointDecision(params: {
  personaId: number;
  userId: number;
  id: string;
  status: "confirmed" | "rejected";
  note?: string;
  changes?: TurningChange[];
}): Promise<StoredTurningPoint | null> {
  const persona = await db.getPersonaById(params.personaId, params.userId);
  if (!persona) return null;
  const data = persona.personaData && typeof persona.personaData === "object"
    ? { ...(persona.personaData as Record<string, unknown>) }
    : {};
  const list = normalizeStoredTurningPoints(data.turningPoints);
  const index = list.findIndex((point) => point.id === params.id);
  const changes = params.changes !== undefined
    ? normalizeChanges(params.changes)
    : index >= 0
      ? list[index].changes
      : [];
  const next: StoredTurningPoint = {
    id: params.id,
    at: params.id,
    changes,
    status: params.status,
    ...(params.note ? { note: params.note } : {}),
  };
  if (index >= 0) list[index] = next;
  else list.push(next);
  const written = await db.updatePersona(params.personaId, params.userId, {
    personaData: { ...data, turningPoints: list } as never,
  });
  return written ? next : null;
}
