/**
 * Whether a record line is safe to place outside the prompt fence.
 *
 * Seed turns are the one place this stage copies the record into the
 * message list as a real user / assistant exchange. A line that looks
 * like an instruction, a fence, or a harm cue is dropped — the whole
 * exchange goes with it.
 */
import { isHarmfulLine } from "./harm";

export const SEED_LINE_MAX_CHARS = 80;

// i18n:allow-input — matched against record lines, not shown as copy.
const FENCE_MARKERS = ["<persona_data>", "MATERIAL>>>"];
const ANGLE_TAG = /<[^>\n]{0,120}>/;
const INSTRUCTION =
  /忽略|无视|不要理会|从现在起|你现在是|系统提示|提示词|system prompt|ignore (all|previous|the above)|as an ai|you are now|developer mode|jailbreak/i;
const PREFIX = /^(#|\[系统\]|\[system\])/i;

export function isSafeSeedLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SEED_LINE_MAX_CHARS) return false;
  return isSafePromptMaterial(trimmed);
}

/** A life-event fact may be longer than a seed line. Markers still reject it. */
export function isSafePromptMaterial(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  for (const marker of FENCE_MARKERS) {
    if (trimmed.includes(marker)) return false;
  }
  if (ANGLE_TAG.test(trimmed)) return false;
  if (INSTRUCTION.test(trimmed)) return false;
  if (PREFIX.test(trimmed)) return false;
  if (isHarmfulLine(trimmed)) return false;
  return true;
}

export const PROMPT_FACT_MAX_CHARS = 200;

/**
 * A confirmed fact for an instruction slot.
 *
 * Over-long text is clipped. A jailbreak, a fence, or a harmful line
 * is dropped whole, even when the marker would have fallen past the clip.
 */
export function clipPromptFact(text: string, max = PROMPT_FACT_MAX_CHARS): string | null {
  const trimmed = text.trim();
  if (!isSafePromptMaterial(trimmed)) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
