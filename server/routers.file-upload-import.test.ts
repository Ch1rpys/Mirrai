import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Uploading a chat file writes records, not just an excerpt.
 *
 * The old upload stored the text on `persona_files` and left the
 * record table empty, so a persona that had only been uploaded had
 * nothing for exemplars, rhythm, or evaluation to read.
 */

const getPersonaById = vi.fn();
const createPersonaFile = vi.fn();
const createCollectedMessages = vi.fn();
const countRecords = vi.fn();
const getPersonaFileById = vi.fn();
const updatePersonaFile = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `/uploads/${key}` })),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createPersonaFile: (...a: unknown[]) => createPersonaFile(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  MAX_RECORDS_PER_PERSONA: 1_000_000,
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

const TRANSCRIPT = [
  "[2022-03-01 20:00:00] 小满：在吗",
  "[2022-03-01 20:00:05] 阿树：在的",
].join("\n");

describe("file.upload writes records", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    createPersonaFile.mockResolvedValue(99);
    getPersonaFileById.mockResolvedValue({
      id: 99,
      personaId: 5,
      userId: 1,
      fileType: "chat_txt",
      originalName: "chat.txt",
    });
    updatePersonaFile.mockResolvedValue(true);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    countRecords.mockResolvedValue(0);
    createCollectedMessages.mockImplementation(async (rows: unknown[]) => (rows as unknown[]).length);
  });

  it("calls createCollectedMessages with fileId, lineNo, kind, and speaker", async () => {
    const fileContent = Buffer.from(TRANSCRIPT, "utf-8").toString("base64");
    const result = await appRouter.createCaller(ctxFor(1)).file.upload({
      personaId: 5,
      fileName: "chat.txt",
      fileType: "chat_txt",
      fileSize: Buffer.from(TRANSCRIPT, "utf-8").length,
      fileContent,
      mimeType: "text/plain",
    });

    expect(result.fileId).toBe(99);
    expect(createCollectedMessages).toHaveBeenCalled();
    const rows = createCollectedMessages.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fileId: 99,
      lineNo: 1,
      kind: "text",
      speaker: "小满",
    });
    expect(rows[1]).toMatchObject({
      fileId: 99,
      lineNo: 2,
      kind: "text",
      speaker: "阿树",
    });
  });
});
