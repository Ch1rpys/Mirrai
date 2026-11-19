/**
 * Sending a real photograph with a reply (B7.9).
 *
 * A picture is only ever one the user attached to a memory the reply
 * recalled. There is no fallback to a random photo and no generated
 * image: if nothing relevant is attached, nothing is sent.
 *
 * The decision is made after the words and the mood, like a sticker.
 */
import { seededRandom } from "../_core/behavior-profile";
import { listMemoryMediaForMemories, listRecentlySentPhotoMediaIds } from "../db";
import { normalizeStyleProfile } from "@shared/style-profile";
import {
  normalizePhotoStats,
  PHOTO_STATE_MIN_TURNS,
  type PhotoStats,
} from "@shared/photo-stats";

/** A picture is not sent again within this many days. */
export const PHOTO_REPEAT_DAYS = 30;

export interface PhotoPick {
  mediaId: number;
  url: string;
  at: Date | null;
}

export async function pickPhotoForTurn(params: {
  personaId: number;
  userId: number;
  styleProfile?: unknown;
  state: string | null;
  seed: string;
  channel: string | null;
  enabled: boolean;
  /** The memories the reply drew on. */
  memoryIds: number[];
  now?: Date;
}): Promise<PhotoPick | null> {
  // Photos are a web-chat form; a channel sends text, and an
  // evaluation must not change the words.
  if (!params.enabled) return null;
  if ((params.channel ?? "web") !== "web") return null;

  const stats = normalizePhotoStats(normalizeStyleProfile(params.styleProfile).photos);
  if (!stats) return null;

  const state = params.state ?? "";
  const bucket = stats.byState[state];
  const useState = Boolean(bucket && bucket.turns >= PHOTO_STATE_MIN_TURNS);
  const rate = useState ? bucket!.rate : stats.rate;
  if (!(rate > 0)) return null;

  // Its own seed: the plan rng has already drawn on the act, the burst,
  // the delay and the sticker.
  const rng = seededRandom(`${params.seed}:photo`);
  if (rng() >= rate) return null;

  if (params.memoryIds.length === 0) return null;
  const attached = await listMemoryMediaForMemories(params.memoryIds, params.userId);
  if (attached.length === 0) return null;

  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - PHOTO_REPEAT_DAYS * 86_400_000);
  const sent = new Set(
    await listRecentlySentPhotoMediaIds(params.personaId, params.userId, since),
  );

  const available = attached.filter((photo) => !sent.has(photo.mediaId));
  if (available.length === 0) return null;

  const index = Math.min(available.length - 1, Math.floor(rng() * available.length));
  const chosen = available[index]!;
  return {
    mediaId: chosen.mediaId,
    url: `/uploads/${chosen.fileKey}`,
    at: chosen.at ?? null,
  };
}

/** The rate this state would use, for the measurement report. */
export function photoRateForState(stats: PhotoStats, state: string | null): number {
  const bucket = state ? stats.byState[state] : undefined;
  return bucket && bucket.turns >= PHOTO_STATE_MIN_TURNS ? bucket.rate : stats.rate;
}
