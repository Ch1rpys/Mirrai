/**
 * What kind of image a decoded upload really is.
 *
 * The extension and the declared MIME type are the client's word. The
 * bytes are the file. Only three kinds are accepted for an avatar or a
 * chat background, and they are recognised from their magic numbers.
 */

export type PersonaImageKind = "jpeg" | "png" | "webp";

export const PERSONA_IMAGE_MIME: Record<PersonaImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function sniffPersonaImage(buffer: Buffer): PersonaImageKind | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Decodes a data URL or a bare base64 string.
 *
 * Returns null when the string is not base64 at all. The size limit is
 * checked on the decoded bytes, not on the string.
 */
export function decodeBase64Image(value: string, maxBytes: number): Buffer | null {
  const comma = value.indexOf(",");
  const base64 = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > maxBytes) return null;
  return buffer;
}
