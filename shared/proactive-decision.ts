/**
 * Whether this silence's bought window is used, and at which minute.
 *
 * The frequency the user bought is a cap, not a timetable. The same
 * silence, the same cap and the same profile always produce the same
 * decision, including after a restart: the draw is seeded from those
 * three, not from the process that happened to be running.
 *
 * Reply-gap sampling does not belong here. That wait is for a reply
 * when "on their time" is on. A first word lands on their active hour,
 * jittered, and outside the user's quiet hours.
 */
import { zonedHour, zonedMinute } from "./timezone";

export const PROACTIVE_REFERENCE_RATE = 0.3;
export const PROACTIVE_JITTER_MIN_MS = 15 * 60 * 1000;
export const PROACTIVE_JITTER_MAX_MS = 90 * 60 * 1000;

export type ProactiveSkipReason =
  | "frequency"
  | "probability"
  | "no_material"
  | "unreachable"
  | "graduated"
  | "hold"
  | "empty";

export interface QuietHoursSpec {
  startMinute: number;
  endMinute: number;
}

export interface ProactiveDecision {
  used: boolean;
  /** When the message should land. Null when this window is skipped. */
  deliverAt: Date | null;
  skipReason?: ProactiveSkipReason;
  /** The probability this window was offered, 0–1. */
  probability: number;
}

/**
 * How likely this window is to be used, from the counted first-word rate.
 *
 * `null` means it was never counted — the window fires, same as today.
 * A counted zero means they never spoke first, and the window is skipped.
 * Otherwise p = clamp(r / 0.3, 1/3, 1).
 */
export function proactiveUseProbability(rate: number | null | undefined): number {
  if (rate === null || rate === undefined) return 1;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(1, Math.max(1 / 3, rate / PROACTIVE_REFERENCE_RATE));
}

export function parseQuietHours(spec: string | null | undefined): QuietHoursSpec | null {
  if (!spec) return null;
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(spec.trim());
  if (!match) return null;
  return {
    startMinute: Number(match[1]) * 60 + Number(match[2]),
    endMinute: Number(match[3]) * 60 + Number(match[4]),
  };
}

export function minuteOfDay(now: Date, timeZone?: string | null): number {
  return zonedHour(now, timeZone) * 60 + zonedMinute(now, timeZone);
}

export function isInQuietHours(
  now: Date,
  spec: QuietHoursSpec | null,
  timeZone?: string | null,
): boolean {
  if (!spec) return false;
  const minutes = minuteOfDay(now, timeZone);
  if (spec.startMinute <= spec.endMinute) {
    return minutes >= spec.startMinute && minutes < spec.endMinute;
  }
  return minutes >= spec.startMinute || minutes < spec.endMinute;
}

