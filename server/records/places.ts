/**
 * The places in the record (C2.8)
 *
 * A location message and a photograph's EXIF are the only two sources.
 * A place is merged by its name; without a name, by its coordinates
 * rounded to about a hundred metres.
 */
import * as db from "../db";

export interface PlaceRow {
  id: number;
  kind: string;
  timestamp: Date | null;
  createdAt: Date;
  meta?: unknown;
}

export interface PlaceMedia {
  id: number;
  at: Date | null;
  exif?: unknown;
  /** The stored file, so a photo can be opened from the list. */
  fileKey?: string | null;
}

export interface PlaceSample {
  recordId?: number;
  mediaId?: number;
  at: string;
  /** A photo's stored URL, when the sample is a photograph. */
  url?: string;
}

export interface Place {
  name: string;
  lat?: number;
  lng?: number;
  count: number;
  first: string;
  last: string;
  samples: PlaceSample[];
}

function coords(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lng ?? raw.longitude ?? raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function keyOf(name: string, point: { lat: number; lng: number } | null): string {
  if (name) return `name:${name}`;
  if (!point) return "unknown";
  return `at:${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
}

export function collectPlacesFromRows(
  records: PlaceRow[],
  mediaRows: PlaceMedia[],
): Place[] {
  const places = new Map<string, Place>();
  const add = (
    name: string,
    point: { lat: number; lng: number } | null,
    at: Date,
    sample: PlaceSample,
  ) => {
    const key = keyOf(name, point);
    const existing = places.get(key);
    if (!existing) {
      places.set(key, {
        name: name || `${point?.lat.toFixed(3) ?? "?"}, ${point?.lng.toFixed(3) ?? "?"}`,
        ...(point ? { lat: point.lat, lng: point.lng } : {}),
        count: 1,
        first: at.toISOString(),
        last: at.toISOString(),
        samples: [sample],
      });
      return;
    }
    existing.count += 1;
    if (at.getTime() < new Date(existing.first).getTime()) existing.first = at.toISOString();
    if (at.getTime() > new Date(existing.last).getTime()) existing.last = at.toISOString();
    if (existing.samples.length < 20) existing.samples.push(sample);
  };

  for (const row of records) {
    if (row.kind !== "location") continue;
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const name = typeof meta.name === "string" ? meta.name.trim() : "";
    const point = coords(meta);
    const at = row.timestamp ?? row.createdAt;
    add(name, point, at, { recordId: row.id, at: at.toISOString() });
  }

  for (const media of mediaRows) {
    if (!media.at) continue;
    const point = coords(media.exif);
    if (!point) continue;
    add("", point, media.at, {
      mediaId: media.id,
      at: media.at.toISOString(),
      ...(media.fileKey ? { url: `/uploads/${media.fileKey}` } : {}),
    });
  }

  return [...places.values()].sort(
    (a, b) => b.count - a.count || a.first.localeCompare(b.first),
  );
}

export async function collectPlaces(params: {
  personaId: number;
  userId: number;
}): Promise<Place[]> {
  const records: PlaceRow[] = [];
  for await (const row of db.iterateRecords(params.personaId, params.userId, {
    kinds: ["location"],
  })) {
    records.push({
      id: row.id,
      kind: row.kind,
      timestamp: row.timestamp,
      createdAt: row.createdAt,
      meta: row.meta,
    });
  }
  const media = await db.listMedia(params.personaId, params.userId, { kind: "photo" });
  return collectPlacesFromRows(
    records,
    media.map((row) => ({ id: row.id, at: row.at, exif: row.exif, fileKey: row.fileKey })),
  );
}
