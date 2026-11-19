/**
 * Sending a reply as a voice note (B7.4).
 *
 * The decision is made *before* the reply is generated, because a
 * voice-note turn must not stream: the words must not appear on the
 * screen first and turn into audio afterwards.
 *
 * The engine is the synthesised one — a neutral voice, never the
 * person's own. The interface says so on every such bubble; this file
 * only decides whether one is sent.
 */
import { generateTTS, DEFAULT_VOICE, ttsEngine } from "../_core/tts";
import { normalizeStyleProfile } from "@shared/style-profile";
import {
  estimateSpeechSeconds,
  normalizeVoiceStats,
  VOICE_STATE_MIN_TURNS,
  type VoiceStats,
} from "@shared/voice-stats";
import { seededRandom } from "../_core/behavior-profile";
import { normalizeProsody, prosodyToTts, type TtsDirection } from "@shared/prosody";
import type { Locale } from "@shared/copy";

export interface VoiceNoteDecision {
  stats: VoiceStats;
}

/** How this persona's speech should be read, when it was measured. */
export function prosodyDirection(
  styleProfile: unknown,
  locale: Locale,
): TtsDirection | null {
  const prosody = normalizeProsody(
    normalizeStyleProfile(styleProfile).voice?.prosody,
  );
  return prosody ? prosodyToTts(prosody, locale) : null;
}

export function pickVoiceNoteForTurn(params: {
  styleProfile?: unknown;
  state: string | null;
  seed: string;
  channel: string | null;
  enabled: boolean;
}): VoiceNoteDecision | null {
  if (!params.enabled) return null;
  if ((params.channel ?? "web") !== "web") return null;
  if (ttsEngine() === "off") return null;

  const stats = normalizeVoiceStats(normalizeStyleProfile(params.styleProfile).voice);
  if (!stats) return null;

  const bucket = stats.byState[params.state ?? ""];
  const rate = bucket && bucket.turns >= VOICE_STATE_MIN_TURNS ? bucket.rate : stats.rate;
  if (!(rate > 0)) return null;

  const rng = seededRandom(`${params.seed}:voice-note`);
  return rng() < rate ? { stats } : null;
}

/**
 * Turns a finished reply into a voice note, or says it cannot.
 *
 * The bound is the measured p90: a line much longer than what they
 * usually record is sent as text, because a two-minute robot reading
 * is not more like them.
 */
export async function makeVoiceNote(params: {
  text: string;
  userId: number;
  stats: VoiceStats;
  styleProfile?: unknown;
  locale: Locale;
}): Promise<{ url: string; durationSec: number } | null> {
  /**
   * The bound is measured on what was typed, not on the prepared text:
   * the commas added for the pauses are the synthesiser's, not theirs.
   */
  const durationSec = estimateSpeechSeconds(params.text);
  if (durationSec <= 0) return null;
  if (durationSec > params.stats.durationSec.p90) return null;

  const direction = prosodyDirection(params.styleProfile, params.locale);
  const url = await generateTTS(
    direction ? direction.prepare(params.text) : params.text,
    DEFAULT_VOICE,
    params.userId,
    direction ? { ratePercent: direction.ratePercent } : {},
  ).catch(() => null);
  if (!url) return null;
  return { url, durationSec };
}
