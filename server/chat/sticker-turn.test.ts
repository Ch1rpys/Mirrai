import { describe, expect, it, vi, beforeEach } from "vitest";

const listEnabledStickers = vi.fn();

vi.mock("../db", () => ({
  listEnabledStickers: (...a: unknown[]) => listEnabledStickers(...a),
}));

import { pickStickerForTurn } from "./sticker-turn";

function profile(overrides: {
  rate?: number;
  byState?: Record<string, { rate: number; turns: number; top: Array<{ key: string; n: number }> }>;
}) {
  return {
    version: 1,
    measuredAt: "2026-01-01T00:00:00.000Z",
    recordsVersion: "100:100",
    stickers: {
      samples: 20,
      rate: overrides.rate ?? 1,
      soloRate: 0,
      byState: overrides.byState ?? {
        happy: { rate: 1, turns: 40, top: [{ key: "狗狗探头", n: 12 }] },
        distant: { rate: 0, turns: 40, top: [] },
      },
      runs: { one: 20, two: 0, threePlus: 0 },
    },
  };
}

const library = [
  { id: 41, key: "label:狗狗探头", label: "狗狗探头", fileKey: null, enabled: true },
  { id: 42, key: "label:猫猫叹气", label: "猫猫叹气", fileKey: "personas/1/5/stickers/x.png", enabled: true },
];

describe("choosing a sticker", () => {
  beforeEach(() => {
    listEnabledStickers.mockReset();
    listEnabledStickers.mockResolvedValue(library);
  });

  it("does nothing when the switch is off or the channel is not the web", async () => {
    expect(
      await pickStickerForTurn({
        personaId: 5,
        userId: 1,
        styleProfile: profile({}),
        state: "happy",
        seed: "s",
        channel: "web",
        enabled: false,
      }),
    ).toBeNull();
    expect(
      await pickStickerForTurn({
        personaId: 5,
        userId: 1,
        styleProfile: profile({}),
        state: "happy",
        seed: "s",
        channel: "wechat",
        enabled: true,
      }),
    ).toBeNull();
    expect(listEnabledStickers).not.toHaveBeenCalled();
  });

  it("has nothing to choose from without a measurement", async () => {
    expect(
      await pickStickerForTurn({
        personaId: 5,
        userId: 1,
        styleProfile: {},
        state: "happy",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("sends the sticker from the measured mood", async () => {
    const picked = await pickStickerForTurn({
      personaId: 5,
      userId: 1,
      styleProfile: profile({}),
      state: "happy",
      seed: "s",
      channel: "web",
      enabled: true,
    });
    expect(picked).toEqual({
      stickerId: 41,
      label: "狗狗探头",
      key: "label:狗狗探头",
      imageUrl: null,
    });
  });

  it("keeps a mood with a zero rate silent, even when the overall rate is high", async () => {
    expect(
      await pickStickerForTurn({
        personaId: 5,
        userId: 1,
        styleProfile: profile({}),
        state: "distant",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("says nothing when every sticker is turned off", async () => {
    listEnabledStickers.mockResolvedValue([]);
    expect(
      await pickStickerForTurn({
        personaId: 5,
        userId: 1,
        styleProfile: profile({}),
        state: "happy",
        seed: "s",
        channel: "web",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("makes the same choice twice for the same seed", async () => {
    const input = {
      personaId: 5,
      userId: 1,
      styleProfile: profile({
        rate: 1,
        byState: {
          happy: {
            rate: 1,
            turns: 40,
            top: [
              { key: "狗狗探头", n: 9 },
              { key: "猫猫叹气", n: 3 },
            ],
          },
        },
      }),
      state: "happy",
      seed: "turn-7",
      channel: "web",
      enabled: true,
    };
    const first = await pickStickerForTurn(input);
    const second = await pickStickerForTurn(input);
    expect(second).toEqual(first);
  });
});
