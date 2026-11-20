import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The rehearsal room (C3.2).
 *
 * Three things are guarded here. It must not answer a question only the
 * person can answer; it must not let the model promise or decide on the
 * person's behalf; and it must leave no trace in the conversation. The
 * last one is the whole point of a rehearsal.
 */
const getPersonaById = vi.fn();
const createRehearsal = vi.fn();
const countRehearsalsSince = vi.fn();
const listRehearsals = vi.fn();
const getRehearsalById = vi.fn();
const setRehearsalOutboundLetter = vi.fn();
const deleteRehearsal = vi.fn();
const createOutboundLetter = vi.fn();
const planTurn = vi.fn();
const executePlan = vi.fn();
const retrieveMemories = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createRehearsal: (...a: unknown[]) => createRehearsal(...a),
  countRehearsalsSince: (...a: unknown[]) => countRehearsalsSince(...a),
  listRehearsals: (...a: unknown[]) => listRehearsals(...a),
  getRehearsalById: (...a: unknown[]) => getRehearsalById(...a),
  setRehearsalOutboundLetter: (...a: unknown[]) => setRehearsalOutboundLetter(...a),
  deleteRehearsal: (...a: unknown[]) => deleteRehearsal(...a),
  createOutboundLetter: (...a: unknown[]) => createOutboundLetter(...a),
}));

vi.mock("./chat/generate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  planTurn: (...a: unknown[]) => planTurn(...a),
  executePlan: (...a: unknown[]) => executePlan(...a),
}));

vi.mock("./chat/retrieval", () => ({
  retrieveMemories: (...a: unknown[]) => retrieveMemories(...a),
}));

vi.mock("./llm/user-provider", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveProviderForUser: async () => ({ name: "test", isConfigured: () => true, invoke: async () => "" }),
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

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  emotionalState: "warm",
  timezone: "Asia/Shanghai",
  personaData: {
    actProfile: {
      samples: 100,
      unconditional: { acknowledge: 50, comfort: 30, silence: 10, tease: 10 },
      buckets: [],
    },
  },
};

/** executePlan that yields one final text. */
function finalPlan(texts: string[]) {
  let index = 0;
  executePlan.mockImplementation(async function* () {
    const text = texts[Math.min(index, texts.length - 1)];
    index += 1;
    yield { type: "final", text, projection: [] };
  });
}

describe("rehearsal.run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    countRehearsalsSince.mockResolvedValue(0);
    createRehearsal.mockResolvedValue(11);
    retrieveMemories.mockResolvedValue([]);
    planTurn.mockResolvedValue({
      kind: "model",
      sampledAct: "acknowledge",
      messages: [],
      layersUsed: [],
      exemplarIds: [],
      seedRecordIds: [],
    });
    finalPlan(["我会有点意外。"]);
  });

  it("returns the three most likely acts, with shares that do not pass one", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "那天我不该那样说" });
    expect(result.mode).toBe("variants");
    const variants = (result as any).variants;
    expect(variants.map((entry: any) => entry.act)).toEqual(["acknowledge", "comfort", "silence"]);
    expect(variants.every((entry: any) => entry.share > 0)).toBe(true);
    expect(variants.reduce((sum: number, entry: any) => sum + entry.share, 0)).toBeLessThanOrEqual(1);
    expect(planTurn).toHaveBeenCalledTimes(2);
    expect(planTurn.mock.calls[0][0].forcedAct).toBe("acknowledge");
    expect(planTurn.mock.calls[1][0].forcedAct).toBe("comfort");
    expect(createRehearsal).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 5,
      line: "那天我不该那样说",
    }));
  });

  it("does not generate the silent one", async () => {
    getPersonaById.mockResolvedValue({
      ...persona,
      personaData: {
        actProfile: {
          samples: 100,
          unconditional: { silence: 50, acknowledge: 30, comfort: 20 },
          buckets: [],
        },
      },
    });
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "在吗" });
    const variants = (result as any).variants;
    const silent = variants.find((entry: any) => entry.act === "silence");
    expect(silent).toMatchObject({ silent: true, text: null });
    expect(planTurn).toHaveBeenCalledTimes(2);
  });

  it("refuses a commitment question without calling a model", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "你还爱我吗" });
    expect(result.mode).toBe("my_side_only");
    expect(planTurn).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("goes to the crisis card before anything else", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "我不想活了" });
    expect(result.mode).toBe("crisis");
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("does not show a promise, even after asking again", async () => {
    finalPlan(["我原谅你"]);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "对不起" });
    const variants = (result as any).variants;
    expect(variants.every((entry: any) => entry.text === null)).toBe(true);
    // Twice for each generated act: the second call carries the
    // instruction not to decide for the person.
    expect(planTurn).toHaveBeenCalledTimes(4);
    const retryInputs = planTurn.mock.calls.filter((call) => call[0].sceneOverlay);
    expect(retryInputs.length).toBe(2);
    expect(retryInputs[0][0].sceneOverlay).toMatch(/不要替对方/);
  });

  it("refuses the twenty-first rehearsal of the day", async () => {
    countRehearsalsSince.mockResolvedValue(20);
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "对不起" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("leaves the conversation alone", () => {
    // The room writes one rehearsal row and nothing else. A structure
    // test is the honest way to say "no message, no memory extraction, no
    // mood, no chat count" — the router does not even import them.
    const source = readFileSync(path.resolve(__dirname, "routers-v6/rehearsal.ts"), "utf8");
    expect(source).not.toMatch(/createMessage|updatePersona|incrementChatCount|extractMemories|updateEmotionalState/);
  });
});

describe("rehearsal.keep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRehearsalById.mockResolvedValue({
      id: 11,
      userId: 1,
      personaId: 5,
      line: "对不起 那天我不该那样说",
      outboundLetterId: null,
    });
    createOutboundLetter.mockResolvedValue(21);
    setRehearsalOutboundLetter.mockResolvedValue(true);
  });

  it("puts the user's own line on the way-out list, word for word", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).rehearsal.keep({ id: 11 });
    expect(createOutboundLetter).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 5,
      text: "对不起 那天我不该那样说",
    }));
    expect(result).toEqual({ outboundLetterId: 21 });
  });

  it("does not keep the same line twice", async () => {
    getRehearsalById.mockResolvedValue({
      id: 11,
      userId: 1,
      personaId: 5,
      line: "对不起",
      outboundLetterId: 21,
    });
    const result = await appRouter.createCaller(ctxFor(1)).rehearsal.keep({ id: 11 });
    expect(result).toEqual({ outboundLetterId: 21 });
    expect(createOutboundLetter).not.toHaveBeenCalled();
  });
});

describe("rehearsal.list and delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona);
    listRehearsals.mockResolvedValue([{ id: 1, line: "在吗" }]);
    deleteRehearsal.mockResolvedValue(true);
  });

  it("lists only the user's own rehearsals", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).rehearsal.list({ personaId: 5 });
    expect(listRehearsals).toHaveBeenCalledWith(5, 1, 50);
    expect(result.rehearsals).toHaveLength(1);
  });

  it("deletes one, and says so when it is not there", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    expect(await caller.rehearsal.delete({ id: 1 })).toEqual({ success: true });
    deleteRehearsal.mockResolvedValue(false);
    await expect(caller.rehearsal.delete({ id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