/** The next instant the user's quiet hours are over, in their zone. */
export function quietHoursEndAt(
  from: Date,
  spec: QuietHoursSpec,
  timeZone?: string | null,
): Date {
  const cursor = new Date(from.getTime());
  for (let step = 0; step < 24 * 60 + 1; step++) {
    if (!isInQuietHours(cursor, spec, timeZone)) return new Date(cursor.getTime());
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return new Date(from.getTime());
}

function zonedDateAtHour(
  base: Date,
  hour: number,
  minute: number,
  timeZone?: string | null,
): Date {
  // Walk minute by minute from the hour's UTC estimate. The zone offset
  // is already in zonedHour; a closed form would have to know DST.
  const probe = new Date(base.getTime());
  probe.setUTCHours(probe.getUTCHours() - zonedHour(probe, timeZone) + hour);
  probe.setUTCMinutes(minute);
  probe.setUTCSeconds(0, 0);
  for (let i = 0; i < 180; i++) {
    if (zonedHour(probe, timeZone) === hour && zonedMinute(probe, timeZone) === minute) {
      return probe;
    }
    const deltaHour = hour - zonedHour(probe, timeZone);
    const deltaMinute = minute - zonedMinute(probe, timeZone);
    probe.setUTCMinutes(probe.getUTCMinutes() + deltaHour * 60 + deltaMinute);
  }
  return probe;
}

/**
 * The next of their active hours after `eligibleAt`, plus 15–90 minutes
 * of seeded jitter, landed outside the user's quiet hours.
 *
 * When every active hour sits inside the quiet window, the message is
 * delivered the minute quiet hours end — it is not slid later again.
 */
export function resolveProactiveDeliverAt(params: {
  eligibleAt: Date;
  activeHours: number[];
  personaTimeZone?: string | null;
  quietHours?: QuietHoursSpec | null;
  userTimeZone?: string | null;
  rng: () => number;
}): Date {
  const hours = (params.activeHours ?? []).filter((h) => h >= 0 && h <= 23);
  const jitterRange = PROACTIVE_JITTER_MAX_MS - PROACTIVE_JITTER_MIN_MS;
  const jitterMs = PROACTIVE_JITTER_MIN_MS + Math.round(params.rng() * jitterRange);

  let candidate: Date;
  if (!hours.length) {
    candidate = new Date(params.eligibleAt.getTime());
  } else {
    const unique = [...new Set(hours)].sort((a, b) => a - b);
    candidate = nextActiveSlot(params.eligibleAt, unique, params.personaTimeZone);
    candidate = new Date(candidate.getTime() + jitterMs);
  }

  const quiet = params.quietHours ?? null;
  if (!quiet) return candidate;

  const allActiveInsideQuiet =
    hours.length > 0 &&
    hours.every((hour) => {
      const probe = zonedDateAtHour(params.eligibleAt, hour, 0, params.personaTimeZone);
      return isInQuietHours(probe, quiet, params.userTimeZone);
    });
  if (allActiveInsideQuiet) {
    return quietHoursEndAt(params.eligibleAt, quiet, params.userTimeZone);
  }
  if (isInQuietHours(candidate, quiet, params.userTimeZone)) {
    return quietHoursEndAt(candidate, quiet, params.userTimeZone);
  }
  return candidate;
}

function nextActiveSlot(
  eligibleAt: Date,
  hours: number[],
  timeZone?: string | null,
): Date {
  const eligibleHour = zonedHour(eligibleAt, timeZone);
  const eligibleMinute = zonedMinute(eligibleAt, timeZone);
  for (let day = 0; day < 3; day++) {
    for (const hour of hours) {
      if (day === 0 && (hour < eligibleHour || (hour === eligibleHour && eligibleMinute > 0))) {
        continue;
      }
      const slot = zonedDateAtHour(
        new Date(eligibleAt.getTime() + day * 86_400_000),
        hour,
        0,
        timeZone,
      );
      if (slot.getTime() >= eligibleAt.getTime()) return slot;
    }
  }
  return new Date(eligibleAt.getTime());
}

/**
 * One decision for one silence.
 *
 * Callers that skip on probability must not ask the model. The next
 * evaluation is one full window later; an unused window is not made up.
 */
export function decideProactiveWindow(params: {
  frequencyHours: number;
  silenceStart: Date | null;
  openingRate: number | null;
  presence: string;
  reachability?: string | null;
  rng: () => number;
  /** 1 is the first bought window of this silence. */
  windowIndex?: number;
}): { eligibleAt: Date | null; used: boolean; probability: number; skipReason?: ProactiveSkipReason } {
  if (!params.frequencyHours || params.frequencyHours <= 0 || !params.silenceStart) {
    return { eligibleAt: null, used: false, probability: 0, skipReason: "frequency" };
  }
  if (params.presence === "asleep" || params.presence === "graduated") {
    return { eligibleAt: null, used: false, probability: 0, skipReason: "graduated" };
  }
  if (params.presence === "quiet") {
    return { eligibleAt: null, used: false, probability: 0, skipReason: "hold" };
  }
  if (params.reachability === "unreachable") {
    return { eligibleAt: null, used: false, probability: 0, skipReason: "unreachable" };
  }
  const windowIndex = Math.max(1, Math.round(params.windowIndex ?? 1));
  const eligibleAt = new Date(
    params.silenceStart.getTime() + params.frequencyHours * windowIndex * 3_600_000,
  );
  const probability = proactiveUseProbability(params.openingRate);
  if (probability <= 0) {
    return { eligibleAt, used: false, probability, skipReason: "probability" };
  }
  const used = params.rng() < probability;
  if (!used) {
    return { eligibleAt, used: false, probability, skipReason: "probability" };
  }
  return { eligibleAt, used: true, probability };
}
