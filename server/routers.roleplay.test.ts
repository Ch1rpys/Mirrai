import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The role swap (C4.4).
 *
 * The limits are the server's: thirty turns, fifteen minutes, once a
 * day. The model is called with the user's own lines, fenced. And the
 * practice leaves no trace in the conversation.
 */
const getPersonaById = vi.fn();
const countRecords = vi.fn();
const countRoleplaySessionsSince = vi.fn();
const createRoleplaySession = vi.fn();
const getRoleplaySession = vi.fn();
const updateRoleplaySession = vi.fn();
const getPersonaStyleProfile = vi.fn();
const candidateRecordsByOverlap = vi.fn();
const createJournalEntry = vi.fn();
const createSafetyEvent = vi.fn();
const invokeWithProvider = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  countRoleplaySessionsSince: (...a: unknown[]) => countRoleplaySessionsSince(...a),
  createRoleplaySession: (...a: unknown[]) => createRoleplaySession(...a),
  getRoleplaySession: (...a: unknown[]) => getRoleplaySession(...a),
  updateRoleplaySession: (...a: unknown[]) => updateRoleplaySession(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  candidateRecordsByOverlap: (...a: unknown[]) => candidateRecordsByOverlap(...a),
  createJournalEntry: (...a: unknown[]) => createJournalEntry(...a),
  createSafetyEvent: (...a: unknown[]) => createSafetyEvent(...a),
}));

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    llmService: {
      ...actual.llmService,
      invokeWithProvider: (...a: unknown[]) => invokeWithProvider(...a),
      invoke: (...a: unknown[]) => invokeWithProvider(...a),
    },
  };
});

vi.mock("./llm/user-provider", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    resolveProviderForUser: async () => ({ name: "test", isConfigured: () => true, invoke: async () => "" }),
  };
});

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

const persona = { id: 5, userId: 1, name: "小满" };
const startedAt = new Date("2026-03-10T10:00:00Z");
const session = {
  id: 11,
  userId: 1,
  personaId: 5,
  startedAt,
  endedAt: null,
  turns: 0,
  transcript: [],
};

describe("roleplay routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    countRecords.mockResolvedValue(400);
    countRoleplaySessionsSince.mockResolvedValue(0);
    createRoleplaySession.mockResolvedValue(11);
    getRoleplaySession.mockResolvedValue(session);
    createSafetyEvent.mockResolvedValue(1);
    updateRoleplaySession.mockResolvedValue(true);
    getPersonaStyleProfile.mockResolvedValue({
      userSide: { samples: 300, sampleLines: ["我到家了"], fingerprint: null },
    });
    candidateRecordsByOverlap.mockResolvedValue([
      { id: 1, content: "我今天有点累", role: "user", timestamp: new Date(), speaker: "阿树", coverage: 1 },
    ]);
    invokeWithProvider.mockResolvedValue("我知道，先歇一会儿吧。");
    createJournalEntry.mockResolvedValue(21);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses to rebuild a self out of too little", async () => {
    countRecords.mockResolvedValue(30);
    await expect(
      appRouter.createCaller(ctxFor(1)).roleplay.start({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createRoleplaySession).not.toHaveBeenCalled();
  });

  it("allows one practice a day for each persona", async () => {
    countRoleplaySessionsSince.mockResolvedValue(1);
    await expect(
      appRouter.createCaller(ctxFor(1)).roleplay.start({ personaId: 5 }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // The cap is per persona, not per user: another persona has its own
    // one practice.
    expect(countRoleplaySessionsSince).toHaveBeenCalledWith(1, expect.any(Date), 5);
  });

  it("starts a practice with fifteen minutes and thirty turns", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).roleplay.start({ personaId: 5 });
    expect(result).toEqual({ sessionId: 11, remainingSeconds: 900, remainingTurns: 30 });
  });

  it("stops before the thirty-first turn without calling the model", async () => {
    getRoleplaySession.mockResolvedValue({ ...session, turns: 30 });
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.say({ sessionId: 11, text: "在吗" });
    expect(result).toEqual({ ended: true });
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("stops at sixteen minutes without calling the model", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:16:00Z"));
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.say({ sessionId: 11, text: "在吗" });
    expect(result).toEqual({ ended: true });
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("plays the user from their own fenced lines", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.say({ sessionId: 11, text: "今天好累" });
    expect((result as any).reply).toBe("我知道，先歇一会儿吧。");
    const request = invokeWithProvider.mock.calls[0][1];
    // The call is attributed, so the role-play spend lands in the
    // user's ledger (C8.9).
    expect(request.usage).toEqual({ userId: 1, personaId: 5 });
    const system = request.messages[0];
    expect(system.role).toBe("system");
    expect(system.content).toContain("我今天有点累");
    expect(system.content).toMatch(/MATERIAL>>>:[0-9a-f]+/);
    expect(updateRoleplaySession).toHaveBeenCalledWith(
      11,
      1,
      expect.objectContaining({ turns: 1 }),
    );
  });

  it("ends the practice when the words are a crisis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.say({ sessionId: 11, text: "我不想活了" });
    expect(result).toEqual({ ended: true, crisis: true });
    expect(invokeWithProvider).not.toHaveBeenCalled();
  });

  it("writes the closing note into the user's own diary", async () => {
    const note = "站在她那边，我才发现她也在害怕。";
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.end({ sessionId: 11, note });
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, personaId: 5, body: note }),
    );
    expect(result).toEqual({ success: true, journalId: 21 });
  });

  it("stops the closing note and shows the crisis card when the note is a crisis (C4.4)", async () => {
    // The closing note is free writing, so WP12's rule applies to it as
    // well: a hit is shown as the crisis card, and the note is not
    // written into the diary.
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.end({ sessionId: 11, note: "我不想活了" });
    expect(result).toMatchObject({ crisis: true });
    expect(createJournalEntry).not.toHaveBeenCalled();
    expect(createSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, personaId: 5, type: "crisis" }),
    );
  });

  it("leaves the conversation alone", () => {
    const source = readFileSync(
      path.resolve(__dirname, "routers-v6/roleplay.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createMessage|updatePersona|incrementChatCount|extractMemories|updateEmotionalState/);
  });
});
