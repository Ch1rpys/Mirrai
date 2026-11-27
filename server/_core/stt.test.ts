import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Where a recording gets turned into words.
 *
 * `execFile` is mocked so the exact argument array whisper.cpp is given
 * can be asserted — a file path spliced into a string would be command
 * injection, and the path is the user's own upload. `fetch` is mocked
 * for the HTTP engine.
 */

const execFileMock = vi.fn();
const transcribeWithProvider = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("../llm", () => ({
  llmService: { transcribeWithProvider: (...a: unknown[]) => transcribeWithProvider(...a) },
}));

type Callback = (error: unknown, stdout?: string, stderr?: string) => void;

function ffmpegReply(stdout: string, stderr = "") {
  return (bin: string, _args: string[], _options: unknown, callback: Callback) => {
    callback(null, stdout, stderr);
  };
}

import {
  cleanWhisperOutput,
  sttConfigured,
  sttEngine,
  sttIsLocal,
  transcribeAudio,
} from "./stt";

describe("the transcription engines", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    transcribeWithProvider.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("defaults to the provider engine", () => {
    expect(sttEngine()).toBe("provider");
    expect(sttIsLocal()).toBe(false);
  });

  it("runs a local whisper.cpp binary on a 16 kHz WAV", async () => {
    vi.stubEnv("STT_ENGINE", "whisper-cpp");
    vi.stubEnv("WHISPER_CPP_BIN", "/opt/whisper/whisper-cli");
    vi.stubEnv("WHISPER_CPP_MODEL", "/models/ggml-base.bin");
    execFileMock.mockImplementation((bin: string, args: string[], options: unknown, callback: Callback) => {
      if (bin === "ffmpeg" && args[0] === "-version") return callback(null, "ffmpeg version 8", "");
      if (bin === "ffmpeg") return callback(null, "", "");
      return callback(null, "在吗\n[BLANK_AUDIO]\n", "");
    });

    const result = await transcribeAudio({
      buffer: Buffer.from("not really audio"),
      fileName: "voice.webm",
      purpose: "chat",
    });

    expect(result).toEqual({ text: "在吗", engine: "whisper-cpp" });
    const whisperCall = execFileMock.mock.calls.find(
      ([bin]) => bin === "/opt/whisper/whisper-cli",
    ) as [string, string[], unknown, Callback];
    expect(whisperCall).toBeTruthy();
    const [, args] = whisperCall;
    expect(args.slice(0, 4)).toEqual([
      "-m",
      "/models/ggml-base.bin",
      "-f",
      expect.stringMatching(/mirrai-stt-.+\/audio\.wav$/),
    ]);
    expect(args).toContain("--no-timestamps");
    expect(args).toContain("--no-prints");
    // The WAV path is one argument of its own, never part of a string.
    expect(args.filter((item) => item.includes("audio.wav"))).toHaveLength(1);
    expect(args[args.indexOf("-f") + 1]).toBe(args.find((item) => item.endsWith("audio.wav")));
    // The binary gets a stripped environment (B7.2): it reads a file of
    // somebody's voice, and it has no business seeing the app's secrets.
    const options = whisperCall[2] as { env?: NodeJS.ProcessEnv };
    expect(options.env).toBeTruthy();
    expect(options.env?.PATH).toBeTruthy();
    expect(options.env?.OPENAI_API_KEY).toBeUndefined();
    expect(options.env?.DATABASE_URL).toBeUndefined();
    expect(options.env?.JWT_SECRET).toBeUndefined();
  });

  it("passes the language when one was named", async () => {
    vi.stubEnv("STT_ENGINE", "whisper-cpp");
    vi.stubEnv("WHISPER_CPP_BIN", "/opt/whisper/whisper-cli");
    vi.stubEnv("WHISPER_CPP_MODEL", "/models/ggml-base.bin");
    execFileMock.mockImplementation((bin: string, args: string[], options: unknown, callback: Callback) => {
      if (bin === "ffmpeg" && args[0] === "-version") return callback(null, "ffmpeg", "");
      if (bin === "ffmpeg") return callback(null, "", "");
      return callback(null, "在的", "");
    });

    await transcribeAudio({
      buffer: Buffer.from("x"),
      fileName: "voice.webm",
      language: "zh",
      purpose: "chat",
    });

    const [, args] = execFileMock.mock.calls.find(
      ([bin]) => bin === "/opt/whisper/whisper-cli",
    ) as [string, string[], unknown, Callback];
    expect(args[args.indexOf("-l") + 1]).toBe("zh");
  });

  it("returns null when the local binary or model is not configured", async () => {
    vi.stubEnv("STT_ENGINE", "whisper-cpp");
    const result = await transcribeAudio({
      buffer: Buffer.from("x"),
      fileName: "voice.webm",
      purpose: "chat",
    });
    expect(result).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("calls an OpenAI-compatible local speech service", async () => {
    vi.stubEnv("STT_ENGINE", "http");
    vi.stubEnv("STT_HTTP_URL", "http://127.0.0.1:9000/v1/audio/transcriptions");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "你好呀" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio({
      buffer: Buffer.from("bytes"),
      fileName: "voice.webm",
      language: "zh",
      purpose: "chat",
    });

    expect(result).toEqual({ text: "你好呀", engine: "http" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:9000/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("language")).toBe("zh");
    expect(form.get("model")).toBe("whisper-1");
  });

  it("refuses a speech service that is off this machine", async () => {
    vi.stubEnv("STT_ENGINE", "http");
    vi.stubEnv("STT_HTTP_URL", "https://speech.example.com/v1/audio/transcriptions");
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      transcribeAudio({ buffer: Buffer.from("x"), fileName: "a.webm", purpose: "chat" }),
    ).rejects.toThrow(/not on this machine/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows a remote address when the operator says so", async () => {
    vi.stubEnv("STT_ENGINE", "http");
    vi.stubEnv("STT_HTTP_URL", "https://speech.example.com/v1/audio/transcriptions");
    vi.stubEnv("STT_HTTP_ALLOW_REMOTE", "true");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "嗯" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio({
      buffer: Buffer.from("x"),
      fileName: "a.webm",
      purpose: "chat",
    });
    expect(result).toEqual({ text: "嗯", engine: "http" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never sends an imported recording off the machine", async () => {
    vi.stubEnv("STT_ENGINE", "http");
    vi.stubEnv("STT_HTTP_URL", "https://speech.example.com/v1/audio/transcriptions");
    vi.stubEnv("STT_HTTP_ALLOW_REMOTE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await transcribeAudio({ buffer: Buffer.from("x"), fileName: "a.webm", purpose: "import" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send an imported recording to the provider either", async () => {
    vi.stubEnv("STT_ENGINE", "provider");
    const provider = { transcribe: vi.fn() } as never;
    expect(
      await transcribeAudio({
        buffer: Buffer.from("x"),
        fileName: "a.webm",
        purpose: "import",
        provider,
      }),
    ).toBeNull();
    expect(transcribeWithProvider).not.toHaveBeenCalled();
  });

  it("uses the provider for a voice message when that is the engine", async () => {
    vi.stubEnv("STT_ENGINE", "provider");
    transcribeWithProvider.mockResolvedValue("  在吗  ");
    const provider = {} as never;
    const result = await transcribeAudio({
      buffer: Buffer.from("x"),
      fileName: "a.webm",
      purpose: "chat",
      provider,
    });
    expect(result).toEqual({ text: "在吗", engine: "provider" });
    expect(transcribeWithProvider).toHaveBeenCalledWith(provider, expect.any(Buffer), "a.webm");
  });

  it("says nothing was heard when the provider cannot transcribe", async () => {
    vi.stubEnv("STT_ENGINE", "provider");
    transcribeWithProvider.mockRejectedValue(new Error("no speech-to-text service"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transcribeAudio({
      buffer: Buffer.from("x"),
      fileName: "a.webm",
      purpose: "chat",
      provider: {} as never,
    });
    expect(result).toBeNull();
    warn.mockRestore();
  });

  it("does nothing when transcription is switched off", async () => {
    vi.stubEnv("STT_ENGINE", "off");
    expect(
      await transcribeAudio({ buffer: Buffer.from("x"), fileName: "a.webm", purpose: "chat" }),
    ).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(transcribeWithProvider).not.toHaveBeenCalled();
  });

  it("knows whether the configured engine can actually run", () => {
    vi.stubEnv("STT_ENGINE", "provider");
    expect(sttConfigured()).toBe(true);
    vi.stubEnv("STT_ENGINE", "whisper-cpp");
    expect(sttConfigured()).toBe(false);
    vi.stubEnv("WHISPER_CPP_BIN", "/opt/whisper/whisper-cli");
    vi.stubEnv("WHISPER_CPP_MODEL", "/models/ggml-base.bin");
    expect(sttConfigured()).toBe(true);
    vi.stubEnv("STT_ENGINE", "http");
    expect(sttConfigured()).toBe(false);
    vi.stubEnv("STT_HTTP_URL", "http://127.0.0.1:9000/v1/audio/transcriptions");
    expect(sttConfigured()).toBe(true);
    vi.stubEnv("STT_ENGINE", "off");
    expect(sttConfigured()).toBe(false);
  });

  it("strips the markers whisper prints when it hears no speech", () => {
    expect(cleanWhisperOutput("在吗\n[BLANK_AUDIO]\n  \n好的")).toBe("在吗\n好的");
    expect(cleanWhisperOutput("[MUSIC]\n")).toBe("");
  });
});
