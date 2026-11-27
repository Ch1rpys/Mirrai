/**
 * Who answers in a group, and who does not (C9.8).
 *
 * A group is not a conversation with one persona: the user writes once
 * and zero to two personas answer. Nothing here calls the model or the
 * database — the rules that decide *whether* someone speaks are pure
 * functions of the room, what the user said, and a seed, so the tests can
 * hold them still.
 *
 * The rules, from the manual:
 *
 *  - A persona whose name is in the line answers — being called is not
 *    left to a dice roll.
 *  - A persona with a measured group profile answers with probability
 *    `afterMeRate` (clamped to 0.05–0.9).
 *  - **A persona with no group records never speaks unless called.** No
 *    default probability fills the gap: a persona nobody measured in a
 *    group does not know how it behaves in one.
 *  - At most two personas answer one line of the user's; if the user
 *    called people by name, all of them answer, up to four.
 *  - The personas' own lines never start another round: only the user's
 *    next message does.
 */
import { copy, type Locale } from "@shared/copy";
import { seededRandom } from "../_core/behavior-profile";
import type { GroupStats } from "@shared/group-stats";

export interface GroupMember {
  personaId: number;
  /** The name shown in the room. */
  name: string;
  /** Another name the user may call this persona by (the skin alias). */
  aliases?: string[];
  /** The persona's measured group profile; missing means unmeasured. */
  group?: GroupStats | null;
}

export interface GroupTurnDecision {
  personaId: number;
  /** When this persona's line would arrive, in milliseconds. */
  delayMs: number;
  mentioned: boolean;
}

/** How long a name may be in the instruction; long names are cut. */
const MAX_NAME_CHARS = 30;
/** The most personas that answer one user line when nobody was called. */
export const MAX_UNMENTIONED_REPLIERS = 2;
/** The most personas that answer one user line when the user called names. */
export const MAX_MENTIONED_REPLIERS = 4;
/** The range `afterMeRate` is clamped into. */
const MIN_RATE = 0.05;
const MAX_RATE = 0.9;
/** Reply delays: a short, human-ish range, before the group shows them. */
const MIN_DELAY_MS = 800;
const MAX_DELAY_MS = 6_000;

/**
 * One name, made safe to sit inside a single instruction line.
 *
 * A persona's name is the user's text. A newline in it would become a
 * new line of the prompt, and a name that reads like an order would read
 * like one — so control characters and line breaks are removed and the
 * name is clamped. The name stays itself otherwise.
 */
export function sanitizeMemberName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  // eslint-disable-next-line no-control-regex
  const cleaned = raw
    // No new line: the instruction is one paragraph, and a name must not
    // be able to add a line of its own.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // No angle brackets: the prompt marks its material with tags, and a
    // name must not be able to look like one.
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "?";
  return Array.from(cleaned).slice(0, MAX_NAME_CHARS).join("");
}

/**
 * The group instruction, built from the room's own members.
 *
 * It is an application instruction (it says what this room is), so it is
 * not fenced; the names inside it are flattened by
 * `sanitizeMemberName` so no name can add a line or a heading. The list
 * separator follows the language: an English sentence reads badly with a
 * Chinese enumeration comma between names.
 */
export function groupOverlayText(params: {
  locale: Locale;
  members: string[];
  userName: string;
}): string {
  const separator = params.locale === "en" ? ", " : "、";
  const members = params.members.map(sanitizeMemberName).join(separator);
  return copy(params.locale, "prompt.groupOverlay", {
    members,
    user: sanitizeMemberName(params.userName),
  });
}

/**
 * Whether the line calls this persona.
 *
 * `@名字` is the explicit form; a line that simply contains the name is
 * a call too, because in a small room people write "小满你怎么看".
 */
export function mentionsPersona(text: string, member: GroupMember): boolean {
  if (!text) return false;
  const names = [member.name, ...(member.aliases ?? [])]
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter((name) => name.length > 0);
  /**
   * Latin names are written with whatever case the person uses: a room
   * member called "Xiaoman" is called by `@xiaoman` too. Chinese has no
   * case, so this only affects the Latin names.
   */
  const haystack = text.toLocaleLowerCase();
  return names.some((name) => haystack.includes(name.toLocaleLowerCase()));
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return MIN_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, value));
}

function delayFor(rng: () => number): number {
  return MIN_DELAY_MS + Math.floor(rng() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

/**
 * Decides this round's replies, in the order they would arrive.
 *
 * `seed` fixes the dice: the same room, line and seed give the same
 * answer, which is what the acceptance asks for and what makes the
 * behaviour explainable.
 */
export function decideGroupTurns(params: {
  members: GroupMember[];
  userText: string;
  seed: string;
}): GroupTurnDecision[] {
  const rng = seededRandom(params.seed);
  const mentioned: GroupTurnDecision[] = [];
  const candidates: GroupTurnDecision[] = [];

  for (const member of params.members) {
    const called = mentionsPersona(params.userText, member);
    const delayMs = delayFor(rng);
    if (called) {
      mentioned.push({ personaId: member.personaId, delayMs, mentioned: true });
      continue;
    }
    /**
     * An unmeasured persona says nothing unless called. There is no
     * default rate to fall back on — the manual is explicit about it.
     */
    const stats = member.group ?? null;
    if (!stats) continue;
    // The roll is taken even when the pick will be capped, so the same
    // seed keeps meaning the same thing regardless of ordering.
    const hit = rng() < clampRate(stats.afterMeRate);
    if (hit) candidates.push({ personaId: member.personaId, delayMs, mentioned: false });
  }

  let selected: GroupTurnDecision[];
  if (mentioned.length > 0) {
    selected = mentioned
      .slice()
      .sort((a, b) => a.delayMs - b.delayMs)
      .slice(0, MAX_MENTIONED_REPLIERS);
  } else {
    selected = candidates
      .slice()
      .sort((a, b) => a.delayMs - b.delayMs)
      .slice(0, MAX_UNMENTIONED_REPLIERS);
  }
  return selected.sort((a, b) => a.delayMs - b.delayMs);
}

/** The delay between two replies, for the room's display. */
export function replyDelayMs(): { min: number; max: number } {
  return { min: MIN_DELAY_MS, max: MAX_DELAY_MS };
}
