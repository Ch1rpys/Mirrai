/**
 * The annual report of the record (C2.4)
 *
 * Every number is counted from the imported lines. Nothing is
 * generated, nothing is scored: the page says what happened, not
 * whether it was good.
 */
import { collectLexiconCandidates } from "@shared/lexicon";
import { normalizeCallStats, type CallStats } from "@shared/call-stats";
import { splitScenes, toTurns } from "@shared/scenes";
import { normalizeTrigger } from "@shared/ritual-table";
import { isTextRecord, recordText } from "@shared/records";
import { zonedDateKey, zonedHour, zonedWeekday } from "@shared/timezone";
import * as db from "../db";

export interface ReportRow {
  id: number;
  role: string;
  content: string;
  kind: string;
  timestamp: Date | null;
  createdAt: Date;
  meta?: unknown;
}

export interface ReportSpan {
  from: string;
  to: string;
  days: number;
  activeDays: number;
}

export interface ReportYear {
  year: number;
  me: number;
  them: number;
  charsMe: number;
  charsThem: number;
  startsMe: number;
  startsThem: number;
  goodnightFirstMe: number;
  goodnightFirstThem: number;
  replyMedianSecMe: number | null;
  replyMedianSecThem: number | null;
  topTerms: string[];
}

export interface RecordReport {
  span: ReportSpan;
  totals: {
    me: number;
    them: number;
    byKind: Record<string, { me: number; them: number }>;
  };
  byMonth: Array<{ month: string; me: number; them: number }>;
  byYear: ReportYear[];
  longestScene: { fromId: number; from: string; minutes: number; count: number } | null;
  longestSilence: { from: string; to: string; days: number } | null;
  heatmap: number[][];
  calls: CallStats | null;
}

function atOf(row: ReportRow): Date {
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

function sideOf(row: { role: string }): "me" | "them" | null {
  if (row.role === "user") return "me";
  if (row.role === "assistant") return "them";
  return null;
}

/**
 * The words that stand out in a year (C2.4).
 *
 * "More often than in the other years" is a comparison, not a count:
 * a word that appears just as often every year is not that year's
 * word. The old filter only required five hits, so an evenly spread
 * word could be listed under every year.
 */
export function selectTopTerms(
  countsByYear: Map<number, Map<string, number>>,
  textRowsByYear: Map<number, number>,
  totalTermCounts: Map<string, number>,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const [year, counts] of countsByYear) {
    const total = textRowsByYear.get(year) ?? 1;
    const otherYears = [...countsByYear.entries()].filter(([other]) => other !== year);
    out.set(
      year,
      [...counts.entries()]
        .map(([term, count]) => {
          const rate = count / total;
          const otherRate = Math.max(
            0,
            ...otherYears.map(([other, otherCounts]) =>
              (otherCounts.get(term) ?? 0) / (textRowsByYear.get(other) ?? 1),
            ),
          );
          return {
            term,
            count,
            rate,
            otherRate,
            score: count / ((totalTermCounts.get(term) ?? count) - count + 1),
          };
        })
        .filter((item) => item.count >= 5 && item.rate > item.otherRate + 1e-9)
        .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term))
        .slice(0, 12)
        .map((item) => item.term),
    );
  }
  return out;
}

