import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

/**
 * The soundtrack routes.
 *
 * The audio URL is the owner-only upload path, and somebody else's
 * persona is not readable. Transcription starts only on a local engine
 * — the route passes that answer through instead of pretending.
 */

const getPersonaById = vi.fn();
const listVoices = vi.fn();
const startMediaTranscription = vi.fn();
const transcriptionStatus = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  listVoices: (...a: unknown[]) => listVoices(...a),
}));

vi.mock("../media/transcribe", () => ({
  startMediaTranscription: (...a: unknown[]) => startMediaTranscription(...a),
  transcriptionStatus: (...a: unknown[]) => transcriptionStatus(...a),
}));

vi.mock("../_core/stt", () => ({ sttEngine: () => "whisper-cpp" }));

import { appRouter } from "../routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `user-${userId}`,
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      name: `User ${userId}`,
      timezone: null,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

describe("the soundtrack routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    listVoices.mockResolvedValue({
      rows: [
        {
          id: 11,
          at: new Date("2022-03-01T12:00:00Z"),
          durationSec: 12,
          fromThem: true,
          transcript: "刚下课",
          transcriptEngine: "whisper-cpp",
          fileKey: "personas/1/5/imports/1/a.ogg",
          recordId: 101,
        },
      ],
      nextCursor: null,
    });
    startMediaTranscription.mockResolvedValue({ started: true, total: 2 });
    transcriptionStatus.mockReturnValue({
      run: { running: false, total: 0, done: 0, failed: 0, startedAt: null, lastError: null },
      engine: "whisper-cpp",
      local: true,
    });
  });

  it("lists the recordings with the owner-only upload URL", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).media.listVoices({ personaId: 5 });
    expect(listVoices).toHaveBeenCalledWith(5, 1, expect.objectContaining({ limit: 30 }));
    expect(result.voices[0]).toMatchObject({
      id: 11,
      transcript: "刚下课",
      url: "/uploads/personas/1/5/imports/1/a.ogg",
      recordId: 101,
    });
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).media.listVoices({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(listVoices).not.toHaveBeenCalled();
  });

  it("starts the transcription task for the owner", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .media.transcribe({ personaId: 5 });
    expect(startMediaTranscription).toHaveBeenCalledWith({ personaId: 5, userId: 1 });
    expect(result).toEqual({ started: true, total: 2 });
  });

  it("says why it could not start", async () => {
    startMediaTranscription.mockResolvedValue({
      started: false,
      reason: "no-local-engine",
    });
    const result = await appRouter
      .createCaller(ctxFor(1))
      .media.transcribe({ personaId: 5 });
    expect(result.started).toBe(false);
    expect(result.reason).toBe("no-local-engine");
  });

  it("passes the engine and the local flag through the status", async () => {
    const status = await appRouter
      .createCaller(ctxFor(1))
      .media.transcribeStatus({ personaId: 5 });
    expect(status.engine).toBe("whisper-cpp");
    expect(status.local).toBe(true);
  });
});
