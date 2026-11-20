import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./env";
import { resolveUploadPath } from "./filename";
import { subprocessEnvironment } from "./subprocess-env";
import { runBinary } from "./run-binary";

/**
 * The local media tools.
 *
 * Everything here is optional. The app has to start and work with no
 * ffmpeg installed — voice notes are transcribed by the configured
 * provider, videos are stored but not read, and the loss is said in
 * the interface rather than hidden. Every function returns null (or
 * throws only to its own caller) instead of taking a request down.
 *
 * Input and output paths are resolved against the uploads directory
 * unless they are already absolute: the pipeline hands over temp files,
 * and everything else is an upload key.
 */

export interface MediaProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface SilenceReport {
  /** The share of the file that is silence, 0–1. */
  ratio: number;
  /** How much silence trails the last sound, in seconds. */
  tailSec: number;
  totalSec: number;
}

function resolveMediaPath(input: string): string {
  if (path.isAbsolute(input)) return path.resolve(input);
  return resolveUploadPath(ENV.uploadDir, input);
}

/** Whether ffmpeg is on this machine. */
export async function hasFfmpeg(): Promise<boolean> {
  try {
    await runBinary("ffmpeg", ["-version"], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file's duration and streams.
 *
 * `ffmpeg -i <file>` exits with 1 after printing the stream
 * information — there is no output file — so the exit code is not a
 * failure here. The duration line looks like:
 *
 *     Duration: 00:00:12.34, start: 0.000000, bitrate: 48 kb/s
 */
export async function probe(input: string): Promise<MediaProbe | null> {
  let stderr: string;
  try {
    const result = await runBinary(
      "ffmpeg",
      ["-hide_banner", "-i", resolveMediaPath(input)],
      { allowFailure: true, env: subprocessEnvironment() },
    );
    stderr = result.stderr;
  } catch {
    return null;
  }

  const durationMatch = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const widthHeight = /Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  const hasAudio = /Stream #\d+:\d+.*?: Audio: /.test(stderr);
  const hasVideo = Boolean(widthHeight);
  if (!durationMatch && !hasAudio && !hasVideo) return null;

  return {
    durationSec: durationMatch
      ? Number(durationMatch[1]) * 3600 +
        Number(durationMatch[2]) * 60 +
        Number(durationMatch[3])
      : null,
    width: widthHeight ? Number(widthHeight[1]) : null,
    height: widthHeight ? Number(widthHeight[2]) : null,
    hasAudio,
    hasVideo,
  };
}

/**
 * Converts anything ffmpeg can read into the one format whisper.cpp
 * takes: 16 kHz mono 16-bit WAV.
 */
export async function toWav16k(input: string, output: string): Promise<string> {
  const source = resolveMediaPath(input);
  const target = resolveMediaPath(output);
  await mkdir(path.dirname(target), { recursive: true });
  await runBinary(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      target,
    ],
    { env: subprocessEnvironment() },
  );
  return target;
}

/**
 * Takes a few evenly spaced frames out of a video.
 *
 * Three is the number the distillation reads: enough to say what the
 * place looked like, few enough that a dozen videos do not spend the
 * image-description budget of a whole persona. The width is 768
 * because that is what the vision model is shown anyway — a 4K frame
 * costs tokens and adds nothing.
 */
export async function extractKeyframes(
  input: string,
  outDir: string,
  max = 3,
): Promise<string[]> {
  const info = await probe(input);
  if (!info?.durationSec || info.durationSec <= 0) return [];
  const count = Math.max(1, Math.min(max, 3));
  const source = resolveMediaPath(input);
  const dir = path.isAbsolute(outDir) ? outDir : resolveUploadPath(ENV.uploadDir, outDir);
  await mkdir(dir, { recursive: true });

  /**
   * The frame width.
   *
   * The vision model is shown 768-wide pictures; a 4K frame costs tokens
   * and adds nothing. A smaller video is left at its own width instead of
   * being enlarged — upscaling adds no detail and only the word "shrink"
   * was missing from the first version.
   */
  const width = info.width && info.width > 0 ? Math.min(768, info.width) : 768;

  const frames: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = (info.durationSec * (index + 0.5)) / count;
    const target = path.join(dir, `frame-${index}.jpg`);
    await runBinary(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        at.toFixed(3),
        "-i",
        source,
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-2`,
        "-q:v",
        "2",
        target,
      ],
      { env: subprocessEnvironment() },
    );
    frames.push(target);
  }
  return frames;
}

/**
 * Measures how much of a recording is silence.
 *
 * B7.5 uses the ratio and the trailing silence to decide how the
 * persona pauses when they speak. The threshold is −35 dB for at least
 * 0.35 s — the point where a gap between sentences stops being
 * background noise and starts being a pause.
 */
export async function silenceRatio(input: string): Promise<SilenceReport | null> {
  const info = await probe(input);
  if (!info?.durationSec || info.durationSec <= 0) return null;

  let stderr: string;
  try {
    const result = await runBinary(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        resolveMediaPath(input),
        "-af",
        "silencedetect=noise=-35dB:d=0.35",
        "-f",
        "null",
        "-",
      ],
      { allowFailure: true, env: subprocessEnvironment() },
    );
    stderr = result.stderr;
  } catch {
    return null;
  }

  // The lines come in order; a start and its end are paired by order,
  // not by looking the value up again (two 2.5-second silences are two
  // different silences).
  const events = [
    ...stderr.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g),
  ];
  if (!events.some((event) => event[1] === "start")) {
    return { ratio: 0, tailSec: 0, totalSec: info.durationSec };
  }

  let openStart: number | null = null;
  let silentSec = 0;
  let tailSec = 0;
  for (const event of events) {
    const at = Number(event[2]);
    if (event[1] === "start") {
      openStart = at;
    } else if (openStart != null) {
      silentSec += Math.max(0, at - openStart);
      openStart = null;
    }
  }
  // The last silence has no end line when the recording ends in silence.
  if (openStart != null) {
    tailSec = Math.max(0, info.durationSec - openStart);
    silentSec += tailSec;
  }
  return {
    ratio: Math.min(1, silentSec / info.durationSec),
    tailSec,
    totalSec: info.durationSec,
  };
}
