/**
 * Sending a sticker with a reply (B7.1).
 *
 * The decision happens after the words are settled and the mood is
 * known: how often this person sends one in this mood, and which one.
 * Only a sticker they really sent can be chosen, and only from what is
 * still enabled — an empty library sends nothing.
 */
import { seededRandom } from "../_core/behavior-profile";
import { listEnabledStickers } from "../db";
import { normalizeStyleProfile } from "@shared/style-profile";
import {
  normalizeStickerStats,
  STICKER_STATE_MIN_TURNS,
  type StickerStats,
} from "@shared/sticker-stats";

export interface StickerPick {
  stickerId: number;
  label: string;
  key: string;
  imageUrl: string | null;
}

/**
 * The sticker counts to draw from when the mood has too few turns.
 *
 * A state with fewer than the minimum turns has a rate that is mostly
 * noise. The overall rate is used then, but the *choice* still comes
 * from the names the record used — every state's list, by count.
 */
function pooledTop(stats: StickerStats): Array<{ key: string; n: number }> {
  const counts = new Map<string, number>();
  for (const bucket of Object.values(stats.byState)) {
    for (const entry of bucket.top) {
      counts.set(entry.key, (counts.get(entry.key) ?? 0) + entry.n);
    }
  }
  return [...counts.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

function weightedPick(
  entries: Array<{ key: string; n: number }>,
  random: number,
): string | null {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.n), 0);
  if (total <= 0) return null;
  let threshold = random * total;
  for (const entry of entries) {
    threshold -= Math.max(0, entry.n);
    if (threshold < 0) return entry.key;
  }
  return entries[entries.length - 1]?.key ?? null;
}

export async function pickStickerForTurn(params: {
  personaId: number;
  userId: number;
  styleProfile?: unknown;
  state: string | null;
  seed: string;
  channel: string | null;
  enabled: boolean;
}): Promise<StickerPick | null> {
  // Stickers are a web-chat form. A channel sends text, and an
  // evaluation must not change the words.
  if (!params.enabled) return null;
  if ((params.channel ?? "web") !== "web") return null;

  const stats = normalizeStickerStats(normalizeStyleProfile(params.styleProfile).stickers);
  if (!stats) return null;

  const state = params.state ?? "";
  const bucket = stats.byState[state];
  const useState = Boolean(bucket && bucket.turns >= STICKER_STATE_MIN_TURNS);
  const rate = useState ? bucket!.rate : stats.rate;
  if (!(rate > 0)) return null;

  // Its own seed: the plan rng has already drawn on the act, the burst
  // and the delay, and a second draw on the same stream would move them.
  const rng = seededRandom(`${params.seed}:sticker`);
  if (rng() >= rate) return null;

  const library = await listEnabledStickers(params.personaId, params.userId);
  if (library.length === 0) return null;

  const byName = new Map<string, (typeof library)[number]>();
  for (const row of library) {
    if (!byName.has(row.label)) byName.set(row.label, row);
    if (!byName.has(row.key)) byName.set(row.key, row);
  }
  const candidates = (useState ? bucket!.top : pooledTop(stats)).filter((entry) =>
    byName.has(entry.key),
  );
  if (candidates.length === 0) return null;

  const chosen = weightedPick(candidates, rng());
  if (!chosen) return null;
  const row = byName.get(chosen);
  if (!row) return null;

  return {
    stickerId: row.id,
    label: row.label,
    key: row.key,
    imageUrl: row.fileKey ? `/uploads/${row.fileKey}` : null,
  };
}
