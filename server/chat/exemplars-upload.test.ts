import { describe, expect, it, vi, beforeEach } from "vitest";
import { copy } from "@shared/copy";
import type { TrpcContext } from "../_core/context";

/**
 * An uploaded transcript has to show up as exemplars.
 *
 * Before the record table was filled on upload, a persona that had
 * only ever been given a file had an empty collected-messages list, so
 * `exemplarSectionFor` returned "" — the prompt had no "what they
 * actually said". The assertion below is "the section is there"; on
 * that old path it is red.
 */

const getPersonaById = vi.fn();
const createPersonaFile = vi.fn();
const createCollectedMessages = vi.fn();
const countRecords = vi.fn();
const getPersonaFileById = vi.fn();
const updatePersonaFile = vi.fn();
const getUserTimezone = vi.fn();
const getUserById = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const getLatestChatSummary = vi.fn();
const getRecentUserMood = vi.fn();
const getRelationshipEvents = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const retrieveMemories = vi.fn();

let imported: Array<Record<string, unknown>> = [];

vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `/uploads/${key}` })),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createPersonaFile: (...a: unknown[]) => createPersonaFile(...a),
  createCollectedMessages: (...a: unknown[]) => createCollectedMessages(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  getPersonaFileById: (...a: unknown[]) => getPersonaFileById(...a),
  updatePersonaFile: (...a: unknown[]) => updatePersonaFile(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  getUserById: (...a: unknown[]) => getUserById(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  getLatestChatSummary: (...a: unknown[]) => getLatestChatSummary(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getRelationshipEvents: (...a: unknown[]) => getRelationshipEvents(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  MAX_RECORDS_PER_PERSONA: 1_000_000,
}));

vi.mock("./retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./retrieval")>();
  return {
    ...actual,
    retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
  };
});

import { appRouter } from "../routers";
import { buildPromptForPersona } from "./prompt";

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
  "[2022-03-01 20:00:00] 阿树：在吗",
  "[2022-03-01 20:00:05] 小满：在的呀",
].join("\n");

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  personaData: { personality: "短句", speakingStyle: "轻轻说" },
} as any;

describe("exemplars from an uploaded file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imported = [];
    getPersonaById.mockResolvedValue(persona);
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
    createCollectedMessages.mockImplementation(async (rows: Array<Record<string, unknown>>) => {
      imported = rows.map((row, index) => ({ id: index + 1, ...row }));
      return rows.length;
    });
    getCollectedMessagesForPersona.mockImplementation(async () => imported);
    getLatestChatSummary.mockResolvedValue(null);
    getRecentUserMood.mockResolvedValue(null);
    getRelationshipEvents.mockResolvedValue([]);
    getMemoriesByPersonaId.mockResolvedValue([]);
    retrieveMemories.mockResolvedValue([]);
  });

  it("leaves the exemplar section empty when nothing has been imported", async () => {
    const prompt = await buildPromptForPersona({
      persona,
      userId: 1,
      userMessage: "在吗",
    });
    expect(prompt).not.toContain(copy("zh", "prompt.exemplarsHeading"));
  });

  it("puts TA's uploaded lines in the prompt after the file is imported", async () => {
    const fileContent = Buffer.from(TRANSCRIPT, "utf-8").toString("base64");
    await appRouter.createCaller(ctxFor(1)).file.upload({
      personaId: 5,
      fileName: "chat.txt",
      fileType: "chat_txt",
      fileSize: Buffer.from(TRANSCRIPT, "utf-8").length,
      fileContent,
      mimeType: "text/plain",
    });
    expect(imported.length).toBeGreaterThan(0);

    const prompt = await buildPromptForPersona({
      persona,
      userId: 1,
      userMessage: "在吗",
    });
    expect(prompt).toContain(copy("zh", "prompt.exemplarsHeading"));
    expect(prompt).toContain("在的呀");
    expect(getCollectedMessagesForPersona).toHaveBeenCalledWith(5, 1, { newest: true });
  });
});
