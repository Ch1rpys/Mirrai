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

  /**
   * The output below is copied from the real tool, not invented.
   *
   * It was captured on this machine (ffmpeg 9.0.2) from a 6.00-second
   * WAV: 1.5 s silence, 2 s of a 440 Hz tone, 2.5 s silence again.
   *
   *     ffmpeg -f lavfi -i "sine=frequency=440:duration=2" \
   *       -af "adelay=1500,apad=pad_dur=2.5" -ar 16000 -ac 1 test.wav
   *     ffmpeg -hide_banner -nostats -i test.wav \
   *       -af "silencedetect=noise=-35dB:d=0.35" -f null -
   *
   * Note the last line: a trailing silence *does* get a
   * `silence_end` here — it is printed when the filter is flushed at
   * end of file, with the timestamp equal to the file's duration. The
   * old mock ended with a bare `silence_start`, which is why the
   * parser was never exercised against what the real tool prints.
   */
  function realTrailingSilenceStderr(): string {
    return (
      "[Parsed_silencedetect_0 @ 0x7720c58900] silence_start: 0\n" +
      "[Parsed_silencedetect_0 @ 0x7720c58900] silence_end: 1.500063 | silence_duration: 1.500063\n" +
      "[Parsed_silencedetect_0 @ 0x7720c58900] silence_start: 3.5\n" +
      "[Parsed_silencedetect_0 @ 0x7720c58900] silence_end: 6 | silence_duration: 2.5\n"
    );
  }

  it("uses the silencedetect threshold and reports the trailing silence ffmpeg really prints", async () => {
    execFileMock.mockImplementation(
      (_bin: string, args: string[], _options: unknown, callback: Callback) => {
        if (args.includes("-i") && !args.includes("silencedetect=noise=-35dB:d=0.35")) {
          callback(null, "", "  Duration: 00:00:06.00, bitrate: 256 kb/s\n");
          return;
        }
        callback(null, "", realTrailingSilenceStderr());
      },
    );
    const report = await silenceRatio("/tmp/a.wav");
    // 1.500063 s of leading silence + 2.5 s at the tail, on a 6 s file.
    expect(report?.totalSec).toBe(6);
    expect(report?.tailSec).toBeCloseTo(2.5, 6);
    expect(report?.ratio).toBeCloseTo(4.000063 / 6, 6);
    const [, args] = lastCall();
    expect(args).toContain("silencedetect=noise=-35dB:d=0.35");
    expect(args[args.indexOf("-i") + 1]).toBe("/tmp/a.wav");
    expect(args).toContain("/tmp/a.wav");
  });

  it("does not mistake a leading-only silence for a tail", async () => {
    // Real output from a 3.50-second WAV: 1.5 s silence then a 2 s tone,
    // ending in sound. (Same ffmpeg 9.0.2, captured like the fixture above.)
    execFileMock.mockImplementation(
      (_bin: string, args: string[], _options: unknown, callback: Callback) => {
        if (args.includes("-i") && !args.includes("silencedetect=noise=-35dB:d=0.35")) {
          callback(null, "", "  Duration: 00:00:03.50, bitrate: 256 kb/s\n");
          return;
        }
        callback(
          null,
          "",
          "[Parsed_silencedetect_0 @ 0x78dec04d80] silence_start: 0\n" +
            "[Parsed_silencedetect_0 @ 0x78dec04d80] silence_end: 1.500063 | silence_duration: 1.500063\n",
        );
      },
    );
    const report = await silenceRatio("/tmp/lead-only.wav");
    expect(report?.totalSec).toBe(3.5);
    expect(report?.tailSec).toBe(0);
    expect(report?.ratio).toBeCloseTo(1.500063 / 3.5, 6);
  });

  it("still measures a tail when an older ffmpeg prints no end line at end of file", async () => {
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
  });
});
