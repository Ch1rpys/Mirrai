import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { rateLimiter } from "./_core/rate-limit";
import type { TrpcContext } from "./_core/context";
import { copy } from "@shared/copy";
import { hashBlindToken } from "./eval/blind";

const getPersonaById = vi.fn();
const getLatestEvalRun = vi.fn();
const getEvalCases = vi.fn();
const createBlindSession = vi.fn();
const updateBlindSession = vi.fn();
const getBlindSession = vi.fn();
const getBlindSessionByTokenHash = vi.fn();
const updateBlindSessionByTokenHash = vi.fn();
const listBlindSessions = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getLatestEvalRun: (...a: unknown[]) => getLatestEvalRun(...a),
  getEvalCases: (...a: unknown[]) => getEvalCases(...a),
  createBlindSession: (...a: unknown[]) => createBlindSession(...a),
  updateBlindSession: (...a: unknown[]) => updateBlindSession(...a),
  getBlindSession: (...a: unknown[]) => getBlindSession(...a),
  getBlindSessionByTokenHash: (...a: unknown[]) => getBlindSessionByTokenHash(...a),
  updateBlindSessionByTokenHash: (...a: unknown[]) => updateBlindSessionByTokenHash(...a),
  listBlindSessions: (...a: unknown[]) => listBlindSessions(...a),
}));

import { appRouter } from "./routers";

const ORIGINAL = "我今天去了拾光咖啡喝桂花拿铁";

