/**
 * Two stretches of the same person.
 *
 * The persona stays one current document. A period is only a delta:
 * how the action counts and the subtractions shifted across a long
 * silence in the records. Copying the seven layers into N personas
 * would make every later edit a merge problem.
 *
 * A split is only offered when a silence of at least fourteen days
 * sits between two stretches that each have enough of their messages.
 */
import type { ActProfile } from "./act-profile";
import { normalizeActProfile } from "./act-profile";
import type { Suppression } from "./suppressions";
import { normalizeSuppressions } from "./suppressions";

export const PERIOD_SILENCE_DAYS = 14;
export const PERIOD_MIN_MESSAGES = 20;

export interface PersonaPeriod {
  id: string;
  from: string;
  to: string;
  actProfileDelta?: ActProfile | null;
  suppressionsDelta?: Suppression[];
}

export interface PeriodSplitPoint {
  afterIndex: number;
  silenceDays: number;
  at: string;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePeriods(value: unknown): PersonaPeriod[] {
  if (!Array.isArray(value)) return [];
  const out: PersonaPeriod[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const from = toText(record.from);
    const to = toText(record.to);
    if (!from || !to) return;
    out.push({
      id: toText(record.id) || `period-${index + 1}`,
      from,
      to,
      actProfileDelta: normalizeActProfile(record.actProfileDelta),
      suppressionsDelta: normalizeSuppressions(record.suppressionsDelta),
    });
  });
  return out;
}

/**
 * Places a cut where the record went quiet for two weeks and both
 * sides still have enough of their own lines.
 *
 * Returns nothing when the record is one stretch. The selector is not
 * shown for a persona that cannot be cut. Rows are read by the time
 * they were said, so a later scene that was appended out of order
 * does not look like another silence.
 */
export function findPeriodSplits(
  messages: Array<{ role: string; timestamp: Date | null }>,
  options?: { silenceDays?: number; minMessages?: number },
): PeriodSplitPoint[] {
  const silenceMs = (options?.silenceDays ?? PERIOD_SILENCE_DAYS) * 86_400_000;
  const minMessages = options?.minMessages ?? PERIOD_MIN_MESSAGES;
  const dated = messages
    .map((row, index) => ({
      index,
      role: row.role,
      at: row.timestamp instanceof Date && !Number.isNaN(row.timestamp.getTime())
        ? row.timestamp
        : null,
    }))
    .filter((row) => row.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime() || a.index - b.index);

  const cuts: PeriodSplitPoint[] = [];
  for (let i = 1; i < dated.length; i++) {
    const earlier = dated[i - 1].at as Date;
    const later = dated[i].at as Date;
    const gap = later.getTime() - earlier.getTime();
    if (gap < silenceMs) continue;
    const leftTheirs = dated
      .slice(0, i)
      .filter((row) => row.role === "assistant").length;
    const rightTheirs = dated
      .slice(i)
      .filter((row) => row.role === "assistant").length;
    if (leftTheirs < minMessages || rightTheirs < minMessages) continue;
    cuts.push({
      afterIndex: dated[i - 1].index,
      silenceDays: Math.round(gap / 86_400_000),
      at: later.toISOString(),
    });
  }
  return cuts;
}

export function periodsFromSplits(
  messages: Array<{ timestamp: Date | null }>,
  splits: PeriodSplitPoint[],
): PersonaPeriod[] {
  if (!splits.length) return [];
  const times = messages
    .map((row) =>
      row.timestamp instanceof Date && !Number.isNaN(row.timestamp.getTime())
        ? row.timestamp
        : null,
    )
    .filter((at): at is Date => Boolean(at))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!times.length) return [];
  const bounds = [times[0], ...splits.map((split) => new Date(split.at)), times[times.length - 1]];
  const periods: PersonaPeriod[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i];
    const to = bounds[i + 1];
    periods.push({
      id: `period-${i + 1}`,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  return periods;
}
