import { describe, expect, it, vi, beforeEach } from "vitest";

const listMedia = vi.fn();
const getFilesByPersonaId = vi.fn();
const upsertMedia = vi.fn();
const setMediaTranscript = vi.fn();
const setMediaVideoMeta = vi.fn();
const hasFfmpeg = vi.fn();
const probe = vi.fn();
const extractKeyframes = vi.fn();
const toWav16k = vi.fn();
const transcribeAudio = vi.fn();
const readFile = vi.fn();
const mkdtemp = vi.fn();
const rm = vi.fn();

vi.mock("../db", () => ({
  listMedia: (...a: unknown[]) => listMedia(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  upsertMedia: (...a: unknown[]) => upsertMedia(...a),
  setMediaTranscript: (...a: unknown[]) => setMediaTranscript(...a),
  setMediaVideoMeta: (...a: unknown[]) => setMediaVideoMeta(...a),
}));

vi.mock("../_core/ffmpeg", () => ({
  hasFfmpeg: (...a: unknown[]) => hasFfmpeg(...a),
  probe: (...a: unknown[]) => probe(...a),
  extractKeyframes: (...a: unknown[]) => extractKeyframes(...a),
  toWav16k: (...a: unknown[]) => toWav16k(...a),
}));

vi.mock("../_core/stt", () => ({
  transcribeAudio: (...a: unknown[]) => transcribeAudio(...a),
}));

vi.mock("../importers/media", () => ({
  mediaAbsPath: (key: string) => `/abs/${key}`,
  mimeForFile: () => "video/mp4",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readFile: (...a: unknown[]) => readFile(...a),
    mkdtemp: (...a: unknown[]) => mkdtemp(...a),
    rm: (...a: unknown[]) => rm(...a),
  };
});

import { prepareVideoMaterial } from "./video";

function videoRow(id: number) {
  return {
    id,
    userId: 1,
    personaId: 5,
    kind: "video",
    fileKey: `personas/1/5/v${id}.mp4`,
    mime: "video/mp4",
    bytes: 100,
    hash: String(id).repeat(64).slice(0, 64),
    at: new Date("2022-04-02T04:00:00Z"),
    recordId: id,
    fileId: 1,
    fromThem: false,
    durationSec: null,
    width: null,
    height: null,
    transcript: null,
    transcriptEngine: null,
    exif: null,
    createdAt: new Date(),
  };
}

describe("reading the videos of a distillation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasFfmpeg.mockResolvedValue(true);
    getFilesByPersonaId.mockResolvedValue([]);
    probe.mockResolvedValue({
      durationSec: 10,
      width: 640,
      height: 360,
      hasAudio: true,
      hasVideo: true,
    });
    extractKeyframes.mockImplementation(async (_input: string, dir: string) => [
      `${dir}/frame-0.jpg`,
      `${dir}/frame-1.jpg`,
      `${dir}/frame-2.jpg`,
    ]);
    toWav16k.mockImplementation(async (_input: string, output: string) => output);
    transcribeAudio.mockResolvedValue({ text: "我昨天去了海边", engine: "whisper-cpp" });
    readFile.mockResolvedValue(Buffer.from("frame"));
    mkdtemp.mockResolvedValue("/tmp/mirrai-video-test");
    rm.mockResolvedValue(undefined);
    setMediaVideoMeta.mockResolvedValue(true);
    setMediaTranscript.mockResolvedValue(true);
    upsertMedia.mockImplementation(async (data: Record<string, unknown>) => ({
      ...videoRow(1),
      ...data,
    }));
    listMedia.mockResolvedValue([videoRow(1), videoRow(2), videoRow(3), videoRow(4), videoRow(5)]);
  });

  it("reads at most four videos and reports the one left out", async () => {
    const material = await prepareVideoMaterial({ personaId: 5, userId: 1 });
    expect(material.skipped).toBe(1);
    expect(extractKeyframes).toHaveBeenCalledTimes(4);
    expect(material.frameDataUrls).toHaveLength(12);
    expect(material.transcripts).toEqual([
      "我昨天去了海边",
      "我昨天去了海边",
      "我昨天去了海边",
      "我昨天去了海边",
    ]);
    expect(setMediaVideoMeta).toHaveBeenCalledWith(1, 1, {
      durationSec: 10,
      width: 640,
      height: 360,
    });
    expect(setMediaTranscript).toHaveBeenCalledWith(1, 1, "我昨天去了海边", "whisper-cpp");
  });

  it("keeps the frames when no local engine can hear the words", async () => {
    transcribeAudio.mockResolvedValue(null);
    const material = await prepareVideoMaterial({ personaId: 5, userId: 1 });
    expect(material.frameDataUrls).toHaveLength(12);
    expect(material.transcripts).toEqual([]);
    expect(setMediaTranscript).not.toHaveBeenCalled();
  });

  it("removes the temporary files even when a frame cannot be extracted", async () => {
    extractKeyframes.mockRejectedValue(new Error("ffmpeg failed"));
    const material = await prepareVideoMaterial({ personaId: 5, userId: 1 });
    expect(material.frameDataUrls).toEqual([]);
    expect(rm).toHaveBeenCalledWith("/tmp/mirrai-video-test", {
      recursive: true,
      force: true,
    });
  });

  it("does nothing when ffmpeg is not installed", async () => {
    hasFfmpeg.mockResolvedValue(false);
    const material = await prepareVideoMaterial({ personaId: 5, userId: 1 });
    expect(material).toEqual({ frameDataUrls: [], transcripts: [], skipped: 0 });
    expect(listMedia).not.toHaveBeenCalled();
  });
});
