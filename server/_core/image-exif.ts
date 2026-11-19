/**
 * What a photograph says about itself.
 *
 * A picture taken on a phone carries the moment it was taken and, when
 * the phone was allowed to, the place. Reading that is what makes a
 * memory and a photo line up on the same afternoon instead of the same
 * import.
 *
 * EXIF timestamps have no time zone. They are the camera's wall clock,
 * so they are read in the user's zone — the same rule the importers use
 * for an export file.
 *
 * A file with no EXIF is not an error: it simply has no time and no
 * place, and the app falls back to when it was uploaded.
 */
import exifr from "exifr";
import { parseZoneless } from "@shared/timezone";

export interface ImageExif {
  /** When the camera says the picture was taken, read in the user's zone. */
  at: Date | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
}

const EMPTY: ImageExif = { at: null, lat: null, lng: null, width: null, height: null };

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * EXIF writes "2022:04:02 12:00:00"; the app's parser reads
 * "2022-04-02 12:00:00".
 */
export function exifDateToWallClock(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}

/**
 * Reads the tags the app uses, from a path or a buffer.
 *
 * `reviveValues: false` keeps the date as the string the camera wrote,
 * so it can be interpreted in the right zone instead of the server's.
 */
export async function readImageExif(
  input: string | Buffer,
  timeZone?: string | null,
): Promise<ImageExif> {
  let parsed: Record<string, unknown>;
  try {
    parsed = (await exifr.parse(input as never, {
      reviveValues: false,
      tiff: true,
      exif: true,
      gps: true,
    })) as Record<string, unknown>;
  } catch {
    return { ...EMPTY };
  }
  if (!parsed || typeof parsed !== "object") return { ...EMPTY };

  const wallClock =
    exifDateToWallClock(parsed.DateTimeOriginal) ??
    exifDateToWallClock(parsed.CreateDate) ??
    exifDateToWallClock(parsed.ModifyDate);
  const at = wallClock ? parseZoneless(wallClock, timeZone) : null;

  return {
    at,
    lat: asNumber(parsed.latitude) ?? asNumber(parsed.GPSLatitude),
    lng: asNumber(parsed.longitude) ?? asNumber(parsed.GPSLongitude),
    width:
      asNumber(parsed.ExifImageWidth) ??
      asNumber(parsed.ImageWidth) ??
      asNumber(parsed.PixelXDimension),
    height:
      asNumber(parsed.ExifImageHeight) ??
      asNumber(parsed.ImageHeight) ??
      asNumber(parsed.PixelYDimension),
  };
}
