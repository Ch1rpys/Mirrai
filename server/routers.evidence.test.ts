import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The quoted lines behind a portrait field.
 *
 * Somebody else's persona is not readable. Every quote that comes back
 * has to be a row in the record table, with the same text.
 */

const getPersonaById = vi.fn();
const listDistillationCards = vi.fn();
const getRecordsByIds = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  listDistillationCards: (...a: unknown[]) => listDistillationCards(...a),
  getRecordsByIds: (...a: unknown[]) => getRecordsByIds(...a),
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

const record = {
  id: 7,
  content: "在的呀",
  timestamp: new Date("2023-07-12T08:16:09.000Z"),
  speaker: "小满",
  role: "assistant",
};

describe("persona.evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    listDistillationCards.mockResolvedValue([
      {
        dimension: "habit",
        claim: "短句",
        periodId: "p2",
        payload: { quotes: [7] },
        createdAt: new Date("2023-07-12T08:16:09.000Z"),
      },
    ]);
    getRecordsByIds.mockResolvedValue([record]);
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.evidence({ id: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns quotes that match the record table", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).persona.evidence({ id: 5 });
    expect(getRecordsByIds).toHaveBeenCalledWith([7], 1);
    const quotes = result.dimensions.habit.flatMap((card) => card.quotes);
    expect(quotes).toHaveLength(1);
    const found = quotes[0]!;
    expect(found.recordId).toBe(record.id);
    expect(found.text).toBe(record.content);
  });
});
