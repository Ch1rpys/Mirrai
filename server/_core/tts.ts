import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { readdir, stat } from "fs/promises";
import { rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { ENV } from "./env";
import { hasFfmpeg } from "./ffmpeg";
import { assertLocalEndpoint } from "./local-endpoint";
import { runBinary } from "./run-binary";
import { subprocessEnvironment } from "./subprocess-env";
import { copy } from "@shared/copy";
import type { Locale } from "@shared/copy";

const UPLOAD_DIR = ENV.uploadDir || "./uploads";
const TTS_ROOT = path.join(UPLOAD_DIR, "tts");
/**
 * The voice used when nobody picks one.
 *
 * It has to be one of the voices the picker offers, or the picker opens
 * on something that is not in it.
 */
export const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const MAX_TEXT_LENGTH = 500;

/** A voice, with its name in both languages. */
export interface TtsVoice {
  /**
   * The identifier the provider knows the voice by.
   *
   * It is never translated: it is a name in the provider's catalogue, and
   * a voice that changes its id is a voice that stops working.
   */
  id: string;
  /** The name of the voice, in the language it is listed in. */
  label: string;
  /** The name of the voice in the other language. */
  labelEn: string;
  /** The language the voice speaks. */
  locale: Locale;
}

/**
 * The voices the app offers.
 *
 * The voice was hardcoded, so every persona in every language spoke with
 * the same one — and an English user got a Chinese voice reading English
 * words. The voice is part of who somebody is, so it is the user's call.
 *
 * The names are bilingual, because a voice is looked for by name and a
 * name nobody can read is a name nobody can find.
 */
export const TTS_VOICES: TtsVoice[] = [
  {
    id: "zh-CN-XiaoxiaoNeural",
    label: copy("zh", "labels.voice.xiaoxiao"),
    labelEn: copy("en", "labels.voice.xiaoxiao"),
    locale: "zh",
  },
  {
    id: "zh-CN-YunxiNeural",
    label: copy("zh", "labels.voice.yunxi"),
    labelEn: copy("en", "labels.voice.yunxi"),
    locale: "zh",
  },
  {
    id: "zh-CN-XiaoyiNeural",
    label: copy("zh", "labels.voice.xiaoyi"),
    labelEn: copy("en", "labels.voice.xiaoyi"),
    locale: "zh",
  },
  {
    id: "zh-CN-YunyangNeural",
    label: copy("zh", "labels.voice.yunyang"),
    labelEn: copy("en", "labels.voice.yunyang"),
    locale: "zh",
  },
  {
    id: "zh-HK-HiuMaanNeural",
    label: copy("zh", "labels.voice.hiumaan"),
    labelEn: copy("en", "labels.voice.hiumaan"),
    locale: "zh",
  },
  {
    id: "en-US-AriaNeural",
    label: "Aria · female",
    labelEn: "Aria · female",
    locale: "en",
  },
  {
    id: "en-US-GuyNeural",
    label: "Guy · male",
    labelEn: "Guy · male",
    locale: "en",
  },
  {
    id: "en-GB-SoniaNeural",
    label: "Sonia · female (UK)",
    labelEn: "Sonia · female (UK)",
    locale: "en",
  },
  {
    id: "en-US-JennyNeural",
    label: "Jenny · female (warm)",
    labelEn: "Jenny · female (warm)",
    locale: "en",
  },
];

/** A voice, with the name the person choosing it will read. */
export interface LocalisedVoice {
  id: string;
  label: string;
  locale: Locale;
}

/**
 * The voices that suit a language, named in that language.
 *
 * The picker shows the name the person reading it can read, so the
 * label follows the interface rather than the voice.
 */
export function voicesForLocale(locale: Locale): LocalisedVoice[] {
  const matching = TTS_VOICES.filter((voice) => voice.locale === locale);
  const voices = matching.length > 0 ? matching : TTS_VOICES;
  return voices.map((voice) => ({
    id: voice.id,
    label: locale === "en" ? voice.labelEn : voice.label,
    locale: voice.locale,
  }));
}

/**
 * How the read-aloud is synthesised.
 *
 * The online Edge voice was the only one, so "the text never leaves the
 * machine" was false for anybody who pressed the button, and an
 * operator who wanted the promise kept had to switch the whole feature
 * off. Three engines now, chosen by `TTS_ENGINE`:
 *
 * - `edge` (default, the existing behaviour): Microsoft's online
 *   service. The text leaves the machine.
 * - `piper`: a local piper binary. Nothing leaves the machine.
 * - `http`: a local OpenAI-compatible `/audio/speech`. Nothing leaves
 *   the machine unless the address is remote and the operator says so.
 * - `off`: the button is not offered.
 */
export type TtsEngine = "edge" | "piper" | "http" | "off";

/** The engine the environment asks for. */
export function ttsEngine(): TtsEngine {
  if ((process.env.TTS_ENABLED ?? "true").trim().toLowerCase() === "false") return "off";
  const raw = (process.env.TTS_ENGINE ?? "edge").trim().toLowerCase();
  if (raw === "piper" || raw === "http" || raw === "off") return raw;
  return "edge";
}

/** Whether using the read-aloud hands the text to somebody else. */
export function ttsLeavesMachine(): boolean {
  return ttsEngine() === "edge";
}

/**
 * Whether the configured engine has what it needs to run.
 *
 * `ttsLeavesMachine()` says where the text goes; this says whether the
 * engine can synthesise at all. A piper engine with no binary/model and
 * an HTTP engine with no URL are both unusable, and the call mode
 * should refuse to start rather than answering every sentence silently.
 */
export function ttsConfigured(): boolean {
  const engine = ttsEngine();
  if (engine === "off") return false;
  if (engine === "piper") {
    return Boolean(
      (process.env.PIPER_BIN ?? "").trim() && (process.env.PIPER_MODEL ?? "").trim(),
    );
  }
  if (engine === "http") return (process.env.TTS_HTTP_URL ?? "").trim().length > 0;
  return true;
}

function getCacheKey(
  text: string,
  voice: string,
  engine: TtsEngine,
  ratePercent: number,
): string {
  // The engine and the rate are part of what the clip *is*: the same
  // sentence at a different speed is a different file.
  return createHash("sha256")
    .update([text, voice, engine, String(ratePercent)].join("\u0000"))
    .digest("hex")
    .slice(0, 16);
}

/** Clamps a speaking-rate change to something a voice can actually do. */
function clampRatePercent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(-90, Math.min(200, Math.round(value)));
}

