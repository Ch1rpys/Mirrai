import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Attaching a real photo to a memory (B7.8).
 *
 * The memory and the picture have to belong to the same persona and
 * the same user. A suggestion is a window of days, not a guess.
 */

const getMemoryById = vi.fn();
const getMediaById = vi.fn();
const linkMemoryMedia = vi.fn();
const unlinkMemoryMedia = vi.fn();
const listMemoryMedia = vi.fn();
const listMedia = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const countMemories = vi.fn();
const listMemoryMediaForMemories = vi.fn();
const getPersonaById = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMemoryById: (...a: unknown[]) => getMemoryById(...a),
  getMediaById: (...a: unknown[]) => getMediaById(...a),
  linkMemoryMedia: (...a: unknown[]) => linkMemoryMedia(...a),
  unlinkMemoryMedia: (...a: unknown[]) => unlinkMemoryMedia(...a),
  listMemoryMedia: (...a: unknown[]) => listMemoryMedia(...a),
  listMedia: (...a: unknown[]) => listMedia(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  countMemories: (...a: unknown[]) => countMemories(...a),
  listMemoryMediaForMemories: (...a: unknown[]) => listMemoryMediaForMemories(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

import { appRouter } from "./routers";

function ctxFor(userId = 1): TrpcContext {
  return {
    user: { id: userId, name: "阿树", timezone: "Asia/Shanghai", locale: "zh", tokenVersion: 0 },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

const photo = {
  id: 11,
  userId: 1,
  personaId: 5,
  kind: "photo",
  fileKey: "personas/1/5/imports/1/a.jpg",
  mime: "image/jpeg",
  bytes: 100,
  hash: "a".repeat(64),
  at: new Date("2022-04-02T04:00:00Z"),
  recordId: 9,
  fileId: 1,
  fromThem: true,
  durationSec: null,
  width: 4,
  height: 4,
  transcript: null,
  transcriptEngine: null,
  exif: null,
  createdAt: new Date("2022-04-02T04:00:00Z"),
};

describe("a photo on a memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getMemoryById.mockResolvedValue({ id: 7, personaId: 5, date: "2022-04-02" });
    getMediaById.mockResolvedValue(photo);
    linkMemoryMedia.mockResolvedValue({ id: 1 });
    listMemoryMedia.mockResolvedValue([]);
  });

  it("links a real photo of the same persona", async () => {
    await appRouter.createCaller(ctxFor()).memory.linkMedia({ memoryId: 7, mediaId: 11 });
    expect(linkMemoryMedia).toHaveBeenCalledWith({
      userId: 1,
      personaId: 5,
      memoryId: 7,
      mediaId: 11,
    });
  });

  it("refuses a photo from another persona", async () => {
    getMediaById.mockResolvedValue({ ...photo, personaId: 6 });
    await expect(
      appRouter.createCaller(ctxFor()).memory.linkMedia({ memoryId: 7, mediaId: 11 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(linkMemoryMedia).not.toHaveBeenCalled();
  });

  it("refuses a row that is not a photo", async () => {
    getMediaById.mockResolvedValue({ ...photo, kind: "voice" });
    await expect(
      appRouter.createCaller(ctxFor()).memory.linkMedia({ memoryId: 7, mediaId: 11 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unlinks only after the memory is checked", async () => {
    getMemoryById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor()).memory.unlinkMedia({ memoryId: 7, mediaId: 11 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(unlinkMemoryMedia).not.toHaveBeenCalled();
  });

  it("suggests only the photos taken near the memory's day", async () => {
    listMedia.mockResolvedValue([
      photo,
      { ...photo, id: 12, at: new Date("2022-04-06T04:00:00Z") },
      { ...photo, id: 13, at: new Date("2022-04-05T04:00:00Z") },
    ]);
    const result = await appRouter.createCaller(ctxFor()).memory.suggestMedia({ memoryId: 7 });
    expect(result.photos.map((entry) => entry.id)).toEqual([13, 11]);
  });

  it("suggests nothing when the memory has no readable date", async () => {
    getMemoryById.mockResolvedValue({ id: 7, personaId: 5, date: "last summer" });
    const result = await appRouter.createCaller(ctxFor()).memory.suggestMedia({ memoryId: 7 });
    expect(result.photos).toEqual([]);
    expect(listMedia).not.toHaveBeenCalled();
  });

  it("lists a memory's photos with the memory", async () => {
    getMemoriesByPersonaId.mockResolvedValue([
      { id: 7, title: "第一次见面", description: null, category: "memory" },
    ]);
    countMemories.mockResolvedValue(1);
    listMemoryMediaForMemories.mockResolvedValue([
      {
        memoryId: 7,
        mediaId: 11,
        kind: "photo",
        fileKey: "personas/1/5/imports/1/a.jpg",
        at: new Date("2022-04-02T04:00:00Z"),
        width: 4,
        height: 4,
      },
    ]);
    const result = await appRouter.createCaller(ctxFor()).memory.list({ personaId: 5 });
    expect(result.items[0]?.media).toEqual([
      {
        id: 11,
        url: "/uploads/personas/1/5/imports/1/a.jpg",
        at: new Date("2022-04-02T04:00:00Z"),
        width: 4,
        height: 4,
      },
    ]);
  });
});
