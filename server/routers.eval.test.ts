import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The fidelity evaluation.
 *
 * A run is up to twelve model calls, and the rate limit allows ten
 * starts a minute. So the guard that stops a second run from starting
 * has to be taken before anything is awaited — and it was not.
 *
 * The check was at the top and the claim was at the bottom, with four
 * awaits in between, and a comment that said there was none. So a
 * double click started two runs: twice the bill, two rows written, and
 * the comparison with the last run depending on which of them finished
 * last.
 */

const getPersonaById = vi.fn();
const getCollectedMessagesForPersonaRows = vi.fn();
const getEvalCases = vi.fn();
const saveEvalCases = vi.fn();
const saveEvalRun = vi.fn();
const getLatestPersonaVersion = vi.fn();
const setPersonaVersionEvalRun = vi.fn();
const getMessagesByPersonaId = vi.fn();
const listFidelityRewritePairs = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getCollectedMessagesForPersonaRows: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  // The same helper under its other name.
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersonaRows(...a),
  getEvalCases: (...a: unknown[]) => getEvalCases(...a),
  saveEvalCases: (...a: unknown[]) => saveEvalCases(...a),
  saveEvalRun: (...a: unknown[]) => saveEvalRun(...a),
  getLatestPersonaVersion: (...a: unknown[]) => getLatestPersonaVersion(...a),
  setPersonaVersionEvalRun: (...a: unknown[]) => setPersonaVersionEvalRun(...a),
  getMessagesByPersonaId: (...a: unknown[]) => getMessagesByPersonaId(...a),
  listFidelityRewritePairs: (...a: unknown[]) => listFidelityRewritePairs(...a),
}));

const runEval = vi.fn();

vi.mock("./eval/run", () => ({
  runEval: (...a: unknown[]) => runEval(...a),
}));

const runAudition = vi.fn();
const listAuditionProviders = vi.fn();

vi.mock("./eval/audition", () => ({
  runAudition: (...a: unknown[]) => runAudition(...a),
  listAuditionProviders: (...a: unknown[]) => listAuditionProviders(...a),
}));

vi.mock("./eval/act-labels", () => ({
  labelEvalCases: async (cases: unknown) => cases,
}));

/** The cases the run has to measure. */
let evalCases: any[] = [{ context: "在吗", expected: "在的", expectedState: "warm" }];
/** The messages and options the router handed to the real case cutter. */
let buildCalls: any[][] = [];

vi.mock("./eval/dataset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./eval/dataset")>();
  return {
    ...actual,
    // The cases are built for real, so the run has something to measure.
    buildEvalCases: (...args: any[]) => {
      buildCalls.push(args);
      return evalCases;
    },
  };
});

import { appRouter } from "./routers";

function ctxFor(userId: number, timezone: string | null = null): TrpcContext {
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
      timezone,
      locale: "zh",
    },
    req: {} as any,
    res: {} as any,
  } as unknown as TrpcContext;
}

const persona = {
  id: 5,
  userId: 1,
  name: "小A",
  analysisStatus: "ready",
  emotionalState: "warm",
  personaData: {},
} as any;

