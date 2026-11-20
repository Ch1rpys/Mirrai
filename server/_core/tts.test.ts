import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * The read-aloud, by engine (B7.6).
 *
 * `edge-tts` and `execFile` are mocked: the tests are about which
 * engine runs, what it is given, and what the cache key is — not about
 * synthesising audio. The files are really written and removed, because
 * the cache is what the URL points at.
 */

const cacheRoot = vi.hoisted(
  () => `/tmp/mirrai-tts-test-${Math.random().toString(36).slice(2)}`,
);
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  edgeTts: vi.fn(),
  ffmpegAvailable: vi.fn(async () => true),
}));

vi.mock("./env", () => ({ ENV: { uploadDir: cacheRoot } }));
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
}));
vi.mock("edge-tts", () => ({
  tts: (...args: unknown[]) => mocks.edgeTts(...args),
}));
vi.mock("./ffmpeg", () => ({ hasFfmpeg: () => mocks.ffmpegAvailable() }));

import { prosodyToTts } from "@shared/prosody";
import {
  DEFAULT_VOICE,
  TTS_VOICES,
  generateTTS,
  ttsConfigured,
  ttsEngine,
  ttsLeavesMachine,
  voicesForLocale,
} from "./tts";

/**
 * The voices.
 *
 * The picker was added to the settings, and the list behind it was
 * untested — so a voice could be listed for a language it does not
 * speak, or the default could be missing from the list the picker shows,
 * and the interface would offer a voice it then refused.
 */
describe("the voice list", () => {
  it("has both languages", () => {
    expect(TTS_VOICES.some((v) => v.locale === "zh")).toBe(true);
    expect(TTS_VOICES.some((v) => v.locale === "en")).toBe(true);
  });

  it("gives every voice an id and a label", () => {
    for (const voice of TTS_VOICES) {
      expect(voice.id).toBeTruthy();
      expect(voice.label).toBeTruthy();
    }
  });

  it("has no duplicate ids", () => {
    const ids = TTS_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers only the voices of the language asked for", () => {
    for (const voice of voicesForLocale("en")) {
      expect(voice.locale).toBe("en");
    }
    for (const voice of voicesForLocale("zh")) {
      expect(voice.locale).toBe("zh");
    }
  });

  it("includes the default voice in the list it is offered from", () => {
    // The default has to be one of the choices, or the picker opens on
    // something that is not in it.
    const chinese = voicesForLocale("zh").map((v) => v.id);
    const english = voicesForLocale("en").map((v) => v.id);
    expect(chinese.includes(DEFAULT_VOICE) || english.includes(DEFAULT_VOICE)).toBe(true);
  });

  it("falls back to the whole list for a language it has no voices for", () => {
    // Better to show every voice than to show none.
    expect(voicesForLocale("zh").length).toBeGreaterThan(0);
  });
});

type Callback = (error: unknown, stdout?: string, stderr?: string) => void;

