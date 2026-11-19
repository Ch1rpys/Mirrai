import { describe, expect, it, vi, beforeEach } from "vitest";

const listMedia = vi.fn();
const getPersonaStyleProfile = vi.fn();
const setPersonaStyleProfile = vi.fn();
const hasFfmpeg = vi.fn();
const silenceRatio = vi.fn();

vi.mock("../db", () => ({
  listMedia: (...a: unknown[]) => listMedia(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  setPersonaStyleProfile: (...a: unknown[]) => setPersonaStyleProfile(...a),
}));

vi.mock("./ffmpeg", () => ({
  hasFfmpeg: () => hasFfmpeg(),
  silenceRatio: (...a: unknown[]) => silenceRatio(...a),
}));

vi.mock("../importers/media", () => ({
  mediaAbsPath: (key: string) => `/uploads/${key}`,
}));

import { measureProsody } from "./prosody";

function voiceRows(count: number, charsPerSecond = 5) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    fileKey: `personas/1/5/voice-${index}.ogg`,
    transcript: "一".repeat(charsPerSecond * 10),
    durationSec: 10,
  }));
}

describe("measuring how the person speaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMedia.mockResolvedValue(voiceRows(10));
    hasFfmpeg.mockResolvedValue(true);
    silenceRatio.mockResolvedValue({ ratio: 0.3, tailSec: 0.4, totalSec: 10 });
    getPersonaStyleProfile.mockResolvedValue({
      version: 1,
      measuredAt: "2026-01-01T00:00:00.000Z",
      recordsVersion: "10:10",
      voice: {
        samples: 20,
        rate: 0.1,
        durationSec: { median: 12, p90: 20 },
        byState: {},
        afterMyVoiceRate: null,
      },
    });
    setPersonaStyleProfile.mockResolvedValue(true);
  });

  it("has no measurement with fewer than eight transcribed recordings", async () => {
    listMedia.mockResolvedValue(voiceRows(7));
    expect(await measureProsody({ personaId: 5, userId: 1 })).toBeNull();
    expect(silenceRatio).not.toHaveBeenCalled();
  });

  it("measures the rate, the pauses, and the trailing silence", async () => {
    const prosody = await measureProsody({ personaId: 5, userId: 1 });
    expect(prosody).toEqual({
      charsPerSec: 5,
      pauseRatio: 0.3,
      tailSec: 0.4,
      samples: 10,
    });
    expect(silenceRatio).toHaveBeenCalledTimes(10);
    expect(setPersonaStyleProfile).toHaveBeenCalledTimes(1);
    const stored = setPersonaStyleProfile.mock.calls[0]![2] as any;
    expect(stored.voice.prosody).toEqual(prosody);
  });

  it("keeps the rate and drops the pauses when ffmpeg is not installed", async () => {
    hasFfmpeg.mockResolvedValue(false);
    const prosody = await measureProsody({ personaId: 5, userId: 1 });
    expect(prosody).toEqual({ charsPerSec: 5, samples: 10 });
    expect(prosody).not.toHaveProperty("pauseRatio");
    expect(prosody).not.toHaveProperty("tailSec");
  });

  it("does not store a measurement when there is no voice profile to hold it", async () => {
    getPersonaStyleProfile.mockResolvedValue(null);
    const prosody = await measureProsody({ personaId: 5, userId: 1 });
    expect(prosody?.charsPerSec).toBe(5);
    expect(setPersonaStyleProfile).not.toHaveBeenCalled();
  });
});
