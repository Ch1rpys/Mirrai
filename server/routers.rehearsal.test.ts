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
const createMessage = vi.fn();
const extractMemories = vi.fn();
const updatePersona = vi.fn();
const incrementChatCount = vi.fn();

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
  createMessage: (...a: unknown[]) => createMessage(...a),
  extractMemories: (...a: unknown[]) => extractMemories(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  incrementChatCount: (...a: unknown[]) => incrementChatCount(...a),
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

import { rateLimiter } from "./_core/rate-limit";
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
    rateLimiter.reset?.();
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
    // An ordinary line is shown as generated: the promise guard must not
    // refuse every reply.
    expect(variants.find((entry: any) => entry.act === "acknowledge")?.text).toBe("我会有点意外。");
    expect(createRehearsal).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      personaId: 5,
      line: "那天我不该那样说",
    }));
  });

  it("still rehearses an ordinary question (C3.2)", async () => {
    // The widened question guard is for verdicts, not for every
    // question: "你今天忙吗" is practice, not a promise.
    for (const line of ["你今天忙吗", "how was your day"]) {
      const result = await appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line });
      expect(result.mode).toBe("variants");
    }
    expect(planTurn).toHaveBeenCalled();
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

  it("refuses the same question asked another way, in Chinese (C3.2)", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "你会答应我吗" });
    expect(result.mode).toBe("my_side_only");
    expect(planTurn).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("refuses the same question asked another way, in English (C3.2)", async () => {
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "would you give me another chance" });
    expect(result.mode).toBe("my_side_only");
    expect(planTurn).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("refuses the proposal phrasings that used to reach the model (C3.2)", async () => {
    // The acceptance found these returning three generated possibilities:
    // a question whose answer belongs to the other person must be refused
    // before any model call. Before the fix this test failed on the first
    // line — `variants` came back and `planTurn` had been called.
    for (const line of [
      "你会不会娶我",
      "我们结婚吧",
      "你愿意嫁给我吗",
      "能不能给我一次机会",
      "is it over",
      "give me another chance",
    ]) {
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("my_side_only");
    }
    expect(planTurn).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("still rehearses an ordinary line that only mentions a wedding or a song (C3.2)", async () => {
    // The broadened table must not refuse the everyday words it borrows
    // from: a wedding is something one attends, and "love" takes an
    // object. The last two are the phrasings the old, wider table
    // misjudged: "回来" followed by another verb is a schedule question,
    // and "give me the salt" is not a request for another chance. These
    // must still generate.
    for (const line of ["今天去参加朋友的婚礼", "I love this song", "你会回来吃饭吗", "can you give me the salt"]) {
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("variants");
    }
    expect(planTurn).toHaveBeenCalled();
  });

  it("refuses a proposal or an ending question typed without a subject (C3.2)", async () => {
    // The same questions in the words people type: the subject of 嫁 is
    // dropped and 结婚 is followed by 好吗 / 好不好, and the Chinese
    // ending family had no pattern at all. The room used to generate
    // three possibilities for these instead of refusing before a model
    // call.
    for (const line of ["嫁给我好吗", "我们结婚好吗", "我们是不是结束了"]) {
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("my_side_only");
    }
    expect(planTurn).not.toHaveBeenCalled();
    expect(executePlan).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("refuses the 陪我 promises and the same-family ending questions (C3.2)", async () => {
    // The third fix dropped the 陪我/回来陪我 phrasings and only knew
    // 是不是 directly before 结束/分手; all of these are questions whose
    // answer belongs to the person, so no model may be called.
    for (const line of [
      "你会不会陪我到老",
      "你能不能陪我到老",
      "你愿不愿意留下来陪我",
      "你会不会留下来陪我",
      "你回来陪我吗",
      "你回来陪我吧",
      "你什么时候回来陪我",
      "我们是不是该结束了",
      "我们是不是该分手了",
      "我们该不该结束了",
      "我们是不是快要结束了",
      "嫁给我行吗",
      "嫁给我可以吗",
      "嫁给我，好吗",
      "嫁给我成吗",
    ]) {
      // The room's own rate limit (10 heavy calls a minute) is for
      // production; this loop is one test, so start each attempt from a
      // fresh bucket.
      rateLimiter.reset?.();
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("my_side_only");
    }
    expect(planTurn).not.toHaveBeenCalled();
    expect(executePlan).not.toHaveBeenCalled();
    expect(retrieveMemories).not.toHaveBeenCalled();
  });

  it("still rehearses a daily request that only sounds like a commitment (C3.2)", async () => {
    // "陪我" and "留下来" are only a verdict when nothing follows them,
    // and "回来陪我吃饭" is a schedule, not "come back to me". The
    // widened table used to refuse these before any model call.
    for (const line of [
      "你能不能陪我逛街",
      "你回来陪我吃饭吗",
      "你能陪我逛街吗",
      "你陪我逛街吧",
      "你回来陪我看电影",
    ]) {
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("variants");
      expect((result as any).variants.some((entry: any) => entry.text)).toBe(true);
    }
    expect(planTurn).toHaveBeenCalled();
    expect(executePlan).toHaveBeenCalled();
  });

  it("still rehearses a movie, an exam or someone else's break-up (C3.2)", async () => {
    // 结束/分手 are also about things and other people; the ending
    // question rule is anchored to the relationship, so these must go
    // through the generation path instead of being refused.
    for (const line of [
      "电影是不是结束了",
      "这部剧是不是结束了",
      "考试是不是结束了",
      "比赛结束了吗",
      "他是不是分手了",
      "我朋友是不是分手了",
      "我们分手吧",
      "我们结束吧",
      "我们分开吧",
    ]) {
      rateLimiter.reset?.();
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line });
      expect(result.mode, line).toBe("variants");
    }
    expect(planTurn).toHaveBeenCalled();
    expect(executePlan).toHaveBeenCalled();
  });

  it("refuses a persona the user stepped down to letters (C6.1)", async () => {
    getPersonaById.mockResolvedValue({
      ...persona,
      settings: { taper: { stage: 3 } },
    });
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "那天我不该那样说" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("只写信") });
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("refuses a weekday when the chat is kept to weekends (C6.1)", async () => {
    vi.useFakeTimers();
    try {
      // A Wednesday in the user's zone.
      vi.setSystemTime(new Date("2026-03-04T12:00:00Z"));
      getPersonaById.mockResolvedValue({
        ...persona,
        settings: { taper: { stage: 2 } },
      });
      await expect(
        appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "那天我不该那样说" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("只在周末") });
      expect(planTurn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the room again on a weekend (C6.1)", async () => {
    vi.useFakeTimers();
    try {
      // A Saturday in the user's zone.
      vi.setSystemTime(new Date("2026-03-07T12:00:00Z"));
      getPersonaById.mockResolvedValue({
        ...persona,
        settings: { taper: { stage: 2 } },
      });
      const result = await appRouter
        .createCaller(ctxFor(1))
        .rehearsal.run({ personaId: 5, line: "那天我不该那样说" });
      expect(result.mode).toBe("variants");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a persona that is asleep or sealed", async () => {
    getPersonaById.mockResolvedValue({ ...persona, presence: "asleep" });
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "对不起" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(planTurn).not.toHaveBeenCalled();

    getPersonaById.mockResolvedValue({ ...persona, settings: { locked: true } });
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "对不起" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(planTurn).not.toHaveBeenCalled();
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

  it("drops a retry that makes the promise in other words (C3.2)", async () => {
    // The first line is caught by the table; the retry comes back with
    // the same promise in a phrasing the old table missed. It must be
    // dropped, not shown.
    finalPlan(["我原谅你", "我会原谅你"]);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "对不起" });
    const variants = (result as any).variants;
    expect(variants.every((entry: any) => entry.text === null)).toBe(true);
  });

  it("drops an English retry that makes the promise in other words (C3.2)", async () => {
    finalPlan(["i forgive you", "I'll give you another chance"]);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "对不起" });
    const variants = (result as any).variants;
    expect(variants.every((entry: any) => entry.text === null)).toBe(true);
  });

  it("drops a retry that promises to stay, in words the old second gate missed (C3.2)", async () => {
    // "I'll never leave you" is the same promise as "I forgive you".
    // The second gate used to know only the manual's examples, so this
    // retry was shown; the extended shared table has to drop it.
    finalPlan(["我会原谅你", "我不会离开你"]);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "对不起" });
    const variants = (result as any).variants;
    expect(variants.every((entry: any) => entry.text === null)).toBe(true);
  });

  it("refuses the twenty-first rehearsal of the day", async () => {
    countRehearsalsSince.mockResolvedValue(20);
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "对不起" }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(planTurn).not.toHaveBeenCalled();
  });

  it("leaves the conversation alone", async () => {
    // The room writes one rehearsal row and nothing else. Both the
    // write-helper spies and the import structure say so.
    await appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "对不起" });
    expect(createMessage).not.toHaveBeenCalled();
    expect(extractMemories).not.toHaveBeenCalled();
    expect(updatePersona).not.toHaveBeenCalled();
    expect(incrementChatCount).not.toHaveBeenCalled();
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