/**
 * Runs piper: the text on stdin, a WAV on disk.
 *
 * https://github.com/rhasspy/piper — `--model` and `--output_file`;
 * `--length_scale` is the inverse of the speed, so a 10% faster voice
 * is `1 / 1.1`.
 */
async function synthesizeWithPiper(
  text: string,
  wavPath: string,
  ratePercent: number,
): Promise<void> {
  const bin = (process.env.PIPER_BIN ?? "").trim();
  const model = (process.env.PIPER_MODEL ?? "").trim();
  if (!bin || !model) {
    throw new Error(
      "The read-aloud is set to piper, but PIPER_BIN or PIPER_MODEL is not set.",
    );
  }
  const args = ["--model", model, "--output_file", wavPath];
  if (ratePercent !== 0) {
    args.push("--length_scale", (1 / (1 + ratePercent / 100)).toFixed(3));
  }
  await runBinary(bin, args, { stdin: text, env: subprocessEnvironment() });
}

/**
 * Runs a local OpenAI-compatible speech endpoint.
 *
 * The endpoint is checked like the transcription one: a URL typed into
 * an environment variable must not quietly send a reply to a stranger.
 */
async function synthesizeWithHttp(
  text: string,
  outPath: string,
  ratePercent: number,
): Promise<void> {
  const raw = (process.env.TTS_HTTP_URL ?? "").trim();
  if (!raw) {
    throw new Error("The read-aloud is set to http, but TTS_HTTP_URL is not set.");
  }
  /**
   * The read-aloud endpoint is local-only.
   *
   * The interface says "synthesised on this machine" whenever the
   * engine is not Edge, and `ttsLeavesMachine()` is what it reads. A
   * remote HTTP address would make that sentence false, so there is no
   * switch that sends the text off the machine through this engine.
   * Operators who need a remote voice service should use a provider,
   * which is registered as egress and disclosed separately.
   */
  const url = assertLocalEndpoint(raw);
  const body: Record<string, unknown> = {
    model: (process.env.TTS_HTTP_MODEL ?? "").trim() || "tts-1",
    input: text,
    voice: (process.env.TTS_HTTP_VOICE ?? "").trim() || "alloy",
    response_format: "mp3",
  };
  if (ratePercent !== 0) {
    // The OpenAI speech API expresses speed as a multiplier, not a
    // percentage; the range it documents is 0.25–4.
    body.speed = Math.max(0.25, Math.min(4, 1 + ratePercent / 100));
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (process.env.TTS_HTTP_API_KEY ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `The speech service answered ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

/**
 * How many clips are kept per user.
 *
 * Every distinct (text, voice) pair writes a new file, and nothing ever
 * deleted one: so the uploads directory grew without bound for the life
 * of the install, and on a small container disk it eventually fills and
 * takes the app down.
 *
 * The oldest are let go when the directory is full. The clips are a
 * cache — the text can always be synthesised again — so losing the
 * oldest is not losing anything.
 */
const MAX_CLIPS_PER_USER = 500;

/**
 * Lets the oldest clips go when the user's directory is full.
 */
async function trimClipCache(dir: string): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter(
      (name) => name.endsWith(".mp3") || name.endsWith(".wav"),
    );
  } catch {
    return;
  }
  if (names.length < MAX_CLIPS_PER_USER) return;

  const withTimes = await Promise.all(
    names.map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));
        return { name, at: info.mtimeMs };
      } catch {
        return { name, at: 0 };
      }
    }),
  );
  withTimes.sort((a, b) => a.at - b.at);

  // The newest half is kept; the rest goes.
  const doomed = withTimes.slice(0, Math.floor(withTimes.length / 2));
  await Promise.all(
    doomed.map((entry) => unlink(path.join(dir, entry.name)).catch(() => undefined)),
  );
}

/**
 * Synthesises text to speech and returns the URL of the stored audio.
 *
 * Audio is scoped per user (`tts/<userId>/<hash>.mp3`) so that one user's
 * conversation cannot be addressed by another user's URL.
 *
 * `ratePercent` is how much faster or slower than the voice's own pace
 * the sentence should be read; B7.5 computes it from the recorded
 * prosody. It is part of the cache key — the same words at a different
 * speed are a different clip.
 */
export async function generateTTS(
  text: string,
  voice: string = DEFAULT_VOICE,
  userId?: number,
  options: { ratePercent?: number } = {},
): Promise<string> {
  const engine = ttsEngine();
  if (engine === "off") {
    throw new Error(
      "The read-aloud is switched off. Set TTS_ENABLED=true and TTS_ENGINE=edge, piper or http to use it.",
    );
  }

  const trimmed = text.slice(0, MAX_TEXT_LENGTH);
  const ratePercent = clampRatePercent(options.ratePercent);
  const hash = getCacheKey(trimmed, voice, engine, ratePercent);
  const scope = userId != null ? String(userId) : "shared";
  const dir = path.join(TTS_ROOT, scope);

  // Piper falls back to WAV when there is no ffmpeg; a previously made
  // clip of either kind is a hit.
  const candidates = engine === "piper" ? ["mp3", "wav"] : ["mp3"];
  for (const extension of candidates) {
    if (existsSync(path.join(dir, `${hash}.${extension}`))) {
      return `/uploads/tts/${scope}/${hash}.${extension}`;
    }
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let extension = "mp3";
  if (engine === "edge") {
    const { tts } = await import("edge-tts");
    const rate = ratePercent === 0 ? undefined : `${ratePercent > 0 ? "+" : ""}${ratePercent}%`;
    const audioBuffer = await tts(trimmed, rate ? { voice, rate } : { voice });
    await writeFile(path.join(dir, `${hash}.mp3`), audioBuffer);
  } else if (engine === "piper") {
    const wavPath = path.join(dir, `${hash}.wav`);
    await synthesizeWithPiper(trimmed, wavPath, ratePercent);
    if (await hasFfmpeg()) {
      await runBinary(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          wavPath,
          "-codec:a",
          "libmp3lame",
          "-q:a",
          "4",
          path.join(dir, `${hash}.mp3`),
        ],
        { env: subprocessEnvironment() },
      );
      await unlink(wavPath).catch(() => undefined);
    } else {
      extension = "wav";
    }
  } else {
    await synthesizeWithHttp(trimmed, path.join(dir, `${hash}.mp3`), ratePercent);
  }

  // The cache is bounded, so the directory cannot grow for ever.
  await trimClipCache(dir);

  return `/uploads/tts/${scope}/${hash}.${extension}`;
}

/**
 * Moves pre-per-user TTS files into `tts/legacy/`.
 *
 * Older versions wrote every clip to `tts/<hash>.mp3`, where the URL was
 * guessable by anyone who knew it. The files are kept so existing chat
 * history still plays, but they are marked as legacy and are reported so the
 * operator can rotate them.
 */
export async function migrateLegacyTTSFiles(): Promise<number> {
  if (!existsSync(TTS_ROOT)) return 0;
  const legacyDir = path.join(TTS_ROOT, "legacy");

  let entries: string[];
  try {
    entries = await readdir(TTS_ROOT);
  } catch {
    return 0;
  }

  const movable = entries.filter(
    (entry) => entry.endsWith(".mp3") && entry !== "legacy",
  );
  if (movable.length === 0) return 0;

  if (!existsSync(legacyDir)) mkdirSync(legacyDir, { recursive: true });

  let moved = 0;
  for (const entry of movable) {
    try {
      await rename(path.join(TTS_ROOT, entry), path.join(legacyDir, entry));
      moved++;
    } catch {
      // A failed move must not stop the server from booting.
    }
  }
  if (moved > 0) {
    console.warn(
      `[TTS] Moved ${moved} pre-scoped audio file(s) to tts/legacy/. ` +
        "Those clips were previously reachable by a guessable URL — rotate them if that matters to you.",
    );
  }
  return moved;
}
