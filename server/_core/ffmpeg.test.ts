import { describe, expect, it, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

/**
 * The calls the app makes to ffmpeg.
 *
 * `execFile` is mocked here: the tests are about the argument arrays and
 * the parsing of ffmpeg's output, not about decoding a real video. The
 * one thing that is real is the filesystem — the temp directories are
 * made and removed for real, because a leaked temp directory is exactly
 * the bug B7.10 asks about.
 */

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

type Callback = (error: unknown, stdout?: string, stderr?: string) => void;

function succeed(stdout: string, stderr = "") {
  return (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
    callback(null, stdout, stderr);
  };
}

function failWith(stderr: string, code = 1) {
  return (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
    const error = Object.assign(new Error(`Command failed with code ${code}`), {
      code,
      killed: false,
      signal: null,
    });
    callback(error, "", stderr);
  };
}

import { extractKeyframes, hasFfmpeg, probe, silenceRatio, toWav16k } from "./ffmpeg";

function lastCall() {
  return execFileMock.mock.calls[execFileMock.mock.calls.length - 1] as [
    string,
    string[],
    { timeout: number; killSignal: string },
    Callback,
  ];
}

describe("the ffmpeg helper", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("passes an argument array, with the path as its own item", async () => {
    execFileMock.mockImplementation(succeed("", "Duration: 00:00:12.34, start: 0.0, bitrate: 8 kb/s\n"));
    await probe("/tmp/voice.ogg");
    const [bin, args, options] = lastCall();
    expect(bin).toBe("ffmpeg");
    expect(args).toEqual(["-hide_banner", "-i", "/tmp/voice.ogg"]);
    expect(args.every((item) => typeof item === "string")).toBe(true);
    expect(options.killSignal).toBe("SIGKILL");
    expect(options.timeout).toBe(120_000);
  });

  it("resolves an upload key against the uploads directory", async () => {
    execFileMock.mockImplementation(succeed("", "Duration: 00:00:12.34, start: 0.0, bitrate: 8 kb/s\n"));
    await probe("personas/1/5/voice.ogg");
    const [, args] = lastCall();
    expect(args[2]).toBe(path.resolve("uploads/personas/1/5/voice.ogg"));
    expect(path.isAbsolute(args[2]!)).toBe(true);
  });

  it("reads the duration and the streams of a video", async () => {
    execFileMock.mockImplementation(
      succeed(
        "",
        "Input #0, mov, from 'a.mp4':\n" +
          "  Duration: 00:01:02.50, start: 0.000000, bitrate: 900 kb/s\n" +
          "  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 30 fps\n" +
          "  Stream #0:1: Audio: aac, 44100 Hz, stereo\n",
      ),
    );
    const info = await probe("videos/a.mp4");
    expect(info).toEqual({
      durationSec: 62.5,
      width: 1280,
      height: 720,
      hasAudio: true,
      hasVideo: true,
    });
  });

  it("returns null when ffmpeg cannot read the file", async () => {
    execFileMock.mockImplementation(failWith("Invalid data found when processing input"));
    expect(await probe("broken.bin")).toBeNull();
  });

  it("says ffmpeg is missing when the command does not exist", async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
        const error = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
        callback(error, "", "");
      },
    );
    expect(await hasFfmpeg()).toBe(false);
  });

  it("kills a tool that runs past the timeout", async () => {
    execFileMock.mockImplementation(
      (_bin: string, _args: string[], _options: unknown, callback: Callback) => {
        const error = Object.assign(new Error("Command failed"), {
          killed: true,
          signal: "SIGKILL",
          code: null,
        });
        callback(error, "", "");
      },
    );
    await expect(toWav16k("/tmp/in.ogg", "/tmp/out.wav")).rejects.toThrow(
      /did not finish within 120 seconds/,
    );
    expect(lastCall()[2].killSignal).toBe("SIGKILL");
  });

  it("converts to 16 kHz mono WAV", async () => {
    execFileMock.mockImplementation(succeed(""));
    const target = path.join(await mkdtemp(path.join(tmpdir(), "mirrai-ffmpeg-")), "out.wav");
    try {
      await toWav16k("/tmp/in.ogg", target);
      const [, args] = lastCall();
      expect(args).toEqual([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "/tmp/in.ogg",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        target,
      ]);
    } finally {
      await rm(path.dirname(target), { recursive: true, force: true });
    }
  });

  it("takes three evenly spaced frames and no more than asked", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mirrai-frames-"));
    try {
      execFileMock.mockImplementation(succeed("", "  Duration: 00:00:30.00, start: 0.0, bitrate: 8 kb/s\n"));
      // The first call is the probe; the rest write the frames.
      const frames = await extractKeyframes("/tmp/a.mp4", dir, 3);
      expect(frames).toHaveLength(3);
      const seek = frames.map((_, index) => {
        const call = execFileMock.mock.calls[index + 1] as [string, string[], unknown, Callback];
        return Number(call[1][call[1].indexOf("-ss") + 1]);
      });
      expect(seek).toEqual([5, 15, 25]);
      const frameCall = execFileMock.mock.calls[1] as [string, string[], unknown, Callback];
      expect(frameCall[1]).toContain("scale=768:-2");
      expect(frameCall[1][frameCall[1].length - 1]).toBe(path.join(dir, "frame-0.jpg"));

      execFileMock.mockClear();
      execFileMock.mockImplementation(succeed("", "  Duration: 00:00:30.00, start: 0.0, bitrate: 8 kb/s\n"));
      expect(await extractKeyframes("/tmp/a.mp4", dir, 2)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not enlarge a video that is already narrower than the frame width", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mirrai-frames-small-"));
    try {
      execFileMock.mockImplementation(
        succeed(
          "",
          "  Duration: 00:00:10.00, start: 0.0, bitrate: 8 kb/s\n" +
            "  Stream #0:0: Video: h264 (High), yuv420p, 640x360, 25 fps\n",
        ),
      );
      await extractKeyframes("/tmp/small.mp4", dir, 3);
      const frameCall = execFileMock.mock.calls[1] as [string, string[], unknown, Callback];
      expect(frameCall[1]).toContain("scale=640:-2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the silencedetect threshold and reports the trailing silence", async () => {
    execFileMock.mockImplementation(
      (_bin: string, args: string[], _options: unknown, callback: Callback) => {
        if (args.includes("-i") && !args.includes("silencedetect=noise=-35dB:d=0.35")) {
          callback(null, "", "  Duration: 00:00:10.00, start: 0.0, bitrate: 8 kb/s\n");
          return;
        }
        callback(
          null,
          "",
          "[silencedetect @ 0x1] silence_start: 1.5\n" +
            "[silencedetect @ 0x1] silence_end: 3.0 | silence_duration: 1.5\n" +
            "[silencedetect @ 0x1] silence_start: 7.5\n",
        );
      },
    );
    const report = await silenceRatio("/tmp/a.ogg");
    expect(report).toEqual({ ratio: 0.4, tailSec: 2.5, totalSec: 10 });
    const [, args] = lastCall();
    expect(args).toContain("silencedetect=noise=-35dB:d=0.35");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/a.ogg");
    expect(args).toContain("/tmp/a.ogg");
  });
});
