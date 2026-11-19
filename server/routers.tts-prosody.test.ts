import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The read-aloud, with the measured pace.
 *
 * A persona whose prosody says five characters a second is read twenty
 * percent faster, and the spaces they typed where they would have
 * paused become commas. The route does that, not the client: the same
 * button must work the same way wherever it is pressed.
 */

const getPersonaById = vi.fn();
const generateTTS = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./_core/tts", () => ({
  generateTTS: (...a: unknown[]) => generateTTS(...a),
}));

import { appRouter } from "./routers";

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

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  styleProfile: {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "100:100",
    voice: {
      samples: 20,
      rate: 0.1,
      durationSec: { median: 12, p90: 20 },
      byState: {},
      afterMyVoiceRate: null,
      prosody: { charsPerSec: 5.04, pauseRatio: 0.3, tailSec: 0.4, samples: 12 },
    },
  },
};

describe("reading aloud with prosody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    generateTTS.mockResolvedValue("/uploads/tts/1/x.mp3");
  });

  it("passes the measured rate and the prepared text", async () => {
    await appRouter.createCaller(ctxFor(1)).chat.tts({
      text: "在吗 我到家了...",
      personaId: 5,
      locale: "zh",
    });
    expect(generateTTS).toHaveBeenCalledWith(
      "在吗，我到家了……",
      undefined,
      1,
      { ratePercent: 20 },
    );
  });

  it("reads neutrally when no persona is named", async () => {
    await appRouter.createCaller(ctxFor(1)).chat.tts({ text: "在吗", locale: "zh" });
    expect(generateTTS).toHaveBeenCalledWith("在吗", undefined, 1, {});
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).chat.tts({ text: "在吗", personaId: 5, locale: "zh" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(generateTTS).not.toHaveBeenCalled();
  });
});
