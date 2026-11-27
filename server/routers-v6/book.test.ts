import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.fn();
const getRelationshipEvents = vi.fn();
const listRecordMarks = vi.fn();
const getOutboundLetters = vi.fn();
const listMedia = vi.fn();

vi.mock("../db", () => ({
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getRelationshipEvents: (...args: unknown[]) => getRelationshipEvents(...args),
  listRecordMarks: (...args: unknown[]) => listRecordMarks(...args),
  getOutboundLetters: (...args: unknown[]) => getOutboundLetters(...args),
  listMedia: (...args: unknown[]) => listMedia(...args),
}));

import { bookRouter } from "./book";

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

function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    name: "小满",
    togetherFrom: "2022-03-01",
    togetherTo: "2024-10-31",
    farewellLetter: "小满写给你的信。琪琪那天打了 13800138000，说要寄到上海市徐汇区淮海中路1234号。",
    personaData: {
      people: [
        { id: "p1", name: "琪琪", relation: "室友", verified: true, source: "manual" },
      ],
      turningPoints: [
        {
          id: "2023-W24",
          at: "2023-W24",
          changes: [{ series: "charsMedian", before: 10, after: 6 }],
          status: "confirmed",
          note: "从那周起，话变短了。",
        },
        {
          id: "2023-W30",
          at: "2023-W30",
          changes: [{ series: "charMedian", before: 6, after: 4 }],
          status: "rejected",
          note: "不该出现。",
        },
      ],
    },
    settings: {
      keptQuotes: [
        {
          recordId: 9,
          text: "琪琪说 13800138000 才是她的号。",
          at: "2024-05-01T21:00:00.000Z",
        },
      ],
    },
    ...overrides,
  } as any;
}

describe("the keepsake book (C6.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue(persona());
    getRelationshipEvents.mockResolvedValue([
      {
        id: 1,
        title: "第一次见面",
        detail: "那天下雨。",
        happenedAt: new Date("2022-03-01T12:00:00Z"),
        kind: "together",
      },
    ]);
    listRecordMarks.mockResolvedValue([
      {
        id: 1,
        recordId: 5,
        kind: "bookmark",
        note: null,
        content: "琪琪说 13800138000。",
        timestamp: new Date("2024-05-02T12:00:00Z"),
      },
      {
        id: 2,
        recordId: 6,
        kind: "note",
        note: "我的批注",
        content: "不该出现在书里。",
        timestamp: new Date("2024-05-03T12:00:00Z"),
      },
    ]);
    getOutboundLetters.mockResolvedValue([{ id: 3, text: "我也想你了。" }]);
    listMedia.mockResolvedValue([
      { id: 11, fileKey: "personas/1/5/imports/1/a.jpg", at: new Date("2024-01-01T12:00:00Z") },
      { id: 12, fileKey: "personas/1/5/imports/1/b.jpg", at: new Date("2024-02-01T12:00:00Z") },
    ]);
  });

  it("keeps everything chosen, and nothing generated", async () => {
    const book = await bookRouter.createCaller(ctxFor(1)).get({ personaId: 1, share: false });
    expect(book.cover.name).toBe("小满");
    expect(book.letters.theirs).toContain("小满写给你的信");
    expect(book.letters.yours).toBe("我也想你了。");
    expect(book.timeline.map((entry) => entry.title)).toEqual([
      "第一次见面",
      "关系里的一处变化",
    ]);
    expect(book.timeline.some((entry) => entry.detail.includes("不该出现"))).toBe(false);
    expect(book.keptQuotes).toHaveLength(1);
    expect(book.bookmarks).toHaveLength(1);
    expect(book.bookmarks[0].text).toContain("13800138000");
  });

  it("removes third-party names and numbers from the share copy", async () => {
    const book = await bookRouter.createCaller(ctxFor(1)).get({ personaId: 1, share: true });
    const serialized = JSON.stringify(book);
    expect(serialized).not.toContain("琪琪");
    expect(serialized).not.toContain("13800138000");
    // The address is replaced too (C6.3).
    expect(serialized).not.toContain("淮海中路1234号");
    expect(serialized).not.toContain("徐汇区");
    // The persona's full name is not in the share copy either.
    expect(serialized).not.toContain("小满");
    expect(book.cover.name).toBe("小*");
    // Photos are left out by default.
    expect(book.photos).toEqual([]);
    expect(book.photoOptions).toHaveLength(2);
  });

  it("puts back only the photos the user ticked", async () => {
    const book = await bookRouter.createCaller(ctxFor(1)).get({
      personaId: 1,
      share: false,
      photoIds: [12],
    });
    expect(book.photos).toEqual([
      { id: 12, url: "/uploads/personas/1/5/imports/1/b.jpg", at: "2024-02-01T12:00:00.000Z" },
    ]);
  });

  it("leaves out a section that has nothing in it", async () => {
    getPersonaById.mockResolvedValue(persona({ settings: {} }));
    listRecordMarks.mockResolvedValue([]);
    const book = await bookRouter.createCaller(ctxFor(1)).get({ personaId: 1, share: false });
    expect(book.keptQuotes).toEqual([]);
    expect(book.bookmarks).toEqual([]);
  });

  it("never calls a model", async () => {
    const source = readFileSync(
      path.resolve(__dirname, "book.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["'][^"']*llm/);
    const book = await bookRouter.createCaller(ctxFor(1)).get({ personaId: 1, share: false });
    expect(book.timeline.length).toBeGreaterThan(0);
  });
});
