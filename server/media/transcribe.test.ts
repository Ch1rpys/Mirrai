import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The transcription task.
 *
 * It only runs on a local engine — the other person's recordings are
 * not sent to a cloud service to build a persona — and it writes the
 * words to both places they are read from.
 */

const listUntranscribedMedia = vi.fn();
const setMediaTranscript = vi.fn();
const updateRecordMeta = vi.fn();
const sttIsLocal = vi.fn();
const sttEngine = vi.fn();
const transcribeAudio = vi.fn();

vi.mock("../db", () => ({
  listUntranscribedMedia: (...a: unknown[]) => listUntranscribedMedia(...a),
  setMediaTranscript: (...a: unknown[]) => setMediaTranscript(...a),
  updateRecordMeta: (...a: unknown[]) => updateRecordMeta(...a),
}));

vi.mock("../_core/stt", () => ({
  sttIsLocal: () => sttIsLocal(),
  sttConfigured: () => true,
  sttEngine: () => sttEngine(),
  transcribeAudio: (...a: unknown[]) => transcribeAudio(...a),
}));

vi.mock("../_core/env", () => ({ ENV: { uploadDir: "/tmp/mirrai-transcribe-test" } }));

import { startMediaTranscription, transcriptionStatus } from "./transcribe";

async function waitForIdle(personaId: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!transcriptionStatus(personaId).run.running) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the transcription task did not finish");
}

describe("transcribing the imported recordings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sttIsLocal.mockReturnValue(true);
    sttEngine.mockReturnValue("whisper-cpp");
    listUntranscribedMedia.mockResolvedValue([
      {
        id: 11,
        fileKey: "personas/1/5/imports/9/a.ogg",
        recordId: 101,
      },
      {
        id: 12,
        fileKey: "personas/1/5/imports/9/b.ogg",
        recordId: 102,
      },
    ]);
    setMediaTranscript.mockResolvedValue(true);
    updateRecordMeta.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not start without a local engine", async () => {
    sttIsLocal.mockReturnValue(false);
    const result = await startMediaTranscription({ personaId: 5, userId: 1 });
    expect(result).toEqual({ started: false, reason: "no-local-engine" });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(listUntranscribedMedia).not.toHaveBeenCalled();
  });

  it("writes the words to the media row and to the record", async () => {
    transcribeAudio.mockResolvedValue({ text: "刚下课", engine: "whisper-cpp" });
    const started = await startMediaTranscription({ personaId: 5, userId: 1 });
    expect(started.started).toBe(true);
    await waitForIdle(5);

    expect(transcribeAudio).toHaveBeenCalledTimes(2);
    expect(transcribeAudio.mock.calls[0]![0]).toMatchObject({
      purpose: "import",
      fileName: "a.ogg",
      filePath: "/tmp/mirrai-transcribe-test/personas/1/5/imports/9/a.ogg",
    });
    expect(setMediaTranscript).toHaveBeenCalledWith(11, 1, "刚下课", "whisper-cpp");
    expect(updateRecordMeta).toHaveBeenCalledWith(101, 1, { transcript: "刚下课" });
    const status = transcriptionStatus(5);
    expect(status.run).toMatchObject({ running: false, done: 2, failed: 0, total: 2 });
    expect(status.engine).toBe("whisper-cpp");
    expect(status.local).toBe(true);
  });

  it("counts a recording it could not hear and keeps going", async () => {
    transcribeAudio.mockResolvedValueOnce(null).mockResolvedValueOnce({
      text: "第二次听见了",
      engine: "whisper-cpp",
    });
    await startMediaTranscription({ personaId: 6, userId: 1 });
    await waitForIdle(6);
    const status = transcriptionStatus(6);
    expect(status.run.done).toBe(1);
    expect(status.run.failed).toBe(1);
    expect(setMediaTranscript).toHaveBeenCalledTimes(1);
  });

  it("does not start a second run while one is going", async () => {
    transcribeAudio.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { text: "好", engine: "whisper-cpp" };
    });
    const first = await startMediaTranscription({ personaId: 7, userId: 1 });
    expect(first.started).toBe(true);
    const second = await startMediaTranscription({ personaId: 7, userId: 1 });
    expect(second).toEqual({ started: false, reason: "running" });
    await waitForIdle(7);
  });
});
