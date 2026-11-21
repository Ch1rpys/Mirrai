/**
 * The role swap (C4.4).
 *
 * For one bounded practice, the user plays the person and the app plays
 * the user, rebuilt from the user's own lines. It is a hard promise that
 * this never touches the conversation: the transcript lives only in
 * `roleplay_sessions`, and no message, memory, mood, intimacy or chat
 * count is written.
 *
 * The self is built from the measured user side (the fingerprint and the
 * representative lines) plus a few of the user's real lines near the one
 * being answered — all of it material, fenced.
 */
import { copy } from "@shared/copy";
import { asMaterial } from "@shared/material";
import { describeFingerprint } from "@shared/fingerprint-prose";
import type { UserSideProfile } from "@shared/user-side-profile";
import type { Locale } from "@shared/copy";

/** The practice limits. Both are enforced on the server. */
export const ROLEPLAY_MAX_MINUTES = 15;
export const ROLEPLAY_MAX_TURNS = 30;
/** The record has to carry enough of the user's own words to rebuild them. */
export const ROLEPLAY_MIN_USER_LINES = 200;

export interface SelfPromptInput {
  personaName: string;
  locale: Locale;
  userSide?: UserSideProfile | null;
  /** The user's own real lines, chosen near the line being answered. */
  examples: string[];
}

/**
 * The system prompt for the replica of the user.
 *
 * The person's lines are material: they are what the user said, not
 * instructions. The instruction says who is playing whom, and that the
 * replica must not speak for the other character.
 */
export function buildSelfPrompt(input: SelfPromptInput): string {
  const { personaName, locale } = input;
  const prose = describeFingerprint(input.userSide?.fingerprint, locale)
    .map((line) => line.text)
    .join("\n");
  const samples = (input.userSide?.sampleLines ?? []).slice(0, 12).join("\n");
  const examples = input.examples.slice(0, 6).join("\n");
  const block = [prose, samples, examples].filter(Boolean).join("\n\n");
  const instruction = copy(locale, "roleplay.system", { name: personaName });
  if (!block.trim()) return instruction;
  return [
    instruction,
    copy(locale, "roleplay.materialHeading"),
    asMaterial(block, locale),
  ].join("\n\n");
}

export interface RoleplayTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}

/** How many milliseconds are left in the practice. */
export function remainingMs(startedAt: Date, now: Date): number {
  return Math.max(0, ROLEPLAY_MAX_MINUTES * 60_000 - (now.getTime() - startedAt.getTime()));
}