describe("the fidelity evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    getCollectedMessagesForPersonaRows.mockResolvedValue([]);
    getEvalCases.mockResolvedValue([]);
    evalCases = [{ context: "在吗", expected: "在的", expectedState: "warm" }];
    buildCalls = [];
    persona.personaData = {};
    saveEvalCases.mockResolvedValue(undefined);
    saveEvalRun.mockResolvedValue(undefined);
    getLatestPersonaVersion.mockResolvedValue(undefined);
    setPersonaVersionEvalRun.mockResolvedValue(false);
    // The run takes a while — that is the whole point of the guard.
    runEval.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { score: 0.8 } as any;
    });
    getMessagesByPersonaId.mockResolvedValue([]);
    listFidelityRewritePairs.mockResolvedValue([]);
    listAuditionProviders.mockResolvedValue([]);
    runAudition.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { results: [], cases: 1, calls: 0 };
    });
  });

  it("does not start a second run while one is going", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    /**
     * Wait until the first request is really inside the run.
     *
     * The claim happens before the first `await`, but the procedure body
     * itself is scheduled — so under load the second request could be
     * created before the first body had run, and the guard was not yet
     * set. Waiting for `runEval` to be entered keeps the test about the
     * guard rather than about the scheduler.
     */
    let entered!: () => void;
    const enteredRun = new Promise<void>((resolve) => { entered = resolve; });
    runEval.mockImplementation(async () => {
      entered();
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { score: 0.8 } as any;
    });

    const first = caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });
    await enteredRun;
    // The second one arrives while the first is still measuring.
    const second = caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });

    await expect(second).rejects.toThrow();
    await first;

    // One run, one bill. Evaluation treats rerank as on.
    expect(runEval).toHaveBeenCalledTimes(1);
    expect(runEval.mock.calls[0][0]).toEqual(expect.objectContaining({ rerank: true }));
  });

  it("runs a case cut with the user's zone and keeps its period", async () => {
    const ctx = ctxFor(1, "Asia/Shanghai");
    persona.personaData = {
      periods: [{ id: "p1", from: "2024-01-01T00:00:00.000Z", to: "2024-12-31T00:00:00.000Z" }],
    };
    evalCases = [
      {
        context: [{ role: "user", content: "今天好累", timestamp: null }],
        expected: { role: "assistant", content: "哦。", timestamp: null },
        expectedState: "distant",
        periodId: "p1",
      },
    ];
    await appRouter.createCaller(ctx).eval.run({ personaId: 5, variant: "default", locale: "zh" });

    expect(runEval.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ persona: expect.objectContaining({ timezone: "Asia/Shanghai" }) }),
    );
    expect(saveEvalCases.mock.calls.at(-1)?.[2][0]).toEqual(
      expect.objectContaining({ periodId: "p1" }),
    );
  });

  it("lets a run start again once the first one is finished", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    await caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });
    await caller.eval.run({ personaId: 5, variant: "default", locale: "zh" });

    expect(runEval).toHaveBeenCalledTimes(2);
  });

  it("gives the run back when there is nothing to measure", async () => {
    // No cases: the run is refused before it starts, and the guard has
    // to let the next attempt through — otherwise one empty persona
    // would block its own evaluation for ever.
    evalCases = [];
    const caller = appRouter.createCaller(ctxFor(1));

    await expect(
      caller.eval.run({ personaId: 5, variant: "default", locale: "zh" }),
    ).rejects.toThrow();
    await expect(
      caller.eval.run({ personaId: 5, variant: "default", locale: "zh" }),
    ).rejects.toThrow();

    // Both refusals were for the missing cases, and neither was "a run
    // is already going".
    expect(runEval).not.toHaveBeenCalled();
  });

  it("does not start a second audition while one is going", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const first = caller.eval.audition({ personaId: 5, locale: "zh" });
    const second = caller.eval.audition({ personaId: 5, locale: "zh" });
    await expect(second).rejects.toMatchObject({ code: "CONFLICT" });
    await first;
    expect(runAudition).toHaveBeenCalledTimes(1);
  });

  it("does not audition someone else's persona", async () => {
    getPersonaById.mockResolvedValue(null);
    const caller = appRouter.createCaller(ctxFor(2));
    await expect(
      caller.eval.audition({ personaId: 5, locale: "zh" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(runAudition).not.toHaveBeenCalled();
  });

  it("cuts app cases with labels, periods, and the user's zone", async () => {
    const ctx = ctxFor(1, "Asia/Shanghai");
    persona.personaData = {
      periods: [{ id: "p1", from: "2024-01-01T00:00:00.000Z", to: "2024-12-31T00:00:00.000Z" }],
    };
    getCollectedMessagesForPersonaRows.mockResolvedValue([
      {
        id: 1,
        role: "user",
        content: "今天好累",
        timestamp: new Date("2024-01-15T15:00:00.000Z"),
        kind: "text",
        emotion: "distant",
        act: "acknowledge",
        actSource: "model",
      },
    ]);
    evalCases = [
      {
        context: [{ role: "user", content: "今天好累", timestamp: null }],
        expected: { role: "assistant", content: "哦。", timestamp: null },
        expectedState: "distant",
        expectedAct: "acknowledge",
        periodId: "p1",
      },
    ];
    await appRouter.createCaller(ctx).eval.buildCases({ personaId: 5, locale: "zh" });

    expect(buildCalls.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        kind: "text",
        emotion: "distant",
        act: "acknowledge",
        actSource: "model",
      }),
    ]);
    expect(buildCalls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        timezone: "Asia/Shanghai",
        periods: [expect.objectContaining({ id: "p1" })],
      }),
    );
    expect(saveEvalCases.mock.calls.at(-1)?.[2][0]).toEqual(
      expect.objectContaining({ periodId: "p1" }),
    );
  });

  it("cuts a feedback case from a rewrite and leaves it out of training", async () => {
    const { trainingTexts } = await import("./eval/dataset");
    listFidelityRewritePairs.mockResolvedValue([
      { id: 1, messageId: 2, reason: "word", rewrite: "那才像", unlike: "你好吗", createdAt: new Date() },
    ]);
    getMessagesByPersonaId.mockResolvedValue([
      { id: 1, role: "user", content: "吃饭了吗", createdAt: new Date(), origin: "web" },
      { id: 2, role: "assistant", content: "你好吗", createdAt: new Date(), origin: "web" },
    ]);
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.eval.buildCases({ personaId: 5, locale: "zh" });
    expect(saveEvalCases).toHaveBeenCalled();
    const saved = saveEvalCases.mock.calls[0][2] as Array<{
      source?: string;
      expected: { content: string };
      context: Array<{ role: string; content: string }>;
    }>;
    const feedback = saved.filter((item) => item.source === "feedback");
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.expected.content).toBe("那才像");
    const texts = trainingTexts(
      [
        { role: "assistant", content: "在的", timestamp: null },
        { role: "assistant", content: "那才像", timestamp: null },
      ],
      saved.map((item) => ({
        context: item.context as never,
        expected: item.expected as never,
        expectedState: null,
        source: item.source,
      })),
    );
    expect(texts).not.toContain("那才像");
  });
});
