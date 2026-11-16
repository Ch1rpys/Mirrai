import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getFilesByPersonaId = vi.fn();
const createCollectedMessages = vi.fn();
const countRecords = vi.fn();
const getPersonaFileById = vi.fn();
const updatePersonaFile = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const resolveStoredPath = vi.fn();
const readFile = vi.fn();

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: (...a: unknown[]) => readFile(...a),
}));

vi.mock("../storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveStoredPath: (...a: unknown[]) => resolveStoredPath(...a),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  MAX_RECORDS_PER_PERSONA: 1_000_000,
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

const DISK_TEXT = [
  "[2022-03-01 20:00:00] 小满：在吗",
  "[2022-03-01 20:00:05] 阿树：在的",
].join("\n");

describe("import.backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getFilesByPersonaId.mockResolvedValue([
      {
        id: 11,
        personaId: 5,
        userId: 1,
        fileType: "chat_txt",
        parseStatus: null,
        fileKey: "personas/1/5/old.txt",
        originalName: "old.txt",
        extractedMemory: "this excerpt must not be parsed",
      },
      {
        id: 12,
        personaId: 5,
        userId: 1,
        fileType: "chat_txt",
        parseStatus: "done",
        fileKey: "personas/1/5/done.txt",
        originalName: "done.txt",
      },
      {
        id: 13,
        personaId: 5,
        userId: 1,
        fileType: "image",
        parseStatus: null,
        fileKey: "personas/1/5/pic.png",
        originalName: "pic.png",
      },
    ]);
    getPersonaFileById.mockImplementation(async (id: number) => ({
      id,
      personaId: 5,
      userId: 1,
      fileType: "chat_txt",
      originalName: "old.txt",
      fileKey: "personas/1/5/old.txt",
      fileSize: Buffer.byteLength(DISK_TEXT),
      parseStatus: null,
      parseReport: null,
    }));
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    countRecords.mockResolvedValue(0);
    createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
    resolveStoredPath.mockReturnValue("/tmp/old.txt");
    readFile.mockResolvedValue(Buffer.from(DISK_TEXT, "utf-8"));
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).import.backfill({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("imports unparsed chat files from disk, not from the truncated excerpt", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.backfill({ personaId: 5 });
    expect(result.count).toBe(1);
    expect(result.results).toEqual([{ fileId: 11, status: "done", written: 2 }]);
    expect(resolveStoredPath).toHaveBeenCalledWith("personas/1/5/old.txt");
    expect(readFile).toHaveBeenCalledWith("/tmp/old.txt");
    expect(readFile).toHaveBeenCalledTimes(1);
    const rows = createCollectedMessages.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.content)).toEqual(["在吗", "在的"]);
    expect(rows.every((row) => row.content !== "this excerpt must not be parsed")).toBe(true);
  });
});

describe("import.status / preview / confirm / cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    getPersonaFileById.mockImplementation(async (id: number) => ({
      id,
      personaId: 5,
      userId: 1,
      fileType: "chat_txt",
      originalName: "old.txt",
      fileKey: "personas/1/5/old.txt",
      fileSize: Buffer.byteLength(DISK_TEXT),
      parseStatus: "needs_roles",
      parseReport: { format: "generic-line" },
    }));
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    countRecords.mockResolvedValue(0);
    createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
    resolveStoredPath.mockReturnValue("/tmp/old.txt");
    readFile.mockResolvedValue(Buffer.from(DISK_TEXT, "utf-8"));
  });

  it("does not read somebody else's file", async () => {
    getPersonaFileById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.import.status({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.import.preview({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.import.confirm({ fileId: 99, format: "generic-line", me: ["阿树"], them: ["小满"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.import.cancel({ fileId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns parseStatus without the extracted text", async () => {
    const status = await appRouter.createCaller(ctxFor(1)).import.status({ fileId: 11 });
    expect(status).toMatchObject({
      fileId: 11,
      parseStatus: "needs_roles",
      originalName: "old.txt",
    });
    expect(status).not.toHaveProperty("extractedMemory");
    expect(status).not.toHaveProperty("fileKey");
  });

  it("previews the first records without writing any", async () => {
    updatePersonaFile.mockClear();
    createCollectedMessages.mockClear();
    const preview = await appRouter.createCaller(ctxFor(1)).import.preview({ fileId: 11 });
    expect(preview.status).toBe("ok");
    expect(preview.total).toBe(2);
    expect(preview.records.map((row) => row.speaker)).toEqual(["小满", "阿树"]);
    expect(preview.records.map((row) => row.content)).toEqual(["在吗", "在的"]);
    expect(createCollectedMessages).not.toHaveBeenCalled();
    expect(updatePersonaFile).not.toHaveBeenCalled();
  });

  it("refuses confirm in needs_roles when neither side is named", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).import.confirm({
        fileId: 11,
        format: "generic-line",
        me: [],
        them: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createCollectedMessages).not.toHaveBeenCalled();
  });

  it("writes records when confirm names both sides", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.confirm({
      fileId: 11,
      format: "generic-line",
      me: ["阿树"],
      them: ["小满"],
    });
    expect(result).toMatchObject({ status: "done", written: 2 });
    expect(createCollectedMessages).toHaveBeenCalled();
  });

  it("marks a cancelled import as failed", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).import.cancel({ fileId: 11 });
    expect(result).toEqual({ status: "failed" });
    expect(updatePersonaFile).toHaveBeenCalledWith(
      11,
      1,
      expect.objectContaining({ parseStatus: "failed" }),
    );
  });

  it("lists registered formats for the wizard", async () => {
    const formats = await appRouter.createCaller(ctxFor(1)).import.formats();
    const ids = formats.map((row) => row.id) as string[];
    expect(ids).toContain("generic-line");
    expect(ids).not.toContain("wechat-html");
    expect(formats[0]).toHaveProperty("label");
  });
});
