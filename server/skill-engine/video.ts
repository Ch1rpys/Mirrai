/**
 * What a video can contribute to a distillation (B7.10).
 *
 * Two things: a few frames the vision model can look at, and the words
 * spoken in it when a local transcription engine is installed. The
 * files themselves are never sent anywhere.
 *
 * ffmpeg is optional. Without it a video is stored and not read, and
 * the interface says so rather than pretending the video was watched.
 *
 * The temporary files live in the system temp directory and are
 * removed in a `finally`, so a failed run leaves nothing behind.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getFilesByPersonaId,
  listMedia,
  setMediaTranscript,
  setMediaVideoMeta,
  upsertMedia,
} from "../db";
import {
  extractKeyframes,
  hasFfmpeg,
  probe,
  toWav16k,
} from "../_core/ffmpeg";
import { mediaAbsPath, mimeForFile } from "../importers/media";
import { transcribeAudio } from "../_core/stt";

/** One distillation reads at most this many videos… */
export const VIDEO_MAX_PER_RUN = 4;
/** …and this many frames in all (three per video). */
export const VIDEO_MAX_FRAMES = 12;

export interface VideoMaterial {
  /** Frames as data URLs, ready for the vision model. */
  frameDataUrls: string[];
  /** What was said, when a local engine could hear it. */
  transcripts: string[];
  /** Videos that were over the per-run limit. */
  skipped: number;
}

const EMPTY: VideoMaterial = { frameDataUrls: [], transcripts: [], skipped: 0 };

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function keyOfUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const marker = "/uploads/";
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const key = url.slice(at + marker.length);
  return key || null;
}

async function dataUrlOf(filePath: string): Promise<string | null> {
  try {
    const bytes = await readFile(filePath);
    if (bytes.length === 0) return null;
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

interface VideoSource {
  id: number | null;
  fileKey: string;
}

/**
 * Registers an uploaded video so it is part of the same table as an
 * imported one.
 *
 * Its content hash is the identity: uploading the same file twice does
 * not make two recordings.
 */
async function registerUploadedVideos(
  personaId: number,
  userId: number,
): Promise<VideoSource[]> {
  const files = await getFilesByPersonaId(personaId, userId);
  const out: VideoSource[] = [];
  for (const file of files) {
    if (file.fileType !== "video") continue;
    const fileKey = keyOfUrl(file.fileUrl);
    if (!fileKey) continue;
    let abs: string;
    try {
      abs = mediaAbsPath(fileKey);
      const info = await stat(abs);
      if (!info.isFile()) continue;
      const hash = await hashFile(abs);
      const row = await upsertMedia({
        userId,
        personaId,
        kind: "video",
        fileKey,
        mime: mimeForFile(fileKey),
        bytes: info.size,
        hash,
        at: new Date(),
        recordId: null,
        fileId: file.id,
        fromThem: false,
      });
      out.push({ id: row.id, fileKey });
    } catch {
      // The upload is gone, or the database is not reachable: the run
      // still goes ahead without this video.
    }
  }
  return out;
}

/**
 * The frames and the spoken words of a persona's videos.
 *
 * Runs only when ffmpeg is installed. A missing transcription engine
 * leaves the frames and no words — the video is still watched silently
 * rather than described as something it is not.
 */
export async function prepareVideoMaterial(params: {
  personaId: number;
  userId: number;
}): Promise<VideoMaterial> {
  if (!(await hasFfmpeg())) return { ...EMPTY };

  const sources = new Map<string, VideoSource>();
  for (const row of await listMedia(params.personaId, params.userId, { kind: "video" })) {
    sources.set(row.fileKey, { id: row.id, fileKey: row.fileKey });
  }
  for (const uploaded of await registerUploadedVideos(params.personaId, params.userId)) {
    if (!sources.has(uploaded.fileKey)) sources.set(uploaded.fileKey, uploaded);
  }

  const all = [...sources.values()];
  if (all.length === 0) return { ...EMPTY };
  const selected = all.slice(0, VIDEO_MAX_PER_RUN);
  const skipped = Math.max(0, all.length - selected.length);

  let tempDir: string | null = null;
  const frameDataUrls: string[] = [];
  const transcripts: string[] = [];
  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mirrai-video-"));
    for (const [index, video] of selected.entries()) {
      const abs = mediaAbsPath(video.fileKey);
      const info = await probe(abs).catch(() => null);
      if (!info) continue;
      if (video.id != null) {
        await setMediaVideoMeta(video.id, params.userId, {
          durationSec: info.durationSec == null ? null : Math.round(info.durationSec),
          width: info.width,
          height: info.height,
        }).catch(() => {});
      }
      if (info.hasVideo) {
        const frames = await extractKeyframes(abs, path.join(tempDir, `v${index}`), 3).catch(
          () => [] as string[],
        );
        for (const frame of frames) {
          if (frameDataUrls.length >= VIDEO_MAX_FRAMES) break;
          const dataUrl = await dataUrlOf(frame);
          if (dataUrl) frameDataUrls.push(dataUrl);
        }
      }
      if (info.hasAudio) {
        try {
          const wav = path.join(tempDir, `a${index}.wav`);
          await toWav16k(abs, wav);
          const heard = await transcribeAudio({
            filePath: wav,
            fileName: `video-${index}.wav`,
            purpose: "import",
          });
          if (heard?.text) {
            transcripts.push(heard.text);
            if (video.id != null) {
              await setMediaTranscript(video.id, params.userId, heard.text, heard.engine).catch(
                () => {},
              );
            }
          }
        } catch {
          // No local speech engine, or this soundtrack could not be
          // read: the frames still count.
        }
      }
    }
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  return { frameDataUrls, transcripts, skipped };
}
