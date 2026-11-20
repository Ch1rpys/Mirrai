import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const updatePersona = vi.fn();
const getWaitingNotes = vi.fn();
const getOutboundLetters = vi.fn();
const getLetters = vi.fn();
const getUserMoodsBetween = vi.fn();
const getRecentCheckinAnswers = vi.fn();

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getPersonaById: (...args: unknown[]) => getPersonaById(...args),
    getPersonaSettings: (...args: unknown[]) => getPersonaSettings(...args),
    setPersonaSettings: (...args: unknown[]) => setPersonaSettings(...args),
    updatePersona: (...args: unknown[]) => updatePersona(...args),
    getWaitingNotes: (...args: unknown[]) => getWaitingNotes(...args),
    getOutboundLetters: (...args: unknown[]) => getOutboundLetters(...args),
    getLetters: (...args: unknown[]) => getLetters(...args),
    getUserMoodsBetween: (...args: unknown[]) => getUserMoodsBetween(...args),
    getRecentCheckinAnswers: (...args: unknown[]) => getRecentCheckinAnswers(...args),
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
      name: `User ${userId}`,
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const PERSONA = {
  id: 1,
  userId: 1,
  name: "小满",
  reachability: "reachable",
  updatedAt: new Date("2026-03-01T00:00:00Z"),
};

describe("coming back after a stretch of no contact (C5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(PERSONA);
    getPersonaSettings.mockResolvedValue({});
    setPersonaSettings.mockResolvedValue(true);
    updatePersona.mockResolvedValue(true);
    getWaitingNotes.mockResolvedValue([]);
    getOutboundLetters.mockResolvedValue([]);
    getLetters.mockResolvedValue([]);
    getUserMoodsBetween.mockResolvedValue([]);
    getRecentCheckinAnswers.mockResolvedValue([]);
  });

  it("records when contact was lost", async () => {
    const before = Date.now();
    await appRouter.createCaller(ctxFor(1)).persona.update({
      id: 1,
      reachability: "unreachable",
    });
    const written = setPersonaSettings.mock.calls[0][2];
    expect(typeof written.unreachableSince).toBe("string");
    expect(new Date(written.unreachableSince).getTime()).toBeGreaterThanOrEqual(before);
    expect(written.lastReunion).toBeUndefined();
  });

  it("returns the stretch and keeps it when contact comes back", async () => {
    getPersonaById.mockResolvedValue({ ...PERSONA, reachability: "unreachable" });
    getPersonaSettings.mockResolvedValue({
      unreachableSince: "2026-02-01T00:00:00.000Z",
    });
    const result = await appRouter.createCaller(ctxFor(1)).persona.update({
      id: 1,
      reachability: "reachable",
    });
    expect(result.reunion).toEqual({
      from: "2026-02-01T00:00:00.000Z",
      to: expect.any(String),
    });
    const written = setPersonaSettings.mock.calls[0][2];
    expect(written.lastReunion).toEqual({
      from: "2026-02-01T00:00:00.000Z",
      to: expect.any(String),
    });
    expect(written.unreachableSince).toBeUndefined();
  });

  it("writes nothing when reachability did not change", async () => {
    await appRouter.createCaller(ctxFor(1)).persona.update({
      id: 1,
      reachability: "reachable",
      name: "小满",
    });
    expect(setPersonaSettings).not.toHaveBeenCalled();
    expect(updatePersona).toHaveBeenCalled();
  });

  it("summarises only what happened between the two moments", async () => {
    getPersonaSettings.mockResolvedValue({
      lastReunion: { from: "2026-02-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" },
    });
    getWaitingNotes.mockResolvedValue([
      { id: 1, body: "一直想说的", doneAt: null, createdAt: new Date("2026-02-10T00:00:00Z") },
      { id: 2, body: "已经在里面了", doneAt: null, createdAt: new Date("2025-12-01T00:00:00Z") },
      { id: 3, body: "已经说过", doneAt: new Date("2026-02-12T00:00:00Z"), createdAt: new Date("2026-02-11T00:00:00Z") },
    ]);
    getOutboundLetters.mockResolvedValue([
      { id: 4, text: "还没说出口", status: "ready", createdAt: new Date("2026-02-15T00:00:00Z") },
      { id: 5, text: "已经说了", status: "sent", createdAt: new Date("2026-02-16T00:00:00Z") },
    ]);
    getLetters.mockResolvedValue([
      { id: 6, body: "写了一封信", createdAt: new Date("2026-02-20T00:00:00Z") },
      { id: 7, body: "很久以前", createdAt: new Date("2025-01-01T00:00:00Z") },
    ]);
    getUserMoodsBetween.mockResolvedValue([
      { date: "2026-02-21", mood: "melancholy" },
    ]);
    getRecentCheckinAnswers.mockResolvedValue([
      { answer: "better", createdAt: new Date("2026-02-22T00:00:00Z") },
      { answer: "worse", createdAt: new Date("2025-01-01T00:00:00Z") },
    ]);

    const result = await appRouter.createCaller(ctxFor(1)).persona.reunionSummary({ personaId: 1 });
    expect(result?.todos.map((row) => row.id)).toEqual([1]);
    expect(result?.unsaid.map((row) => row.id)).toEqual([4]);
    expect(result?.letters.map((row) => row.id)).toEqual([6]);
    expect(result?.moods).toEqual([{ date: "2026-02-21", mood: "melancholy" }]);
    expect(result?.answers.map((row) => row.answer)).toEqual(["better"]);
    expect(getUserMoodsBetween).toHaveBeenCalledWith(1, "2026-02-01", "2026-03-01");
  });

  it("has no summary when the two of them never lost touch", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.reunionSummary({ personaId: 1 }),
    ).resolves.toBeNull();
  });

  it("does not read another user's persona", async () => {
    getPersonaById.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(ctxFor(2)).persona.reunionSummary({ personaId: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      appRouter.createCaller(ctxFor(2)).persona.update({ id: 1, reachability: "unreachable" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
