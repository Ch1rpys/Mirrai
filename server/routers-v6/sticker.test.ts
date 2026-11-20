import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

/**
 * The sticker library, through the router.
 *
 * The UI only ever lists, turns off, deletes, or adds a picture to
 * what the record already has — so each of those checks that the
 * persona belongs to the caller first.
 */

const getPersonaById = vi.fn();
const listStickers = vi.fn();
const setStickerEnabled = vi.fn();
const deleteSticker = vi.fn();
const setStickerImage = vi.fn();
const upsertSticker = vi.fn();
const storagePut = vi.fn();
const storageDelete = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  listStickers: (...a: unknown[]) => listStickers(...a),
  setStickerEnabled: (...a: unknown[]) => setStickerEnabled(...a),
  deleteSticker: (...a: unknown[]) => deleteSticker(...a),
  setStickerImage: (...a: unknown[]) => setStickerImage(...a),
  upsertSticker: (...a: unknown[]) => upsertSticker(...a),
}));

vi.mock("../storage", () => ({
  storagePut: (...a: unknown[]) => storagePut(...a),
  storageDelete: (...a: unknown[]) => storageDelete(...a),
  storageDeleteTree: vi.fn(),
}));

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

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("pixels"),
]);

describe("the sticker library router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    listStickers.mockResolvedValue([
      {
        id: 1,
        key: "label:狗狗探头",
        label: "狗狗探头",
        usesByThem: 12,
        usesByMe: 0,
        enabled: true,
        fileKey: null,
        lastUsedAt: new Date("2023-05-01T12:00:00Z"),
      },
    ]);
    setStickerEnabled.mockResolvedValue({ id: 1, enabled: false });
    deleteSticker.mockResolvedValue({ id: 1, fileKey: "personas/1/5/stickers/x.png" });
    storagePut.mockResolvedValue({ key: "k", url: "/uploads/k" });
    upsertSticker.mockResolvedValue({ id: 9 });
  });

  it("lists the stickers the record has", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).sticker.list({ personaId: 5 });
    expect(listStickers).toHaveBeenCalledWith(5, 1);
    expect(result.stickers[0]).toMatchObject({
      id: 1,
      label: "狗狗探头",
      usesByThem: 12,
      enabled: true,
      imageUrl: null,
    });
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).sticker.list({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(listStickers).not.toHaveBeenCalled();
  });

  it("turns one off and deletes another with its file", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(
      caller.sticker.setEnabled({ personaId: 5, stickerId: 1, enabled: false }),
    ).resolves.toEqual({ enabled: false });
    await expect(
      caller.sticker.delete({ personaId: 5, stickerId: 1 }),
    ).resolves.toEqual({ deleted: true });
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/stickers/x.png");
  });

  it("adds a picture to a sticker that only had a name", async () => {
    await appRouter
      .createCaller(ctxFor(1))
      .sticker.upload({ personaId: 5, label: "狗狗探头", base64: png.toString("base64") });

    expect(setStickerImage).toHaveBeenCalledWith(
      5,
      1,
      1,
      expect.objectContaining({ mime: "image/png" }),
    );
    expect(storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^personas\/1\/5\/stickers\/[0-9a-f]{32}\.png$/),
      png,
      "image/png",
    );
  });

  it("removes the old picture when a different one replaces it", async () => {
    listStickers.mockResolvedValue([
      {
        id: 1,
        key: "a".repeat(32),
        label: "狗狗探头",
        usesByThem: 12,
        usesByMe: 0,
        enabled: true,
        fileKey: "personas/1/5/stickers/old.png",
        lastUsedAt: new Date("2023-05-01T12:00:00Z"),
      },
    ]);
    await appRouter
      .createCaller(ctxFor(1))
      .sticker.upload({ personaId: 5, label: "狗狗探头", base64: png.toString("base64") });

    expect(setStickerImage).toHaveBeenCalledTimes(1);
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/stickers/old.png");
  });

  it("refuses something that is not a picture", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .sticker.upload({ personaId: 5, label: "x", base64: Buffer.from("not an image").toString("base64") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });
});
