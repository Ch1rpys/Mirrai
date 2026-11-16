import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getRecordSourceSummary = vi.fn();
const getFilesByPersonaId = vi.fn();
const deleteRecordsBySource = vi.fn();
const afterRecordsRemoved = vi.fn();

vi.mock("../_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
  afterRecordsRemoved: (...a: unknown[]) => afterRecordsRemoved(...a),
  measureStyleProfile: vi.fn(),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getRecordSourceSummary: (...a: unknown[]) => getRecordSourceSummary(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  deleteRecordsBySource: (...a: unknown[]) => deleteRecordsBySource(...a),
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
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    locale: "zh",
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as TrpcContext["req"],
    res: { cookie: () => {}, clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe("record.sources and record.deleteSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getFilesByPersonaId.mockResolvedValue([]);
    getRecordSourceSummary.mockResolvedValue([]);
    deleteRecordsBySource.mockResolvedValue(0);
    afterRecordsRemoved.mockResolvedValue(undefined);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).record.sources({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      appRouter.createCaller(ctxFor(1)).record.deleteSource({ personaId: 99, source: "sms" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("joins the file name onto a source row", async () => {
    getRecordSourceSummary.mockResolvedValue([
      {
        source: "wechat_export",
        fileId: 11,
        count: 13,
        firstAt: new Date("2022-03-01T12:00:00.000Z"),
        lastAt: new Date("2022-03-02T12:00:00.000Z"),
      },
    ]);
    getFilesByPersonaId.mockResolvedValue([
      {
        id: 11,
        originalName: "chat.txt",
        fileType: "chat_txt",
        parseStatus: "done",
        parseReport: { format: "wechat-txt-2line" },
      },
    ]);
    const rows = await appRouter.createCaller(ctxFor(1)).record.sources({ personaId: 5 });
    expect(rows).toEqual([
      {
        source: "wechat_export",
        fileId: 11,
        name: "chat.txt",
        format: "wechat-txt-2line",
        count: 13,
        firstAt: "2022-03-01T12:00:00.000Z",
        lastAt: "2022-03-02T12:00:00.000Z",
        status: "done",
      },
    ]);
  });

  it("drops every row of one collector source", async () => {
    deleteRecordsBySource.mockResolvedValue(4);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.deleteSource({ personaId: 5, source: "sms" });
    expect(result).toEqual({ deletedRecords: 4 });
    expect(deleteRecordsBySource).toHaveBeenCalledWith(5, 1, "sms");
    expect(afterRecordsRemoved).toHaveBeenCalledWith({ personaId: 5, userId: 1 });
  });
});
