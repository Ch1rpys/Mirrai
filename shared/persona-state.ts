/**
 * The states a persona can be in besides speaking (C5.1, C6.1, C6.2, C7.1).
 *
 * Presence ("active" / "quiet" / "asleep") answers whether the app may
 * reach out. It is not enough for the sixth stage: a relationship can be
 * long distance, can be winding down one step at a time, can be sealed
 * until a date the user picked, can be a memorial. Those states live in
 * `personas.settings`, and every caller has to read the same defaults
 * and the same clock, or the chat page and the server disagree about
 * whether a message may be sent.
 *
 * Everything here is a pure function of the stored settings and a time.
 * `mayChatNow` is the one the server enforces.
 */
import { normalizePersonaSettings, type PersonaSettings } from "./persona-settings";
import { parseZoneless, zonedDateKey, zonedWeekday } from "./timezone";

/** The part of a persona these helpers need. */
export interface PersonaStateInput {
  settings?: unknown;
  presence?: string | null;
  graduationStatus?: string | null;
}

/** The settings, with defaults filled and bad values dropped. */
export function personaSettingsOf(persona: PersonaStateInput | null | undefined): PersonaSettings {
  return normalizePersonaSettings(persona?.settings);
}

/** A memorial persona (C7.1). */
export function isMemorial(persona: PersonaStateInput | null | undefined): boolean {
  return personaSettingsOf(persona).mode === "memorial";
}

/** The taper stage (C6.1), 0 when the user never set one. */
export function taperStage(persona: PersonaStateInput | null | undefined): 0 | 1 | 2 | 3 {
  const stage = personaSettingsOf(persona).taper?.stage;
  return stage === 1 || stage === 2 || stage === 3 ? stage : 0;
}

const SEAL_COOLING_MS = 72 * 60 * 60 * 1000;

/**
 * Reads a seal date.
 *
 * A day-only value means the start of that day in the user's own zone:
 * "sealed until the 20th" opens on the 20th, not at the end of it.
 * Anything else is an instant.
 */
function sealBoundary(value: string, timeZone?: string | null): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseZoneless(`${value} 00:00`, timeZone);
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

export type SealState = "open" | "sealed";

/**
 * Whether a sealed persona may be opened (C6.2).
 *
 * A persona with no seal is open. A date in the future seals it until
 * that date. `earlyOpen: "cooling"` adds one way out: seventy-two hours
 * after the request, it opens on its own. `"never"` has no way out
 * before the date.
 */
export function sealState(
  persona: PersonaStateInput | null | undefined,
  now: Date,
  timeZone?: string | null,
): SealState {
  const seal = personaSettingsOf(persona).seal;
  if (!seal?.until) return "open";
  const until = sealBoundary(seal.until, timeZone);
  if (!until) return "open";
  if (now.getTime() >= until.getTime()) return "open";
  if (seal.earlyOpen === "cooling" && seal.requestedAt) {
    const requested = new Date(seal.requestedAt);
    if (
      Number.isFinite(requested.getTime()) &&
      now.getTime() >= requested.getTime() + SEAL_COOLING_MS
    ) {
      return "open";
    }
  }
  return "sealed";
}

export type ChatClosedReason = "weekend_only" | "letters_only" | "sealed" | "consent";

export type MayChat =
  | { ok: true }
  | { ok: false; reason: ChatClosedReason };

/**
 * Whether the user may start a conversation with this persona (C6.1, C6.2).
 *
 * It is enforced on the server, so every entry point — web, channels,
 * the phone, the rehearsal room — gets the same answer. The taper is
 * the user's own choice, and the messages say so.
 */
export function mayChatNow(
  persona: PersonaStateInput | null | undefined,
  now: Date,
  timeZone?: string | null,
): MayChat {
  /**
   * The person the persona was rebuilt from said no (C10.3).
   *
   * This is not the owner's own step-down: there is no exception day and
   * no way round it from the chat page. Removing the persona is the only
   * thing left, and it is on the owner's profile page.
   */
  if (personaSettingsOf(persona).consent === "asked_no") {
    return { ok: false, reason: "consent" };
  }
  if (sealState(persona, now, timeZone) === "sealed") {
    return { ok: false, reason: "sealed" };
  }
  const stage = taperStage(persona);
  if (stage >= 3) return { ok: false, reason: "letters_only" };
  if (stage === 2) {
    const settings = personaSettingsOf(persona);
    const today = zonedDateKey(now, timeZone);
    if (settings.taper?.overrideDay !== today) {
      const weekday = zonedWeekday(now, timeZone);
      if (weekday !== 0 && weekday !== 6) {
        return { ok: false, reason: "weekend_only" };
      }
    }
  }
  return { ok: true };
}

export type MeetCountdown =
  | { state: "none" }
  | { state: "invalid"; date: string }
  | { state: "upcoming"; date: string; days: number }
  | { state: "today"; date: string }
  | { state: "past"; date: string };

function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(value) ? Math.floor(value / 86_400_000) : null;
}

/**
 * The meeting countdown (C5.1).
 *
 * The date is the user's calendar, not the server's: a meeting on the
 * 20th is "tomorrow" for eighteen hours of the 19th in Shanghai and not
 * in Los Angeles.
 */
export function meetCountdown(
  persona: PersonaStateInput | null | undefined,
  now: Date,
  timeZone?: string | null,
): MeetCountdown {
  const nextMeetAt = personaSettingsOf(persona).ldr?.nextMeetAt;
  if (!nextMeetAt) return { state: "none" };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(nextMeetAt)
    ? nextMeetAt
    : zonedDateKey(new Date(nextMeetAt), timeZone);
  const target = dayNumber(date);
  const today = dayNumber(zonedDateKey(now, timeZone));
  if (target === null || today === null) return { state: "invalid", date: nextMeetAt };
  const days = target - today;
  if (days > 0) return { state: "upcoming", date, days };
  if (days === 0) return { state: "today", date };
  return { state: "past", date };
}
