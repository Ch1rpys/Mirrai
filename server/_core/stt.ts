import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasFfmpeg, toWav16k } from "./ffmpeg";
import { assertLocalEndpoint, isLocalEndpoint } from "./local-endpoint";
import { runBinary } from "./run-binary";
import { llmService } from "../llm";
import type { LLMProvider } from "../llm/types";

/**
 * Where a recording is turned into words.
 *
 * There used to be one answer: the OpenAI-compatible provider's
 * `/audio/transcriptions`. So a persona configured against Ollama — a
 * setup chosen precisely so that nothing leaves the machine — could
 * not hear a voice message at all, and the user had to type what they
 * had just said.
 *
 * Four engines now:
 *
 * - `provider` (default, the existing behaviour): the configured
 *   provider's speech-to-text endpoint.
 * - `whisper-cpp`: a local whisper.cpp binary, fed a 16 kHz WAV.
 * - `http`: any OpenAI-compatible `/audio/transcriptions`, typically a
 *   locally served faster-whisper or SenseVoice.
 * - `off`: no transcription; the caller says it could not hear.
 *
 * **An imported recording never leaves the machine.** `purpose:
 * "import"` is only served by a local engine, and there is no switch
 * that changes that. Those are the other person's real voice notes;
 * sending them to a cloud service to build a persona would be a
 * different product.
 */

export type SttEngine = "provider" | "whisper-cpp" | "http" | "off";

/** The engine the environment asks for. */
export function sttEngine(): SttEngine {
  const raw = (process.env.STT_ENGINE ?? "provider").trim().toLowerCase();
  if (raw === "whisper-cpp" || raw === "whispercpp" || raw === "whisper") return "whisper-cpp";
  if (raw === "http") return "http";
  if (raw === "off") return "off";
  return "provider";
}

function sttHttpUrl(): string {
  return (process.env.STT_HTTP_URL ?? "").trim();
}

/** Whether the operator has said the HTTP service may be off this machine. */
export function sttAllowsRemote(): boolean {
  return (process.env.STT_HTTP_ALLOW_REMOTE ?? "").trim().toLowerCase() === "true";
}

/**
 * Whether the configured engine keeps the audio on this machine.
 *
 * Used to refuse imported recordings for a remote engine, and to say
 * in the interface whether a transcription task can run at all.
 */
export function sttIsLocal(): boolean {
  const engine = sttEngine();
  if (engine === "whisper-cpp") return true;
  if (engine === "http") {
    const url = sttHttpUrl();
    return url.length > 0 && isLocalEndpoint(url);
  }
  return false;
}

export interface TranscribeInput {
  buffer?: Buffer;
  filePath?: string;
  fileName: string;
  language?: "zh" | "en" | "auto";
  purpose: "chat" | "import";
  /** Used only by the `provider` engine. */
  provider?: LLMProvider;
}

export interface Transcription {
  text: string;
  engine: string;
}

async function audioBytes(input: TranscribeInput): Promise<Buffer> {
  if (input.buffer) return input.buffer;
  if (input.filePath) return readFile(input.filePath);
  return Buffer.alloc(0);
}

/**
 * Reads whisper.cpp's standard output.
 *
 * With `--no-timestamps` the lines are plain text. The tool still
 * prints a bracketed marker when it finds no speech, and those lines
 * are not words anybody said.
 */
export function cleanWhisperOutput(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^\[(BLANK_AUDIO|MUSIC|SOUND|NOISE)\]$/i.test(line))
    .join("\n")
    .trim();
}

async function transcribeWithWhisper(input: TranscribeInput): Promise<string | null> {
  const bin = (process.env.WHISPER_CPP_BIN ?? "").trim();
  const model = (process.env.WHISPER_CPP_MODEL ?? "").trim();
  if (!bin || !model) return null;
  if (!(await hasFfmpeg())) return null;

  const dir = await mkdtemp(path.join(tmpdir(), "mirrai-stt-"));
  try {
    let source = input.filePath;
    if (!source) {
      source = path.join(dir, path.basename(input.fileName) || "audio.bin");
      await writeFile(source, await audioBytes(input));
    }
    const wav = path.join(dir, "audio.wav");
    await toWav16k(source, wav);

    /**
     * The flags are whisper.cpp's own (`examples/cli/cli.cpp`):
     * `-m` the model, `-f` the WAV, `-l` the language, `-nt` /
     * `--no-timestamps` for plain text and `-np` / `--no-prints` to
     * keep the log out of the transcript.
     *
     * https://github.com/ggml-org/whisper.cpp#quick-start
     */
    const args = ["-m", model, "-f", wav];
    const language = input.language ?? "auto";
    if (language !== "auto") args.push("-l", language);
    args.push("--no-timestamps", "--no-prints");

    const { stdout } = await runBinary(bin, args);
    const text = cleanWhisperOutput(stdout);
    return text.length > 0 ? text : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function transcribeWithHttp(
  endpoint: URL,
  input: TranscribeInput,
): Promise<string | null> {
  const bytes = await audioBytes(input);
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
    input.fileName,
  );
  /**
   * The model name is required by the OpenAI shape even when the local
   * server ignores it (faster-whisper and SenseVoice both do). It is
   * configurable for servers that dispatch on it.
   */
  form.append("model", (process.env.STT_HTTP_MODEL ?? "").trim() || "whisper-1");
  const language = input.language ?? "auto";
  if (language !== "auto") form.append("language", language);

  const headers: Record<string, string> = {};
  const key = (process.env.STT_HTTP_API_KEY ?? "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`The speech service answered ${response.status}.`);
  }
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    return (parsed.text ?? "").trim() || null;
  } catch {
    return raw.trim() || null;
  }
}

/**
 * Transcribes one recording.
 *
 * Returns null when there is no text: no engine configured, a local
 * tool missing, a failure, or silence. The caller treats all of them
 * the same way — "I could not hear that" — and never invents words
 * the person did not say.
 *
 * A misconfigured remote HTTP address throws instead: that is a
 * setting to fix, not a recording that came out empty.
 */
export async function transcribeAudio(
  input: TranscribeInput,
): Promise<Transcription | null> {
  const engine = sttEngine();
  if (engine === "off") return null;

  // Imported recordings stay on this machine. There is no switch.
  if (input.purpose === "import" && !sttIsLocal()) return null;

  if (engine === "provider") {
    if (!input.provider) return null;
    try {
      const text = await llmService.transcribeWithProvider(
        input.provider,
        await audioBytes(input),
        input.fileName,
      );
      return text.trim() ? { text: text.trim(), engine: "provider" } : null;
    } catch (error) {
      console.warn("[STT] The provider could not transcribe:", (error as Error).message);
      return null;
    }
  }

  if (engine === "whisper-cpp") {
    try {
      const text = await transcribeWithWhisper(input);
      return text ? { text, engine: "whisper-cpp" } : null;
    } catch (error) {
      console.warn("[STT] whisper.cpp could not transcribe:", (error as Error).message);
      return null;
    }
  }

  // `http`
  const raw = sttHttpUrl();
  if (!raw) return null;
  const endpoint = assertLocalEndpoint(raw, sttAllowsRemote());
  try {
    const text = await transcribeWithHttp(endpoint, input);
    return text ? { text, engine: "http" } : null;
  } catch (error) {
    console.warn("[STT] The speech service could not transcribe:", (error as Error).message);
    return null;
  }
}