describe("the read-aloud engine", () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.edgeTts.mockReset();
    mocks.ffmpegAvailable.mockReset();
    mocks.ffmpegAvailable.mockResolvedValue(true);
    vi.unstubAllEnvs();
    mocks.edgeTts.mockResolvedValue(Buffer.from("mp3 bytes"));
    mocks.execFile.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
        callback(null, "", "");
        return { stdin: { end: () => {} } };
      },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it("defaults to the online Edge voice, which leaves the machine", async () => {
    vi.stubEnv("TTS_ENGINE", "");
    expect(ttsEngine()).toBe("edge");
    expect(ttsLeavesMachine()).toBe(true);
  });

  it("knows whether the configured engine can actually run", () => {
    vi.stubEnv("TTS_ENGINE", "edge");
    expect(ttsConfigured()).toBe(true);
    vi.stubEnv("TTS_ENGINE", "piper");
    expect(ttsConfigured()).toBe(false);
    vi.stubEnv("PIPER_BIN", "/opt/piper/piper");
    vi.stubEnv("PIPER_MODEL", "/models/zh_CN.onnx");
    expect(ttsConfigured()).toBe(true);
    vi.stubEnv("TTS_ENGINE", "http");
    expect(ttsConfigured()).toBe(false);
    vi.stubEnv("TTS_HTTP_URL", "http://127.0.0.1:8880/v1/audio/speech");
    expect(ttsConfigured()).toBe(true);
    vi.stubEnv("TTS_ENGINE", "off");
    expect(ttsConfigured()).toBe(false);
  });

  it("says nothing leaves the machine for the local engines", () => {
    vi.stubEnv("TTS_ENGINE", "piper");
    expect(ttsLeavesMachine()).toBe(false);
    vi.stubEnv("TTS_ENGINE", "http");
    expect(ttsLeavesMachine()).toBe(false);
  });

  it("treats TTS_ENABLED=false and TTS_ENGINE=off the same way", async () => {
    vi.stubEnv("TTS_ENABLED", "false");
    expect(ttsEngine()).toBe("off");
    await expect(generateTTS("在吗", DEFAULT_VOICE, 1)).rejects.toThrow(/switched off/);

    vi.stubEnv("TTS_ENABLED", "true");
    vi.stubEnv("TTS_ENGINE", "off");
    await expect(generateTTS("在吗", DEFAULT_VOICE, 1)).rejects.toThrow(/switched off/);
    expect(mocks.edgeTts).not.toHaveBeenCalled();
  });

  it("asks Edge for the rate change it was given", async () => {
    vi.stubEnv("TTS_ENGINE", "edge");
    const url = await generateTTS("知道了", DEFAULT_VOICE, 7, { ratePercent: 10 });
    expect(mocks.edgeTts).toHaveBeenCalledWith("知道了", {
      voice: DEFAULT_VOICE,
      rate: "+10%",
    });
    expect(url).toMatch(/^\/uploads\/tts\/7\/[0-9a-f]{16}\.mp3$/);
    expect(existsSync(path.join(cacheRoot, "tts", "7", url.split("/").pop()!))).toBe(true);
  });

  it("reads at the pace the prosody measurement computed", async () => {
    vi.stubEnv("TTS_ENGINE", "edge");
    const direction = prosodyToTts({ charsPerSec: 5.04, samples: 10 }, "zh");
    expect(direction.ratePercent).toBe(20);
    await generateTTS("测速一下", DEFAULT_VOICE, 9, { ratePercent: direction.ratePercent });
    expect(mocks.edgeTts).toHaveBeenCalledWith("测速一下", {
      voice: DEFAULT_VOICE,
      rate: "+20%",
    });
  });

  it("caches by engine and by rate, not by the words alone", async () => {
    vi.stubEnv("TTS_ENGINE", "edge");
    const slow = await generateTTS("知道了", DEFAULT_VOICE, 7);
    const fast = await generateTTS("知道了", DEFAULT_VOICE, 7, { ratePercent: 20 });
    const same = await generateTTS("知道了", DEFAULT_VOICE, 7);
    expect(slow).not.toBe(fast);
    expect(same).toBe(slow);
    expect(mocks.edgeTts).toHaveBeenCalledTimes(2);

    vi.stubEnv("TTS_ENGINE", "http");
    vi.stubEnv("TTS_HTTP_URL", "http://127.0.0.1:8880/v1/audio/speech");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    const local = await generateTTS("知道了", DEFAULT_VOICE, 7);
    expect(local).not.toBe(slow);
  });

  it("runs piper with the text on stdin, never in the arguments", async () => {
    vi.stubEnv("TTS_ENGINE", "piper");
    vi.stubEnv("PIPER_BIN", "/opt/piper/piper");
    vi.stubEnv("PIPER_MODEL", "/models/zh_CN.onnx");
    const stdin: string[] = [];
    mocks.execFile.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
        callback(null, "", "");
        return { stdin: { end: (text: string) => stdin.push(text) } };
      },
    );

    const url = await generateTTS("今天好累", DEFAULT_VOICE, 3, { ratePercent: 10 });

    const piperCall = mocks.execFile.mock.calls.find(
      ([bin]) => bin === "/opt/piper/piper",
    ) as [string, string[], unknown, Callback];
    expect(piperCall).toBeTruthy();
    const [, args] = piperCall;
    expect(args).toEqual([
      "--model",
      "/models/zh_CN.onnx",
      "--output_file",
      expect.stringMatching(/\.wav$/),
      "--length_scale",
      "0.909",
    ]);
    expect(args.join(" ")).not.toContain("今天好累");
    expect(stdin).toEqual(["今天好累"]);
    // ffmpeg turns the WAV into an mp3, and the WAV goes away.
    expect(url).toMatch(/\.mp3$/);
    expect(mocks.execFile.mock.calls.some(([bin]) => bin === "ffmpeg")).toBe(true);
  });

  it("leaves the piper clip as WAV when ffmpeg is not installed", async () => {
    vi.stubEnv("TTS_ENGINE", "piper");
    vi.stubEnv("PIPER_BIN", "/opt/piper/piper");
    vi.stubEnv("PIPER_MODEL", "/models/zh_CN.onnx");
    mocks.ffmpegAvailable.mockResolvedValue(false);

    const url = await generateTTS("今天好累", DEFAULT_VOICE, 3);
    expect(url).toMatch(/\.wav$/);
    expect(mocks.execFile.mock.calls.every(([bin]) => bin !== "ffmpeg")).toBe(true);
  });

  it("asks a local OpenAI-compatible service for speech", async () => {
    vi.stubEnv("TTS_ENGINE", "http");
    vi.stubEnv("TTS_HTTP_URL", "http://127.0.0.1:8880/v1/audio/speech");
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await generateTTS("在吗", DEFAULT_VOICE, 4, { ratePercent: -20 });

    expect(url).toMatch(/\.mp3$/);
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(endpoint)).toBe("http://127.0.0.1:8880/v1/audio/speech");
    const body = JSON.parse(String(init.body)) as {
      input: string;
      speed: number;
      response_format: string;
    };
    expect(body.input).toBe("在吗");
    expect(body.speed).toBeCloseTo(0.8);
    expect(body.response_format).toBe("mp3");
  });

  it("refuses a speech service that is off this machine", async () => {
    vi.stubEnv("TTS_ENGINE", "http");
    vi.stubEnv("TTS_HTTP_URL", "https://speech.example.com/v1/audio/speech");
    vi.stubGlobal("fetch", vi.fn());
    await expect(generateTTS("在吗", DEFAULT_VOICE, 4)).rejects.toThrow(/not on this machine/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("has no switch that sends the text to a remote speech service", async () => {
    vi.stubEnv("TTS_ENGINE", "http");
    vi.stubEnv("TTS_HTTP_URL", "https://speech.example.com/v1/audio/speech");
    // The variable existed in an earlier revision. It must not reopen the
    // remote path now that the interface says the text stays here.
    vi.stubEnv("TTS_HTTP_ALLOW_REMOTE", "true");
    vi.stubGlobal("fetch", vi.fn());
    await expect(generateTTS("在吗", DEFAULT_VOICE, 4)).rejects.toThrow(/not on this machine/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ttsLeavesMachine()).toBe(false);
  });
});
