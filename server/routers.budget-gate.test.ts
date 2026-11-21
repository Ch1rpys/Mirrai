import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { copy } from "@shared/copy";

/**
 * The paid extras stop when the month's ceiling is reached (C8.9).
 *
 * Ordinary replies, safety answers and memory extraction do not go
 * through this list — they have to keep working. These four do: a run
 * of up to twelve calls, an audition, the rehearsal room, and the
 * wording assistant.
 */
const budgetExceeded = vi.fn();
const getPersonaById = vi.fn();
const getOutboundLetterById = vi.fn();

vi.mock("./llm/budget", () => ({
  budgetExceeded: (...a: unknown[]) => budgetExceeded(...a),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getOutboundLetterById: (...a: unknown[]) => getOutboundLetterById(...a),
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

const overBudget = {
  code: "BAD_REQUEST",
  message: copy("zh", "errors.budgetOver"),
};

describe("a month over its budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetExceeded.mockResolvedValue(true);
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", settings: {}, personaData: {} });
    getOutboundLetterById.mockResolvedValue({ id: 3, userId: 1, text: "我想说一句话。" });
  });

  it("turns off evaluation", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).eval.run({ personaId: 5 }),
    ).rejects.toMatchObject(overBudget);
    expect(budgetExceeded).toHaveBeenCalledWith(1, "Asia/Shanghai");
  });

  it("turns off the audition", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).eval.audition({ personaId: 5 }),
    ).rejects.toMatchObject(overBudget);
  });

  it("turns off the rehearsal room", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).rehearsal.run({ personaId: 5, line: "在吗" }),
    ).rejects.toMatchObject(overBudget);
  });

  it("turns off the wording assistant", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).outbound.suggestWording({ id: 3 }),
    ).rejects.toMatchObject(overBudget);
  });

  it("still answers a crisis in the rehearsal room", async () => {
    // The crisis card needs no model, so the ceiling must not turn it
    // away — the same rule as the chat path.
    const result = await appRouter
      .createCaller(ctxFor(1))
      .rehearsal.run({ personaId: 5, line: "我不想活了" });
    expect(result).toEqual({ mode: "crisis" });
    expect(budgetExceeded).not.toHaveBeenCalled();
  });

  it("still answers a crisis in the wording assistant", async () => {
    getOutboundLetterById.mockResolvedValue({
      id: 3,
      userId: 1,
      text: "我真的不想活了。",
    });
    const result = await appRouter
      .createCaller(ctxFor(1))
      .outbound.suggestWording({ id: 3 });
    expect(result).toMatchObject({ crisis: true, suggestions: [] });
    expect(budgetExceeded).not.toHaveBeenCalled();
  });

  /** The outcome, whichever way it went. */
  async function settle<T>(work: Promise<T>): Promise<{ error?: unknown }> {
    try {
      await work;
      return {};
    } catch (error) {
      return { error };
    }
  }

  it("lets an evaluation start when the ceiling has not been reached", async () => {
    budgetExceeded.mockResolvedValue(false);
    // Whatever the run does with no cases, it is not refused for money.
    const { error } = await settle(
      appRouter.createCaller(ctxFor(1)).eval.run({ personaId: 5 }),
    );
    if (error) {
      expect((error as { code?: string }).code).not.toBe("BAD_REQUEST");
      expect((error as { message?: string }).message).not.toBe(overBudget.message);
    }
  });

  it("lets the wording assistant try when the ceiling has not been reached", async () => {
    budgetExceeded.mockResolvedValue(false);
    getOutboundLetterById.mockResolvedValue({ id: 3, userId: 1, text: "我想说一句话。" });
    const { error } = await settle(
      appRouter.createCaller(ctxFor(1)).outbound.suggestWording({ id: 3 }),
    );
    if (error) {
      expect((error as { code?: string }).code).not.toBe("BAD_REQUEST");
      expect((error as { message?: string }).message).not.toBe(overBudget.message);
    }
  });
});
