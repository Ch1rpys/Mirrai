import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The distillation, and the provider it runs on.
 *
 * A persona can be pinned to a provider of its own — a local model, for
 * a user who does not want their material to leave the machine. The
 * chat path honours it. The distillation did not: it fell back to the
 * user's *default* row, so a persona set to a local model was analysed
 * by a cloud service, and the material went there.
 *
 * One call site was fixed and the other was not, which is how it
 * survived: the two entry points look nothing alike.
 */

const getPersonaById = vi.fn();
const getFilesByPersonaId = vi.fn();
const getCollectedMessagesForPersona = vi.fn();
const countRecords = vi.fn();
const updatePersona = vi.fn();
const getSkillJobById = vi.fn();
const getPersonaSettings = vi.fn();
const setPersonaSettings = vi.fn();
const getUserTimezone = vi.fn();
const iterateRecords = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getFilesByPersonaId: (...a: unknown[]) => getFilesByPersonaId(...a),
  getCollectedMessagesForPersona: (...a: unknown[]) => getCollectedMessagesForPersona(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getSkillJobById: (...a: unknown[]) => getSkillJobById(...a),
  getPersonaSettings: (...a: unknown[]) => getPersonaSettings(...a),
  setPersonaSettings: (...a: unknown[]) => setPersonaSettings(...a),
  getUserTimezone: (...a: unknown[]) => getUserTimezone(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
}));

const runSkillPipeline = vi.fn();

vi.mock("./skill-engine/pipeline", () => ({
  runSkillPipeline: (...a: unknown[]) => runSkillPipeline(...a),
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
      name: `User ${userId}`,
      timezone: null,
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
  llmProvider: "ollama",
} as any;

describe("distilling a persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    // There has to be something to distil — the analysis trigger says so
    // before it starts anything.
    getFilesByPersonaId.mockResolvedValue([
      { fileType: "chat_txt", extractedMemory: "在吗\n在的呀", fileUrl: null },
    ]);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    countRecords.mockResolvedValue(0);
    getUserTimezone.mockResolvedValue("Asia/Shanghai");
    iterateRecords.mockImplementation(async function* () {});
    getPersonaSettings.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
    updatePersona.mockResolvedValue(undefined);
    getSkillJobById.mockResolvedValue(undefined);
    runSkillPipeline.mockResolvedValue({ persona: {} });
  });

  it("runs the pipeline on the provider the persona is pinned to", async () => {
    await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" });

    // The pipeline is started in the background, so the test waits for
    // the promise it returns to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runSkillPipeline).toHaveBeenCalled();
    expect(runSkillPipeline.mock.calls[0][0].provider).toBe("ollama");
  });

  it("does not load the record table into the pipeline input", async () => {
    countRecords.mockResolvedValue(80);

    await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runSkillPipeline).toHaveBeenCalled();
    expect(runSkillPipeline.mock.calls[0][0].records).toBeUndefined();
    expect(getCollectedMessagesForPersona).not.toHaveBeenCalled();
    expect(countRecords).toHaveBeenCalledWith(5, 1);
  });

  it("runs the analysis trigger on the same provider", async () => {
    await appRouter
      .createCaller(ctxFor(1))
      .persona.triggerAnalysis({ id: 5, characterFamily: "relationship" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runSkillPipeline).toHaveBeenCalled();
    expect(runSkillPipeline.mock.calls[0][0].provider).toBe("ollama");
  });

  it("is limited, so the pipeline cannot be started without a stop", async () => {
    // A distillation is a multi-stage run of model calls, and this
    // procedure had no limit at all — so it was the cheapest way to
    // start as many of them as you liked.
    const caller = appRouter.createCaller(ctxFor(987654));
    let refused = false;
    for (let i = 0; i < 15; i++) {
      try {
        await caller.skillEngine.startPipeline({
          personaId: 5,
          characterFamily: "relationship",
        });
      } catch {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });

  it("leaves the provider alone when the persona has none of its own", async () => {
    getPersonaById.mockResolvedValue({ ...persona, llmProvider: null });

    await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runSkillPipeline.mock.calls[0][0].provider).toBeUndefined();
  });

  it("will not build a persona out of nothing", async () => {
    /**
     * The pipeline is happy to run on no material at all: it then writes
     * a person the model invented over the one the user built by hand.
     * The name survives, so nothing looks wrong.
     *
     * The other entry point said no — but this one did not, so the
     * "import into the persona" button was a way to lose a persona. A
     * guard that lands on one entry point leaves the other open.
     */
    getFilesByPersonaId.mockResolvedValue([]);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    countRecords.mockResolvedValue(0);

    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" }),
    ).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runSkillPipeline).not.toHaveBeenCalled();
  });

  it("refuses a second run of a persona that is already being distilled", async () => {
    /**
     * The persona is being distilled right now, and the run is alive.
     */
    getPersonaById.mockResolvedValue({
      ...persona,
      analysisStatus: "analyzing",
      skillJobId: 99,
    });
    getSkillJobById.mockResolvedValue({
      id: 99,
      updatedAt: new Date(),
    });

    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" }),
    ).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runSkillPipeline).not.toHaveBeenCalled();
  });

  it("lets a run through when the last one died with its process", async () => {
    /**
     * The run has not been written to for a long time — so it belongs
     * to a process that has gone, and it must not block the user for
     * ever.
     */
    getPersonaById.mockResolvedValue({
      ...persona,
      analysisStatus: "analyzing",
      skillJobId: 99,
    });
    getSkillJobById.mockResolvedValue({
      id: 99,
      updatedAt: new Date(Date.now() - 60 * 60_000),
    });

    await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.startPipeline({ personaId: 5, characterFamily: "relationship" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runSkillPipeline).toHaveBeenCalled();
  });

  it("will not build a persona out of nothing through the other entry point either", async () => {
    getFilesByPersonaId.mockResolvedValue([]);
    getCollectedMessagesForPersona.mockResolvedValue([]);
    countRecords.mockResolvedValue(0);

    await expect(
      appRouter
        .createCaller(ctxFor(1))
        .persona.triggerAnalysis({ id: 5, characterFamily: "relationship" }),
    ).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runSkillPipeline).not.toHaveBeenCalled();
  });

  it("estimates the same number of blocks chunkRecords would cut", async () => {
    const { buildXiaomanRecords } = await import("./test-fixtures/xiaoman");
    const { chunkRecords } = await import("./skill-engine/chunks");
    const fixture = buildXiaomanRecords();
    iterateRecords.mockImplementation(async function* () {
      for (const row of fixture) yield row;
    });

    const estimate = await appRouter
      .createCaller(ctxFor(1))
      .skillEngine.estimate({ personaId: 5, mode: "deep" });

    const chunks = chunkRecords(fixture, {
      timeZone: "Asia/Shanghai",
      themName: persona.name,
    });
    expect(estimate.chunks).toBe(chunks.length);
    expect(estimate.mapCalls).toBe(chunks.length);
  });

  it("refuses a run that would go over MAX_DISTILL_CALLS", async () => {
    const previous = process.env.MAX_DISTILL_CALLS;
    process.env.MAX_DISTILL_CALLS = "1";
    try {
      await expect(
        appRouter
          .createCaller(ctxFor(1))
          .persona.triggerAnalysis({ id: 5, characterFamily: "relationship" }),
      ).rejects.toThrow(/上限/);
      expect(runSkillPipeline).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MAX_DISTILL_CALLS;
      else process.env.MAX_DISTILL_CALLS = previous;
    }
  });
});
