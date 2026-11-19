/**
 * Speaking rate and pauses, mapped onto the one engine that takes them.
 *
 * Pitch is not measured and the voice is not cloned — B7.7 decided
 * that. What is carried over is how fast the person talks and how they
 * leave a gap, which are the two things the synthesiser can actually
 * do something about.
 *
 * The tail silence is measured and not mapped: none of the three
 * engines exposes a parameter for it, and pretending otherwise would be
 * a setting that does nothing.
 */
import type { Locale } from "./copy";

export interface ProsodyProfile {
  /** Characters spoken per second, measured from transcripts. */
  charsPerSec: number;
  /** The share of the recording that is silence, when ffmpeg measured it. */
  pauseRatio?: number;
  /** Silence after the last word, in seconds, when ffmpeg measured it. */
  tailSec?: number;
  /** How many recordings the numbers came from. */
  samples: number;
}

/**
 * The pace of a neutral reading.
 *
 * Approximate, and deliberately so: it is the number that makes a
 * measured 4.2 characters a second come out as "no change". Four to
 * five characters a second is the usual range for Mandarin speech; for
 * English, about fifteen characters a second.
 */
export const PROSODY_BASIS: Record<Locale, number> = {
  zh: 4.2,
  en: 15,
};

export interface TtsDirection {
  /** How much faster or slower than the neutral pace, in percent. */
  ratePercent: number;
  /** The text as the synthesiser should receive it. */
  prepare(text: string): string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Turns a measurement into what the read-aloud is given.
 *
 * The rate is clamped to ±30%: beyond that the words stop being
 * intelligible, and the measurement is a median of a few dozen
 * recordings, not a lab result.
 */
export function prosodyToTts(prosody: ProsodyProfile, locale: Locale): TtsDirection {
  const basis = PROSODY_BASIS[locale] ?? PROSODY_BASIS.zh;
  const measured = Number.isFinite(prosody.charsPerSec) && prosody.charsPerSec > 0
    ? prosody.charsPerSec
    : basis;
  const ratePercent = clamp(Math.round((measured / basis - 1) * 100), -30, 30);
  const deepPauses = typeof prosody.pauseRatio === "number" && prosody.pauseRatio >= 0.25;

  return {
    ratePercent,
    prepare(text: string): string {
      return prepareForSpeech(text, { markSpaces: true, lengthenEllipsis: deepPauses });
    },
  };
}

/**
 * The text a synthesiser should read.
 *
 * The person typed with spaces where they would have paused — a
 * synthesiser reads a space as almost nothing — so a space between two
 * Han characters becomes a comma. Nobody's characters change; only
 * punctuation is added.
 */
export function prepareForSpeech(
  text: string,
  options: { markSpaces?: boolean; lengthenEllipsis?: boolean } = {},
): string {
  let next = String(text ?? "");
  if (options.markSpaces !== false) {
    next = next.replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, "$1，");
  }
  if (options.lengthenEllipsis) {
    next = next.replace(/\.{3,}|…/g, "……");
  }
  return next;
}

/**
 * Reads a stored measurement.
 *
 * It has to have a rate and at least one recording behind it. The
 * pauses may be missing: they are only measured when ffmpeg is there,
 * and a missing pause is not a zero pause.
 */
export function normalizeProsody(value: unknown): ProsodyProfile | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.charsPerSec !== "number" || source.charsPerSec <= 0) return null;
  if (typeof source.samples !== "number" || source.samples < 1) return null;
  return {
    charsPerSec: source.charsPerSec,
    samples: source.samples,
    ...(typeof source.pauseRatio === "number" ? { pauseRatio: source.pauseRatio } : {}),
    ...(typeof source.tailSec === "number" ? { tailSec: source.tailSec } : {}),
  };
}
