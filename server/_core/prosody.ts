import { getPersonaStyleProfile, listMedia, setPersonaStyleProfile } from "../db";
import { hasFfmpeg, silenceRatio } from "./ffmpeg";
import { mediaAbsPath } from "../importers/media";
import { normalizeStyleProfile } from "@shared/style-profile";
import type { ProsodyProfile } from "@shared/prosody";

/**
 * Measuring how the person speaks.
 *
 * Only the recordings that have a transcript count: the rate is
 * characters spoken per second, and there is no way to know how many
 * characters were said without the words. Eight recordings is the
 * floor — fewer and the median is a guess.
 *
 * The silence measurement is optional. Without ffmpeg the rate is
 * still measured, and the two pause numbers simply do not exist; they
 * are not filled with defaults.
 */
export const PROSODY_MIN_SAMPLES = 8;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export async function measureProsody(params: {
  personaId: number;
  userId: number;
}): Promise<ProsodyProfile | null> {
  const rows = (await listMedia(params.personaId, params.userId, {
    kind: "voice",
    fromThem: true,
  })).filter(
    (row) =>
      typeof row.transcript === "string" &&
      row.transcript.trim().length > 0 &&
      typeof row.durationSec === "number" &&
      row.durationSec > 0,
  );
  if (rows.length < PROSODY_MIN_SAMPLES) return null;

  const rates = rows.map(
    (row) => Array.from(row.transcript!.trim()).length / row.durationSec!,
  );

  const pauses: number[] = [];
  const tails: number[] = [];
  if (await hasFfmpeg()) {
    for (const row of rows) {
      try {
        const report = await silenceRatio(mediaAbsPath(row.fileKey));
        if (!report) continue;
        pauses.push(report.ratio);
        tails.push(report.tailSec);
      } catch {
        // One unreadable file does not lose the rest.
      }
    }
  }

  const prosody: ProsodyProfile = {
    charsPerSec: median(rates),
    samples: rows.length,
    ...(pauses.length > 0 ? { pauseRatio: median(pauses) } : {}),
    ...(tails.length > 0 ? { tailSec: median(tails) } : {}),
  };

  /**
   * The measurement lives on the voice profile. Without one there is
   * nowhere to put it — a prosody with no voice rate would be a
   * reading with no decision attached — so it is returned and not
   * stored.
   */
  const stored = normalizeStyleProfile(
    await getPersonaStyleProfile(params.personaId, params.userId),
  );
  if (stored.voice) {
    stored.voice.prosody = prosody;
    await setPersonaStyleProfile(params.personaId, params.userId, stored);
  }
  return prosody;
}
