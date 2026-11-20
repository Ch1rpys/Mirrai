import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const searchRecordsLexical = vi.fn();
const searchRecordsSemantic = vi.fn();
const getRecordsAround = vi.fn();
const getPersonasByUserId = vi.fn();

vi.mock("./_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
  afterRecordsRemoved: vi.fn(),
  measureStyleProfile: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  searchRecordsLexical: (...a: unknown[]) => searchRecordsLexical(...a),
  searchRecordsSemantic: (...a: unknown[]) => searchRecordsSemantic(...a),
  getRecordsAround: (...a: unknown[]) => getRecordsAround(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
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

const hit = (id: number) => ({
  id,
  content: `第${id}句`,
  timestamp: new Date("2022-03-01T12:00:00.000Z"),
  coverage: 1,
});

describe("record.search, context and searchAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    searchRecordsSemantic.mockResolvedValue({ hits: [], truncated: false });
    getPersonasByUserId.mockResolvedValue([{ id: 5, name: "小满" }]);
    getRecordsAround.mockResolvedValue({ target: undefined, before: [], after: [] });
  });

  it("pages the literal hits by cursor and asks for one more than a page", async () => {
    searchRecordsLexical.mockResolvedValue(
      Array.from({ length: 31 }, (_, index) => hit(index + 1)),
    );
    const first = await appRouter
      .createCaller(ctxFor(1))
      .record.search({ personaId: 5, q: "还", role: "assistant" });
    expect(first.exact).toHaveLength(30);
    expect(first.next).toBe("30");
    expect(searchRecordsLexical).toHaveBeenCalledWith(5, 1, expect.objectContaining({
      q: "还",
      role: "assistant",
      limit: 31,
      offset: 0,
    }));

    searchRecordsLexical.mockResolvedValue([hit(99)]);
    const second = await appRouter
      .createCaller(ctxFor(1))
      .record.search({ personaId: 5, q: "还", role: "all", cursor: "30" });
    expect(second.next).toBeNull();
    expect(searchRecordsLexical).toHaveBeenLastCalledWith(5, 1, expect.objectContaining({
      offset: 30,
      role: "all",
    }));
  });

  it("passes the time range as dates to both halves of the search", async () => {
    searchRecordsLexical.mockResolvedValue([]);
    await appRouter.createCaller(ctxFor(1)).record.search({
      personaId: 5,
      q: "海",
      from: "2022-01-01T00:00:00.000Z",
      to: "2022-12-31T23:59:59.000Z",
    });
    const params = searchRecordsLexical.mock.calls[0][2];
    expect(params.from).toEqual(new Date("2022-01-01T00:00:00.000Z"));
    expect(params.to).toEqual(new Date("2022-12-31T23:59:59.000Z"));
    expect(searchRecordsSemantic).toHaveBeenCalledWith(5, 1, expect.objectContaining({
      from: new Date("2022-01-01T00:00:00.000Z"),
      to: new Date("2022-12-31T23:59:59.000Z"),
    }));
  });

  it("keeps a semantic hit that is not already in the literal list", async () => {
    searchRecordsLexical.mockResolvedValue([hit(1)]);
    searchRecordsSemantic.mockResolvedValue({
      hits: [
        { id: 1, content: "第1句", timestamp: null, role: "assistant", score: 0.9 },
        { id: 2, content: "海边的风", timestamp: null, role: "assistant", score: 0.8 },
      ],
      truncated: true,
    });
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.search({ personaId: 5, q: "海" });
    expect(result.similar?.map((row) => row.id)).toEqual([2]);
    expect(result.semanticTruncated).toBe(true);
  });

  it("says the meaning search is unavailable with null, not an empty list", async () => {
    searchRecordsLexical.mockResolvedValue([]);
    searchRecordsSemantic.mockResolvedValue(null);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.search({ personaId: 5, q: "海" });
    expect(result.similar).toBeNull();
  });

  it("refuses the context of another persona's line", async () => {
    getRecordsAround.mockResolvedValue({
      target: { id: 11, personaId: 6, role: "assistant", content: "x", createdAt: new Date() },
      before: [],
      after: [],
    });
    await expect(
      appRouter.createCaller(ctxFor(1)).record.context({ personaId: 5, recordId: 11 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("searches the original lines across the caller's personas only", async () => {
    getPersonasByUserId.mockResolvedValue([
      { id: 5, name: "小满" },
      { id: 6, name: "小林" },
    ]);
    searchRecordsLexical.mockImplementation(async (personaId: number) =>
      personaId === 5 ? [hit(1), hit(2), hit(3), hit(4), hit(5)] : [hit(6)],
    );
    const rows = await appRouter.createCaller(ctxFor(1)).record.searchAll({ q: "海" });
    expect(searchRecordsLexical).toHaveBeenCalledWith(5, 1, expect.objectContaining({ limit: 5 }));
    expect(searchRecordsLexical).toHaveBeenCalledWith(6, 1, expect.objectContaining({ limit: 5 }));
    expect(rows.every((row) => row.personaId === 5 || row.personaId === 6)).toBe(true);
    expect(rows).toHaveLength(6);
  });
});
