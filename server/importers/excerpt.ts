/**
 * The readable opening of an uploaded file (C1.1 file list, C9.6 import).
 *
 * The wizard's file list shows a few lines of what was uploaded. The
 * whole transcript is stored separately; this is only the excerpt, so it
 * is capped rather than read in full.
 */
import { open } from "node:fs/promises";

/** The most characters kept for the file list's excerpt. */
export const MAX_EXTRACTED_CHARS = 500_000;

/** Reads the beginning of a file as UTF-8 text, or undefined when empty. */
export async function excerptHead(absPath: string): Promise<string | undefined> {
  const handle = await open(absPath, "r");
  try {
    const buf = Buffer.alloc(MAX_EXTRACTED_CHARS);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead <= 0) return undefined;
    return buf.subarray(0, bytesRead).toString("utf8").slice(0, MAX_EXTRACTED_CHARS);
  } finally {
    await handle.close();
  }
}
