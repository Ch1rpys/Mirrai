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
const createMessage = vi.fn();
const extractMemories = vi.fn();
const updatePersona = vi.fn();
const incrementChatCount = vi.fn();
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
  // The practice must leave the conversation alone (C4.4): these are the
  // write paths a chat turn goes through, spied so the assertion is a
  // call count rather than a source scan.
  createMessage: (...a: unknown[]) => createMessage(...a),
  extractMemories: (...a: unknown[]) => extractMemories(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
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

/**
 * The stored measurement the user can turn off (C10.6).
 *
 * The prompt is rebuilt from "my side" of the record, so the measurement
 * that reaches it is `styleProfile.userSide`. The switch is
 * `settings.disabledProfiles`; a read that goes to the database directly
 * cannot see it.
 */
const storedProfile = {
  version: 1,
  measuredAt: "2026-03-01T00:00:00.000Z",
  recordsVersion: "400:900",
  userSide: {
    samples: 320,
    sampleLines: ["我刚到楼下", "你吃了吗"],
  },
  /**
   * How I address them, as B3.8 measured it: only the `me_to_them`
   * direction is mine, the three strongest forms are the habit, and a
   * form the other person uses for me is not mine to use.
   */
  addressHistory: [
    { form: "满儿", direction: "me_to_them", total: 30, byQuarter: {}, byState: {} },
    { form: "小满", direction: "me_to_them", total: 10, byQuarter: {}, byState: {} },
    { form: "阿满", direction: "me_to_them", total: 5, byQuarter: {}, byState: {} },
    { form: "宝贝", direction: "me_to_them", total: 1, byQuarter: {}, byState: {} },
    { form: "树树", direction: "them_to_me", total: 40, byQuarter: {}, byState: {} },
  ],
};

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  styleProfile: storedProfile,
  settings: {},
};
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
    /**
     * Still stubbed: the pre-fix generation path read the stored profile
     * straight from the table, so this is what a regression would call.
     */
    getPersonaStyleProfile.mockResolvedValue(storedProfile);
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
    // The measured user side is still material, read through the
    // effective profile (C10.6).
    expect(system.content).toContain("我刚到楼下");
    expect(updateRoleplaySession).toHaveBeenCalledWith(
      11,
      1,
      expect.objectContaining({ turns: 1 }),
    );
  });

  it("rebuilds the self from the effective profile when userSide is turned off (C10.6)", async () => {
    /**
     * The user said "don't use this" for the user-side measurement
     * (C10.6). The profile is still on the persona row, but the prompt
     * must not carry a line the measurement produced — and it must still
     * carry what was not turned off (the real lines near the one being
     * answered).
     *
     * Before the fix the route read `getPersonaStyleProfile` directly:
     * the switch lives in `settings`, so that read could not see it and
     * this test failed on the two `not.toContain` assertions.
     */
    getPersonaById.mockResolvedValue({
      ...persona,
      settings: { disabledProfiles: ["userSide"] },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    const result = await appRouter
      .createCaller(ctxFor(1))
      .roleplay.say({ sessionId: 11, text: "今天好累" });
    expect((result as any).reply).toBe("我知道，先歇一会儿吧。");
    const system = invokeWithProvider.mock.calls[0][1].messages[0].content as string;
    expect(system).not.toContain("我刚到楼下");
    expect(system).not.toContain("你吃了吗");
    expect(system).toContain("我今天有点累");
    expect(system).toMatch(/MATERIAL>>>:[0-9a-f]+/);
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

  it("puts how I address them into the self prompt (C4.4)", async () => {
    /**
     * The manual's material is `styleProfile.userSide` — my fingerprint
     * *and* my address habit. The prompt carried the prose and the
     * representative lines but never how I call them, so the replica
     * sounded like me and named them like a stranger.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    await appRouter.createCaller(ctxFor(1)).roleplay.say({ sessionId: 11, text: "今天好累" });
    const system = invokeWithProvider.mock.calls[0][1].messages[0].content as string;
    // The three strongest me→them forms, strongest first.
    expect(system).toContain("我平时叫小满「满儿、小满、阿满」");
    // The fourth form is below the habit's top three; another person's
    // name for me is not mine to use.
    expect(system).not.toContain("宝贝");
    expect(system).not.toContain("树树");
    // It is material, fenced with the rest.
    expect(system).toMatch(/MATERIAL>>>:[0-9a-f]+/);
  });

  it("takes the self's examples from the user's own rows (C4.4)", async () => {
    /**
     * The manual's examples are the user's real lines — `role: "user"`
     * rows retrieved near the line being answered. A candidate from the
     * other side must never be shown as "how I say things".
     */
    candidateRecordsByOverlap.mockResolvedValue([
      { id: 1, content: "我今天有点累", role: "user", timestamp: new Date(), speaker: "阿树", coverage: 1 },
      { id: 2, content: "这是分身说的示范", role: "assistant", timestamp: new Date(), speaker: "小满", coverage: 1 },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    await appRouter.createCaller(ctxFor(1)).roleplay.say({ sessionId: 11, text: "今天好累" });
    // The retrieval is asked for my lines, on my own persona.
    expect(candidateRecordsByOverlap).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ text: "今天好累", role: "user" }),
    );
    const system = invokeWithProvider.mock.calls[0][1].messages[0].content as string;
    expect(system).toContain("我今天有点累");
    expect(system).not.toContain("这是分身说的示范");
  });

  it("leaves the conversation alone across start, say and end (C4.4)", async () => {
    // The manual's call-count acceptance, as spies rather than a source
    // scan: no message, no memory extraction, no persona write and no
    // chat count from any part of the practice.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:05:00Z"));
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.roleplay.start({ personaId: 5 });
    await caller.roleplay.say({ sessionId: 11, text: "在吗" });
    await caller.roleplay.end({ sessionId: 11, note: "换回来以后有点不一样" });
    // The practice paths really ran.
    expect(createRoleplaySession).toHaveBeenCalled();
    expect(invokeWithProvider).toHaveBeenCalled();
    expect(createJournalEntry).toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
    expect(extractMemories).not.toHaveBeenCalled();
    expect(updatePersona).not.toHaveBeenCalled();
    expect(incrementChatCount).not.toHaveBeenCalled();
  });

  it("leaves the conversation alone in the source, too", () => {
    const source = readFileSync(
      path.resolve(__dirname, "routers-v6/roleplay.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createMessage|updatePersona|incrementChatCount|extractMemories|updateEmotionalState/);
  });
});
