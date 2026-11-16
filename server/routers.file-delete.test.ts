import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const deletePersonaFile = vi.fn();
const storageDelete = vi.fn();
const storageDeleteTree = vi.fn();
const afterRecordsRemoved = vi.fn();

vi.mock("./storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  storageDelete: (...a: unknown[]) => storageDelete(...a),
  storageDeleteTree: (...a: unknown[]) => storageDeleteTree(...a),
}));

vi.mock("./_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
  afterRecordsRemoved: (...a: unknown[]) => afterRecordsRemoved(...a),
  measureStyleProfile: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deletePersonaFile: (...a: unknown[]) => deletePersonaFile(...a),
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
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("file.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageDelete.mockResolvedValue(true);
    storageDeleteTree.mockResolvedValue(true);
    afterRecordsRemoved.mockResolvedValue(undefined);
  });

  it("does not read somebody else's file", async () => {
    deletePersonaFile.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(1)).file.delete({ fileId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("removes the stored file after the row is gone", async () => {
    deletePersonaFile.mockResolvedValue({
      personaId: 5,
      fileKey: "personas/1/5/chat.txt",
      originalName: "chat.txt",
      deletedRecords: 3,
    });
    const result = await appRouter.createCaller(ctxFor(1)).file.delete({ fileId: 11 });
    expect(result).toEqual({ deletedRecords: 3 });
    expect(deletePersonaFile).toHaveBeenCalledWith(11, 1);
    expect(storageDelete).toHaveBeenCalledWith("personas/1/5/chat.txt");
    expect(afterRecordsRemoved).toHaveBeenCalledWith({ personaId: 5, userId: 1 });
  });
});