function ctxFor(userId: number, ip = "10.0.0.8"): TrpcContext {
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
    req: { ip, socket: { remoteAddress: ip }, headers: {} } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

function twelveScores() {
  return Array.from({ length: 12 }, (_, i) => ({
    caseId: i,
    expectedText: `${ORIGINAL}${i}`,
    generatedText: `分身写的另一句${i}`,
  }));
}

/** Six stored pairs, the shape a small sitting has. */
function sixGroups() {
  return twelveScores()
    .slice(0, 6)
    .map((score, i) => ({
      caseId: i,
      real: score.expectedText,
      fake: score.generatedText,
      realFirst: i % 2 === 0,
    }));
}

/**
 * An in-memory `blind_sessions` table, so a test can walk the whole
 * guest path: the row the owner starts, the token written onto it, the
 * friend's answers, and the sitting closing at the end.
 */
function installBlindStore(initial: Array<Record<string, any>> = []) {
  const rows = new Map<number, Record<string, any>>(
    initial.map((row) => [
      row.id,
      {
        tokenHash: null,
        expiresAt: null,
        finishedAt: null,
        answers: [],
        summary: null,
        ...row,
      },
    ]),
  );
  let nextId = Math.max(0, ...rows.keys()) + 1;
  createBlindSession.mockImplementation(async (data: Record<string, any>) => {
    const row = {
      id: nextId++,
      tokenHash: null,
      expiresAt: null,
      finishedAt: null,
      answers: [],
      summary: null,
      ...data,
    };
    rows.set(row.id, row);
    return row;
  });
  updateBlindSession.mockImplementation(
    async (id: number, _userId: number, patch: Record<string, any>) => {
      const row = rows.get(id);
      if (!row) return undefined;
      Object.assign(row, patch);
      return row;
    },
  );
  getBlindSession.mockImplementation(async (id: number, userId: number) => {
    const row = rows.get(id);
    return row && row.userId === userId ? row : undefined;
  });
  getBlindSessionByTokenHash.mockImplementation(async (hash: string) =>
    [...rows.values()].find((row) => row.tokenHash === hash),
  );
  updateBlindSessionByTokenHash.mockImplementation(
    async (hash: string, patch: Record<string, any>) => {
      const row = [...rows.values()].find((candidate) => candidate.tokenHash === hash);
      if (!row) return undefined;
      Object.assign(row, patch);
      return row;
    },
  );
  return { rows };
}

describe("the in-app blind test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimiter.reset?.();
    getPersonaById.mockImplementation(async (id: number, userId: number) =>
      userId === 1 && id === 3 ? { id: 3, userId: 1, name: "小满" } : null,
    );
    getLatestEvalRun.mockResolvedValue({ id: 9, metricsJson: { scores: twelveScores() } });
    getEvalCases.mockResolvedValue(
      twelveScores().map((score, i) => ({
        id: i + 1,
        occurredAt: new Date(2020, 0, 1 + i),
      })),
    );
    createBlindSession.mockImplementation(async (data: any) => ({
      id: 7,
      userId: 1,
      personaId: 3,
      ...data,
    }));
    updateBlindSession.mockImplementation(async (id: number, _userId: number, patch: any) => ({
      id,
      userId: 1,
      personaId: 3,
      subject: "self",
      groups: patch.groups,
      answers: patch.answers ?? [],
      summary: patch.summary ?? null,
      finishedAt: patch.finishedAt ?? null,
    }));
    listBlindSessions.mockResolvedValue([]);
  });

  it("does not tell the sitter which line is real", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).blind.start({
      personaId: 3,
      subject: "self",
    });
    const dumped = JSON.stringify(result);
    expect(dumped).not.toMatch(/real|said|expected|generated/i);
    expect(result.groups).toHaveLength(12);
    expect(result.groups[0]).toEqual(
      expect.objectContaining({ first: expect.any(String), second: expect.any(String) }),
    );
  });

  it("refuses somebody else's persona", async () => {
    await expect(
      appRouter.createCaller(ctxFor(2)).blind.start({ personaId: 3, subject: "self" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("asks for an evaluation when there are not enough pairs", async () => {
    getLatestEvalRun.mockResolvedValue({ id: 9, metricsJson: { scores: [twelveScores()[0]] } });
    await expect(
      appRouter.createCaller(ctxFor(1)).blind.start({ personaId: 3, subject: "self" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "eval.blind.needEval"),
    });
  });

  it("makes the three finish rates add up to one", async () => {
    const groups = twelveScores().map((score, i) => ({
      caseId: score.caseId,
      real: score.expectedText,
      fake: score.generatedText,
      realFirst: i % 2 === 0,
    }));
    getBlindSession.mockResolvedValue({
      id: 7,
      userId: 1,
      personaId: 3,
      subject: "self",
      groups,
      answers: groups.map((_, i) => ({
        group: i,
        pick: i % 3 === 0 ? "first" : i % 3 === 1 ? "second" : "unsure",
        seconds: 3,
      })),
      startedAt: new Date("2026-11-17T00:00:00.000Z"),
    });
    const result = await appRouter.createCaller(ctxFor(1)).blind.finish({ sessionId: 7 });
    expect(
      result.summary.pickedReal + result.summary.pickedPersona + result.summary.unsure,
    ).toBeCloseTo(1, 10);
  });

  it("exports a record that does not contain the original line", async () => {
    getBlindSession.mockResolvedValue({
      id: 7,
      userId: 1,
      personaId: 3,
      subject: "self",
      groups: [
        { caseId: 0, real: ORIGINAL, fake: "分身写的另一句", realFirst: true },
      ],
      answers: [{ group: 0, pick: "first", seconds: 4, reason: "word" }],
      startedAt: new Date("2026-11-17T00:00:00.000Z"),
      summary: { n: 1, pickedReal: 1, pickedPersona: 0, unsure: 0, medianSeconds: 4, reasons: { word: 1 } },
    });
    const { markdown } = await appRouter.createCaller(ctxFor(1)).blind.exportRecord({ sessionId: 7 });
    expect(markdown).not.toContain(ORIGINAL);
    expect(markdown).toContain("hitRate:");
    expect(markdown).toContain("pickedReal:");
  });

  it("refuses a bad, expired, or finished invite the same way", async () => {
    const sessions = [
      undefined,
      {
        id: 7,
        userId: 1,
        personaId: 3,
        groups: [],
        expiresAt: new Date(Date.now() - 1000),
        finishedAt: null,
      },
      {
        id: 7,
        userId: 1,
        personaId: 3,
        groups: [],
        expiresAt: new Date(Date.now() + 60_000),
        finishedAt: new Date(),
      },
    ];
    const failures = [];
    for (const [index, session] of sessions.entries()) {
      getBlindSessionByTokenHash.mockResolvedValueOnce(session);
      failures.push(
        await appRouter
          .createCaller({ ...ctxFor(1), user: null })
          .blind.guestLoad({ token: String(index).repeat(32) })
          .then(
            () => null,
            (error: TRPCError) => error,
          ),
      );
    }
    expect(failures.every((error) => error instanceof TRPCError)).toBe(true);
    expect(failures.map((error) => error?.code)).toEqual([
      "NOT_FOUND",
      "NOT_FOUND",
      "NOT_FOUND",
    ]);
    expect(new Set(failures.map((error) => error?.message)).size).toBe(1);
    expect(failures[0]?.message).not.toContain("失效");
    expect(failures[0]?.message).not.toContain("答完");
  });

  it("does not let one token write onto another sitting", async () => {
    const tokenA = "a".repeat(32);
    const tokenB = "b".repeat(32);
    getBlindSessionByTokenHash.mockImplementation(async (hash: string) => {
      if (hash === hashBlindToken(tokenA)) {
        return {
          id: 1,
          userId: 1,
          personaId: 3,
          groups: [{ caseId: 0, real: ORIGINAL, fake: "分身写的另一句", realFirst: true }],
          answers: [],
          expiresAt: new Date(Date.now() + 60_000),
          finishedAt: null,
        };
      }
      return undefined;
    });
    await appRouter.createCaller({ ...ctxFor(1), user: null }).blind.guestAnswer({
      token: tokenA,
      group: 0,
      pick: "first",
      seconds: 2,
    });
    expect(updateBlindSessionByTokenHash).toHaveBeenCalledWith(
      hashBlindToken(tokenA),
      expect.any(Object),
    );
    await expect(
      appRouter.createCaller({ ...ctxFor(1), user: null }).blind.guestAnswer({
        token: tokenB,
        group: 0,
        pick: "second",
        seconds: 2,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the last three finished sittings and hides somebody else's", async () => {
    listBlindSessions.mockResolvedValue([
      {
        id: 4,
        subject: "self",
        startedAt: new Date("2026-03-04T00:00:00.000Z"),
        finishedAt: new Date("2026-03-04T00:10:00.000Z"),
        summary: { n: 12, pickedReal: 0.5, pickedPersona: 0.4, unsure: 0.1 },
      },
      {
        id: 3,
        subject: "friend",
        startedAt: new Date("2026-03-03T00:00:00.000Z"),
        finishedAt: new Date("2026-03-03T00:10:00.000Z"),
        summary: { n: 12, pickedReal: 0.6, pickedPersona: 0.3, unsure: 0.1 },
      },
      {
        id: 2,
        subject: "self",
        startedAt: new Date("2026-03-02T00:00:00.000Z"),
        finishedAt: new Date("2026-03-02T00:10:00.000Z"),
        summary: { n: 12, pickedReal: 0.4, pickedPersona: 0.4, unsure: 0.2 },
      },
      {
        id: 1,
        subject: "self",
        startedAt: new Date("2026-03-01T00:00:00.000Z"),
        finishedAt: new Date("2026-03-01T00:10:00.000Z"),
        summary: { n: 12, pickedReal: 0.3, pickedPersona: 0.5, unsure: 0.2 },
      },
    ]);
    const listed = await appRouter.createCaller(ctxFor(1)).blind.list({ personaId: 3 });
    expect(listed.sessions.map((row) => row.id)).toEqual([4, 3, 2]);
    expect(listed.sessions[0]).not.toHaveProperty("groups");
    await expect(
      appRouter.createCaller(ctxFor(2)).blind.list({ personaId: 3 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not invite from somebody else's sitting", async () => {
    getBlindSession.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(2)).blind.invite({ sessionId: 7 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createBlindSession).not.toHaveBeenCalled();
    expect(updateBlindSession).not.toHaveBeenCalled();
  });

  it("gives the invite of a finished sitting a fresh sitting a guest can open", async () => {
    const finished = {
      id: 7,
      userId: 1,
      personaId: 3,
      subject: "self",
      groups: sixGroups(),
      answers: sixGroups().map((_, i) => ({ group: i, pick: "first", seconds: 3 })),
      summary: { n: 6, pickedReal: 0.5, pickedPersona: 0.5, unsure: 0, medianSeconds: 3, reasons: {} },
      startedAt: new Date("2026-11-17T00:00:00.000Z"),
      finishedAt: new Date("2026-11-17T00:10:00.000Z"),
    };
    const { rows } = installBlindStore([finished]);
    const caller = appRouter.createCaller(ctxFor(1));

    const invite = await caller.blind.invite({ sessionId: 7 });

    // The token cannot point at the finished sitting: the guest route
    // closes a finished sitting by design. It points at a fresh one.
    expect(invite.sessionId).not.toBe(7);
    expect(rows.get(invite.sessionId)?.finishedAt).toBeNull();
    expect(rows.get(invite.sessionId)?.subject).toBe("friend");
    expect(invite.path).toBe(`/blind/${invite.token}`);

    // And a guest can actually open it.
    const guest = appRouter.createCaller({ ...ctxFor(1, "198.51.100.7"), user: null });
    const loaded = await guest.blind.guestLoad({ token: invite.token });
    expect(loaded.total).toBe(6);
    expect(loaded.groups).toHaveLength(6);
    expect(JSON.stringify(loaded)).not.toMatch(/real|said|expected|generated/i);

    // The owner's own sitting is left finished and untouched.
    expect(rows.get(7)?.finishedAt).toBeInstanceOf(Date);
    expect(rows.get(7)?.tokenHash).toBeNull();
  });

  it("carries a friend sitting from the invite through every guest answer", async () => {
    installBlindStore();
    const caller = appRouter.createCaller(ctxFor(1));
    const started = await caller.blind.start({ personaId: 3, subject: "friend", groups: 6 });
    expect(started.subject).toBe("friend");
    expect(started.total).toBe(6);

    const invite = await caller.blind.invite({ sessionId: started.sessionId });
    expect(invite.sessionId).toBe(started.sessionId);
    const guest = appRouter.createCaller({ ...ctxFor(1, "198.51.100.8"), user: null });
    const loaded = await guest.blind.guestLoad({ token: invite.token });
    expect(loaded.name).toBe("小满");
    expect(loaded.groups).toHaveLength(6);
    expect(JSON.stringify(loaded)).not.toMatch(/real|said|expected|generated/i);

    let last: any = null;
    for (let group = 0; group < loaded.total; group++) {
      last = await guest.blind.guestAnswer({
        token: invite.token,
        group,
        pick: group % 2 === 0 ? "first" : "second",
        seconds: 2,
        reason: group === 0 ? "word" : undefined,
      });
    }
    expect(last.done).toBe(true);
    expect(last.summary.n).toBe(6);
    expect(
      last.summary.pickedReal + last.summary.pickedPersona + last.summary.unsure,
    ).toBeCloseTo(1, 10);
    expect(last.summary.reasons).toEqual({ word: 1 });

    // The token is one use: the sitting is finished, so it closes.
    await expect(
      appRouter
        .createCaller({ ...ctxFor(1, "198.51.100.8"), user: null })
        .blind.guestLoad({ token: invite.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rate-limits the guest routes", async () => {
    getBlindSessionByTokenHash.mockResolvedValue({
      id: 7,
      userId: 1,
      personaId: 3,
      groups: [{ caseId: 0, real: ORIGINAL, fake: "分身写的另一句", realFirst: true }],
      expiresAt: new Date(Date.now() + 60_000),
      finishedAt: null,
    });
    const guest = appRouter.createCaller({ ...ctxFor(1, "203.0.113.9"), user: null });
    const token = "d".repeat(32);
    let last: unknown;
    for (let i = 0; i < 11; i++) {
      try {
        await guest.blind.guestLoad({ token });
        last = "ok";
      } catch (error) {
        last = error;
      }
    }
    expect(last).toBeInstanceOf(TRPCError);
    expect((last as TRPCError).code).toBe("TOO_MANY_REQUESTS");
  });
});
