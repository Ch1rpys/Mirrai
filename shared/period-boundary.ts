/**
 * What this stretch of them is allowed to know.
 *
 * A selected period is a cut in the records. Anything that can be
 * dated after that cut — a memory, a breakup, a name that only
 * appears later — is from a person they had not yet become.
 */
import { normalizeLexicon, type LexiconEntry } from "./lexicon";
import { normalizeLifeEvents, type LifeEvent } from "./life-events";
import { normalizePeople, type Person } from "./people";
import { normalizeStances, type Stance } from "./stances";
import { parseZoneless } from "./timezone";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPLETE_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;

export function periodToInstant(
  to: string | null | undefined,
  timeZone?: string | null,
): Date | null {
  const text = String(to ?? "").trim();
  if (!text) return null;
  const dateOnly = text.match(DATE_ONLY);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const zone = typeof timeZone === "string" ? timeZone.trim() : "";
    if (zone) {
      const end = parseZoneless(
        `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} 23:59:59`,
        zone,
      );
      if (end) return new Date(end.getTime() + 999);
    }
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isCompleteDate(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim();
  return COMPLETE_DATE.test(text) && !Number.isNaN(new Date(text).getTime());
}

export function isOnOrBefore(at: Date | string | null | undefined, to: Date): boolean {
  const instant = at instanceof Date ? at : at ? new Date(at) : null;
  if (!instant || Number.isNaN(instant.getTime())) return false;
  return instant.getTime() <= to.getTime();
}

function earliestAt(values: Array<string | Date | null | undefined>): Date | null {
  let earliest: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const instant = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(instant.getTime())) continue;
    if (!earliest || instant.getTime() < earliest.getTime()) earliest = instant;
  }
  return earliest;
}

/**
 * Keep a row whose first dated evidence is on or before the cut.
 *
 * A row with no dates is not known to be later, so it stays.
 */
export function knownByFirstEvidence(
  evidence: Array<{ at?: string }>,
  extra?: Array<string | Date | null | undefined>,
  to?: Date | null,
): boolean {
  if (!to) return true;
  const first = earliestAt([
    ...evidence.map((row) => row.at),
    ...(extra ?? []),
  ]);
  if (!first) return true;
  return isOnOrBefore(first, to);
}

export function clipTogetherTo(
  togetherTo: string | null | undefined,
  to: Date | null,
  timeZone?: string | null,
): string {
  const text = String(togetherTo ?? "").trim();
  if (!text || !to) return text;
  const instant = periodToInstant(text, timeZone) ?? new Date(text);
  if (Number.isNaN(instant.getTime())) return text;
  return instant.getTime() > to.getTime() ? "" : text;
}

export interface PeriodMemory {
  date?: string | null;
  recordId?: number | null;
  isPinned?: boolean;
  category?: string | null;
}

/**
 * Whether a memory belongs to this stretch.
 *
 * A pinned row stays. An anchor with no usable date and no record
 * stays. Everything else has to be dated on or before the cut, by a
 * complete date or by the record it was taken from.
 */
export function memoryKnownBy(
  memory: PeriodMemory,
  to: Date | null,
  recordTimes: Map<number, Date> = new Map(),
): boolean {
  if (!to) return true;
  if (memory.isPinned) return true;
  const date = String(memory.date ?? "").trim();
  if (isCompleteDate(date) && isOnOrBefore(date, to)) return true;
  const recordId = memory.recordId ?? null;
  if (recordId != null) {
    const at = recordTimes.get(recordId);
    if (at && isOnOrBefore(at, to)) return true;
  }
  const hasTime = isCompleteDate(date) || recordId != null;
  if (!hasTime && memory.category === "anchor") return true;
  return false;
}

export function eventKnownBy(
  happenedAt: Date | string | null | undefined,
  to: Date | null,
): boolean {
  if (!to) return true;
  // 「只取 happenedAt ≤ to 的」: an event with no day is not known to
  // be before the cut, so it does not belong to that stretch.
  if (!happenedAt) return false;
  return isOnOrBefore(happenedAt, to);
}

export function personaAsOfPeriod<T extends {
  togetherTo?: string | null;
  personaData?: unknown;
}>(
  persona: T,
  period: { from?: string; to?: string } | null | undefined,
  timeZone?: string | null,
): T {
  const to = periodToInstant(period?.to, timeZone);
  if (!to) return persona;
  const data = (persona.personaData ?? {}) as Record<string, unknown>;
  return {
    ...persona,
    togetherTo: clipTogetherTo(persona.togetherTo, to, timeZone) || null,
    personaData: {
      ...data,
      lifeEvents: normalizeLifeEvents(data.lifeEvents).filter((row) =>
        knownByFirstEvidence(row.evidence, [], to),
      ),
                      people: normalizePeople(data.people).filter((row) =>
        knownByFirstEvidence(row.evidence, [], to),
      ),
      stances: normalizeStances(data.stances).filter((row) =>
        knownByFirstEvidence(row.evidence, [], to),
      ),
      lexicon: normalizeLexicon(data.lexicon).filter((row) =>
        knownByFirstEvidence(row.evidence, [row.firstAt], to),
      ),
    },
  };
}

