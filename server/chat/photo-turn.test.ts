import { describe, expect, it, vi, beforeEach } from "vitest";

const listMemoryMediaForMemories = vi.fn();
const listRecentlySentPhotoMediaIds = vi.fn();

vi.mock("../db", () => ({
  listMemoryMediaForMemories: (...a: unknown[]) => listMemoryMediaForMemories(...a),
  listRecentlySentPhotoMediaIds: (...a: unknown[]) => listRecentlySentPhotoMediaIds(...a),
}));

import { pickPhotoForTurn } from "./photo-turn";

const PROFILE = {
  version: 1,
  measuredAt: "2026-01-15T12:00:00.000Z",
  recordsVersion: "100:100",
  photos: {
    samples: 20,
    rate: 1,
    byState: {
      happy: { rate: 1, turns: 40 },
      distant: { rate: 0, turns: 40 },
    },
  },
};

const photo = {
  memoryId: 42,
  mediaId: 11,
  kind: "photo",
  fileKey: "personas/1/1/imports/1/a.jpg",
  at: new Date("2022-04-02T04:00:00.000Z"),
  width: 4,
  height: 4,
};

function pick(overrides: Record<string, unknown> = {}) {
  return pickPhotoForTurn({
    personaId: 1,
    userId: 1,
    styleProfile: PROFILE,
    state: "happy",
    seed: "turn-1",
    channel: "web",
    enabled: true,
    memoryIds: [42],
    now: new Date("2026-01-15T12:00:00.000Z"),
    ...overrides,
  });
}

describe("choosing a real photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMemoryMediaForMemories.mockResolvedValue([photo]);
    listRecentlySentPhotoMediaIds.mockResolvedValue([]);
  });

  it("picks the photo attached to a recalled memory", async () => {
    const picked = await pick();
    expect(picked).toEqual({
      mediaId: 11,
      url: "/uploads/personas/1/1/imports/1/a.jpg",
      at: photo.at,
    });
    expect(listMemoryMediaForMemories).toHaveBeenCalledWith([42], 1);
  });

  it("sends nothing when the switch is off or the channel is not web", async () => {
    expect(await pick({ enabled: false })).toBeNull();
    expect(await pick({ channel: "wechat" })).toBeNull();
    expect(listMemoryMediaForMemories).not.toHaveBeenCalled();
  });

  it("sends nothing in a mood whose rate is zero", async () => {
    expect(await pick({ state: "distant" })).toBeNull();
  });

  it("sends nothing when no recalled memory has a photo", async () => {
    listMemoryMediaForMemories.mockResolvedValue([]);
    expect(await pick()).toBeNull();
  });

  it("skips a photo sent in the last thirty days", async () => {
    listRecentlySentPhotoMediaIds.mockResolvedValue([11]);
    expect(await pick()).toBeNull();
    expect(listRecentlySentPhotoMediaIds).toHaveBeenCalledWith(
      1,
      1,
      new Date("2025-12-16T12:00:00.000Z"),
    );
  });

  it("is deterministic for the same seed", async () => {
    const first = await pick();
    const second = await pick();
    expect(second).toEqual(first);
  });
});