// i18n:allow-input — 「晚安」 is matched against the record's own goodnights.
export function buildReportFromRecords(
  rows: ReportRow[],
  options: { timeZone?: string | null; calls?: unknown } = {},
): RecordReport {
  const zone = options.timeZone ?? null;
  const sorted = [...rows].sort((a, b) => atOf(a).getTime() - atOf(b).getTime() || a.id - b.id);
  const totals = { me: 0, them: 0, byKind: {} as Record<string, { me: number; them: number }> };
  const byMonthMap = new Map<string, { me: number; them: number }>();
  const yearMap = new Map<number, ReportYear>();
  const activeDays = new Set<string>();
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const replyDelays = new Map<number, { me: number[]; them: number[] }>();
  const termsByYear = new Map<number, Map<string, number>>();

  const yearOf = (date: Date) => Number(zonedDateKey(date, zone).slice(0, 4));
  const ensureYear = (year: number): ReportYear => {
    let entry = yearMap.get(year);
    if (!entry) {
      entry = {
        year,
        me: 0,
        them: 0,
        charsMe: 0,
        charsThem: 0,
        startsMe: 0,
        startsThem: 0,
        goodnightFirstMe: 0,
        goodnightFirstThem: 0,
        replyMedianSecMe: null,
        replyMedianSecThem: null,
        topTerms: [],
      };
      yearMap.set(year, entry);
    }
    return entry;
  };

  for (const row of sorted) {
    const side = sideOf(row);
    if (!side) continue;
    const at = atOf(row);
    const year = yearOf(at);
    const entry = ensureYear(year);
    const kind = row.kind || "text";
    const byKind = totals.byKind[kind] ?? { me: 0, them: 0 };
    byKind[side] += 1;
    totals.byKind[kind] = byKind;
    totals[side] += 1;
    entry[side] += 1;
    const month = zonedDateKey(at, zone).slice(0, 7);
    const monthEntry = byMonthMap.get(month) ?? { me: 0, them: 0 };
    monthEntry[side] += 1;
    byMonthMap.set(month, monthEntry);
    activeDays.add(zonedDateKey(at, zone));
    if (side === "them") heatmap[zonedWeekday(at, zone)]![zonedHour(at, zone)]! += 1;
    if (isTextRecord(row)) {
      const chars = recordText({ ...row, meta: (row.meta ?? null) as Record<string, unknown> | null }).length;
      if (side === "me") entry.charsMe += chars;
      else entry.charsThem += chars;
    }
  }

  const scenes = splitScenes(sorted);
  let longestScene: RecordReport["longestScene"] = null;
  for (const scene of scenes) {
    const first = scene[0];
    if (!first) continue;
    const side = sideOf(first);
    if (side === "me") ensureYear(yearOf(atOf(first))).startsMe += 1;
    else if (side === "them") ensureYear(yearOf(atOf(first))).startsThem += 1;
    const timed = scene.filter((row) => row.timestamp);
    if (timed.length > 0) {
      const minutes = Math.round(
        (timed[timed.length - 1].timestamp!.getTime() - timed[0].timestamp!.getTime()) / 60_000,
      );
      if (!longestScene || minutes > longestScene.minutes) {
        longestScene = {
          fromId: timed[0].id,
          from: timed[0].timestamp!.toISOString(),
          minutes,
          count: scene.length,
        };
      }
    }
    // The goodnight of this scene is the first one said in it.
    const goodnight = scene.find((row) => normalizeTrigger(row.content) === "晚安");
    if (goodnight) {
      const goodnightSide = sideOf(goodnight);
      const year = ensureYear(yearOf(atOf(goodnight)));
      if (goodnightSide === "me") year.goodnightFirstMe += 1;
      else if (goodnightSide === "them") year.goodnightFirstThem += 1;
    }
    // How long each side took to answer the other.
    const turns = toTurns(scene);
    for (let index = 0; index + 1 < turns.length; index++) {
      const left = turns[index];
      const right = turns[index + 1];
      const leftSide = sideOf(left[0]);
      const rightSide = sideOf(right[0]);
      if (!leftSide || !rightSide || leftSide === rightSide) continue;
      const leftAt = [...left].reverse().find((row) => row.timestamp)?.timestamp;
      const rightAt = right.find((row) => row.timestamp)?.timestamp;
      if (!leftAt || !rightAt) continue;
      const seconds = Math.max(0, Math.round((rightAt.getTime() - leftAt.getTime()) / 1000));
      const year = yearOf(leftAt);
      const bucket = replyDelays.get(year) ?? { me: [], them: [] };
      const replier = rightSide === "me" ? "me" : "them";
      bucket[replier].push(seconds);
      replyDelays.set(year, bucket);
    }
  }

  let longestSilence: RecordReport["longestSilence"] = null;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1].timestamp;
    const current = sorted[index].timestamp;
    if (!previous || !current) continue;
    const gap = current.getTime() - previous.getTime();
    if (gap <= 0) continue;
    const days = Math.round(gap / 86_400_000);
    if (!longestSilence || days > longestSilence.days) {
      longestSilence = {
        from: previous.toISOString(),
        to: current.toISOString(),
        days,
      };
    }
  }

  /**
   * The words that stand out in a year.
   *
   * A term counts if it appears at least five times that year and is
   * proportionally more common than in the other years — the same term
   * miner the dictionary uses, run per year.
   */
  const totalTermCounts = new Map<string, number>();
  const textRowsByYear = new Map<number, number>();
  for (const year of yearMap.keys()) {
    const rowsOfYear = sorted.filter((row) => isTextRecord(row) && yearOf(atOf(row)) === year);
    const candidates = collectLexiconCandidates(rowsOfYear as never);
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      counts.set(candidate.term, candidate.count);
      totalTermCounts.set(candidate.term, (totalTermCounts.get(candidate.term) ?? 0) + candidate.count);
    }
    textRowsByYear.set(year, Math.max(1, rowsOfYear.length));
    termsByYear.set(year, counts);
  }
  const topTermsByYear = selectTopTerms(termsByYear, textRowsByYear, totalTermCounts);
  for (const [year, terms] of topTermsByYear) ensureYear(year).topTerms = terms;

  for (const [year, delays] of replyDelays) {
    const entry = ensureYear(year);
    entry.replyMedianSecMe = median(delays.me);
    entry.replyMedianSecThem = median(delays.them);
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span: ReportSpan = first && last
    ? {
        from: zonedDateKey(atOf(first), zone),
        to: zonedDateKey(atOf(last), zone),
        days:
          Math.floor((atOf(last).getTime() - atOf(first).getTime()) / 86_400_000) + 1,
        activeDays: activeDays.size,
      }
    : { from: "", to: "", days: 0, activeDays: 0 };

  return {
    span,
    totals,
    byMonth: [...byMonthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, counts]) => ({ month, ...counts })),
    byYear: [...yearMap.values()].sort((a, b) => a.year - b.year),
    longestScene,
    longestSilence,
    heatmap,
    calls: normalizeCallStats(options.calls),
  };
}


/** Builds the report from the record table (C2.4). */
export async function buildReport(params: {
  personaId: number;
  userId: number;
}): Promise<RecordReport> {
  const persona = await db.getPersonaById(params.personaId, params.userId);
  const rows: ReportRow[] = [];
  for await (const row of db.iterateRecords(params.personaId, params.userId)) {
    rows.push({
      id: row.id,
      role: row.role,
      content: row.content,
      kind: row.kind,
      timestamp: row.timestamp,
      createdAt: row.createdAt,
      meta: row.meta,
    });
  }
  const profile = await db.getPersonaStyleProfile(params.personaId, params.userId);
  return buildReportFromRecords(rows, {
    timeZone: (persona as { timezone?: string | null } | null)?.timezone ?? null,
    calls: profile?.calls ?? null,
  });
}
