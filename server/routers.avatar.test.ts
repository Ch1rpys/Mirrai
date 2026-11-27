import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Avatars are real pictures (B7.8).
 *
 * The bytes decide the kind, not the file name or the client's MIME
 * type. The old picture is removed only after the new one is written.
 */

const getPersonaById = vi.fn();
const setPersonaAvatar = vi.fn();
const setPersonaBackground = vi.fn();
const storagePut = vi.fn();
const storageDelete = vi.fn();

vi.mock("./storage", () => ({
  storagePut: (...a: unknown[]) => storagePut(...a),
  storageDelete: (...a: unknown[]) => storageDelete(...a),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  setPersonaAvatar: (...a: unknown[]) => setPersonaAvatar(...a),
  setPersonaBackground: (...a: unknown[]) => setPersonaBackground(...a),
}));

import { appRouter } from "./routers";

function ctxFor(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
      tokenVersion: 0,
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;

describe("uploading an avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", avatarUrl: null });
    setPersonaAvatar.mockResolvedValue(true);
    setPersonaBackground.mockResolvedValue(true);
    storagePut.mockImplementation(async (key: string) => ({ key, url: `/uploads/${key}` }));
  });

  it("writes a png under the persona's own directory", async () => {
    const result = await appRouter.createCaller(ctxFor()).persona.uploadAvatar({
      personaId: 5,
      base64: PNG_DATA_URL,
    });
    expect(result.avatarUrl).toMatch(/^\/uploads\/personas\/1\/5\/avatar-.+\.png$/);
    const [key, bytes, mime] = storagePut.mock.calls[0]!;
    expect(key).toMatch(/^personas\/1\/5\/avatar-.+\.png$/);
    expect((bytes as Buffer).equals(PNG)).toBe(true);
    expect(mime).toBe("image/png");
    expect(setPersonaAvatar).toHaveBeenCalledWith(5, 1, result.avatarUrl);
  });

  it("does not show somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadAvatar({
        personaId: 5,
        base64: PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("refuses an SVG however it is labelled", async () => {
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadAvatar({
        personaId: 5,
        base64: SVG_DATA_URL,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("refuses a picture over one megabyte", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]);
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadAvatar({
        personaId: 5,
        base64: `data:image/png;base64,${big.toString("base64")}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("removes the old file after the new one is written", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      avatarUrl: "/uploads/personas/1/5/old.png",
    });
    await appRouter.createCaller(ctxFor()).persona.uploadAvatar({
      personaId: 5,
      base64: PNG_DATA_URL,
    });
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/old.png");
  });

  it("uploads a background and removes the old one", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      avatarUrl: null,
      settings: { skin: { theme: "classic", background: "/uploads/personas/1/5/old-bg.png" } },
    });
    const result = await appRouter.createCaller(ctxFor()).persona.uploadBackground({
      personaId: 5,
      base64: PNG_DATA_URL,
    });
    expect(result.backgroundUrl).toMatch(/^\/uploads\/personas\/1\/5\/bg-.+\.png$/);
    expect(setPersonaBackground).toHaveBeenCalledWith(5, 1, result.backgroundUrl);
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/old-bg.png");
  });

  it("does not let a family member change a shared persona's background (B7.15)", async () => {
    // The background is part of the persona's own look: the owner's,
    // like the avatar and the profile. The route was missing the guard.
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      sharedFromPersonaId: 9,
    });
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadBackground({
        personaId: 5,
        base64: PNG_DATA_URL,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storagePut).not.toHaveBeenCalled();
    await expect(
      appRouter.createCaller(ctxFor()).persona.clearBackground({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(setPersonaBackground).not.toHaveBeenCalled();
  });

  it("refuses a background over two megabytes and an SVG", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadBackground({
        personaId: 5,
        base64: `data:image/png;base64,${big.toString("base64")}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      appRouter.createCaller(ctxFor()).persona.uploadBackground({
        personaId: 5,
        base64: SVG_DATA_URL,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sessionStoragePut()).toBe(0);
  });

  function sessionStoragePut() {
    return storagePut.mock.calls.filter((call) => String(call[0]).includes("bg-")).length;
  }

  it("clears a background and its file", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      avatarUrl: null,
      settings: { skin: { theme: "classic", background: "/uploads/personas/1/5/old-bg.png" } },
    });
    const result = await appRouter.createCaller(ctxFor()).persona.clearBackground({ personaId: 5 });
    expect(result.backgroundUrl).toBeNull();
    expect(setPersonaBackground).toHaveBeenCalledWith(5, 1, null);
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/old-bg.png");
  });

  it("clears an avatar and its file", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      avatarUrl: "/uploads/personas/1/5/old.png",
    });
    const result = await appRouter.createCaller(ctxFor()).persona.clearAvatar({ personaId: 5 });
    expect(result.avatarUrl).toBeNull();
    expect(setPersonaAvatar).toHaveBeenCalledWith(5, 1, null);
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/old.png");
  });
});
