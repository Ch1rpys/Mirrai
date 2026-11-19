import { describe, expect, it, vi, beforeEach } from "vitest";

const generateTTS = vi.fn();
const ttsEngine = vi.fn();

vi.mock("../_core/tts", () => ({
  generateTTS: (...a: unknown[]) => generateTTS(...a),
  ttsEngine: () => ttsEngine(),
  DEFAULT_VOICE: "zh-CN-XiaoxiaoNeural",
}));

import { makeVoiceNote, pickVoiceNoteForTurn } from "./voice-note";

function profile(options: {
  rate?: number;
  states?: Record<string, { rate: number; turns: number }>;
}) {
  return {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "100:100",
    voice: {
      samples: 20,
      rate: options.rate ?? 1,
      durationSec: { median: 12, p90: 20 },
      byState: options.states ?? {
        warm: { rate: 1, turns: 80 },
        distant: { rate: 0, turns: 40 },
      },
      afterMyVoiceRate: 0.4,
    },
  };
}

describe("choosing a voice note", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ttsEngine.mockReturnValue("edge");
    generateTTS.mockResolvedValue("/uploads/tts/1/abc.mp3");
  });

  it("does nothing when the switch is off, the channel is not the web, or playback is off", () => {
    expect(
      pickVoiceNoteForTurn({
        styleProfile: profile({}),
        state: "warm",
        seed: "s",
        channel: "web",
        enabled: false,
      }),
    ).toBeNull();
    expect(
      pickVoiceNoteForTurn({
        styleProfile: profile({}),
        state: "warm",
        seed: "s",
        channel: "wechat",
        enabled: true,
      }),
    ).toBeNull();
    ttsEngine.mockReturnValue("off");
    expect(
      pickVoiceNoteForTurn({
        styleProfile: profile({}),
        state: "warm",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("sends one in a mood that uses them", () => {
    const decision = pickVoiceNoteForTurn({
      styleProfile: profile({}),
      state: "warm",
      seed: "s",
      channel: "web",
      enabled: true,
    });
    expect(decision?.stats.durationSec.p90).toBe(20);
  });

  it("keeps a mood with a zero rate silent", () => {
    expect(
      pickVoiceNoteForTurn({
        styleProfile: profile({}),
        state: "distant",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("has nothing to decide without a measurement", () => {
    expect(
      pickVoiceNoteForTurn({
        styleProfile: {},
        state: "warm",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("makes the note and reports its estimated length", async () => {
    const stats = profile({}).voice;
    const note = await makeVoiceNote({ text: "在的呀", userId: 1, stats });
    expect(note).toEqual({ url: "/uploads/tts/1/abc.mp3", durationSec: 1 });
    expect(generateTTS).toHaveBeenCalledWith(
      "在的呀",
      "zh-CN-XiaoxiaoNeural",
      1,
    );
  });

  it("does not read a line that is far longer than their notes", async () => {
    const stats = profile({}).voice;
    const note = await makeVoiceNote({
      text: "好".repeat(120),
      userId: 1,
      stats,
    });
    expect(note).toBeNull();
    expect(generateTTS).not.toHaveBeenCalled();
  });

  it("falls back to text when synthesis fails", async () => {
    generateTTS.mockRejectedValue(new Error("no engine"));
    const stats = profile({}).voice;
    expect(await makeVoiceNote({ text: "在的呀", userId: 1, stats })).toBeNull();
  });
});
