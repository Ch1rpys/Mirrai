/**
 * The songs shared in the record (C2.8)
 *
 * A `music` row, merged by title and artist. Only an http(s) link is
 * offered as a link; anything else is shown as text and not clicked.
 */
import * as db from "../db";
import { isSafeMediaUrl } from "@shared/safe-url";

export { isSafeMediaUrl };

export interface SongRow {
  id: number;
  role: string;
  kind: string;
  timestamp: Date | null;
  createdAt: Date;
  meta?: unknown;
}

export interface Song {
  title: string;
  artist?: string;
  url?: string;
  count: number;
  first: string;
  sharedByMe: number;
  sharedByThem: number;
}

export function collectSongsFromRows(rows: SongRow[]): Song[] {
  const songs = new Map<string, Song>();
  for (const row of rows) {
    if (row.kind !== "music") continue;
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const title = typeof meta.title === "string" ? meta.title.trim() : "";
    if (!title) continue;
    const artist = typeof meta.artist === "string" ? meta.artist.trim() : "";
    const url = typeof meta.url === "string" ? meta.url : "";
    const key = `${title}\u0000${artist}`;
    const at = (row.timestamp ?? row.createdAt).toISOString();
    const sharedByMe = row.role === "user" ? 1 : 0;
    const sharedByThem = row.role === "assistant" ? 1 : 0;
    const existing = songs.get(key);
    if (!existing) {
      songs.set(key, {
        title,
        ...(artist ? { artist } : {}),
        ...(url ? { url } : {}),
        count: 1,
        first: at,
        sharedByMe,
        sharedByThem,
      });
      continue;
    }
    existing.count += 1;
    existing.sharedByMe += sharedByMe;
    existing.sharedByThem += sharedByThem;
    if (!existing.url && url) existing.url = url;
    if (at < existing.first) existing.first = at;
  }
  return [...songs.values()].sort(
    (a, b) => b.count - a.count || a.first.localeCompare(b.first),
  );
}

export async function collectSongs(params: {
  personaId: number;
  userId: number;
}): Promise<Song[]> {
  const rows: SongRow[] = [];
  for await (const row of db.iterateRecords(params.personaId, params.userId, {
    kinds: ["music"],
  })) {
    rows.push({
      id: row.id,
      role: row.role,
      kind: row.kind,
      timestamp: row.timestamp,
      createdAt: row.createdAt,
      meta: row.meta,
    });
  }
  return collectSongsFromRows(rows);
}
