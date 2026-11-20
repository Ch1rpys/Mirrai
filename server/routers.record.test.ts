import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const pageRecords = vi.fn();
const listRecordMarks = vi.fn();
const listMediaForRecordIds = vi.fn();
const countRecordsByMonth = vi.fn();
const deleteRecordRow = vi.fn();
const upsertRecordMark = vi.fn();
const removeRecordMark = vi.fn();
const afterRecordsRemoved = vi.fn();
const iterateRecords = vi.fn();
const getPersonaStyleProfile = vi.fn();

vi.mock("./_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
  afterRecordsRemoved: (...a: unknown[]) => afterRecordsRemoved(...a),
  measureStyleProfile: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  pageRecords: (...a: unknown[]) => pageRecords(...a),
  listRecordMarks: (...a: unknown[]) => listRecordMarks(...a),
  listMediaForRecordIds: (...a: unknown[]) => listMediaForRecordIds(...a),
  countRecordsByMonth: (...a: unknown[]) => countRecordsByMonth(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
  deleteRecordRow: (...a: unknown[]) => deleteRecordRow(...a),
  upsertRecordMark: (...a: unknown[]) => upsertRecordMark(...a),
  removeRecordMark: (...a: unknown[]) => removeRecordMark(...a),
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

const row = {
  id: 11,
  role: "assistant",
  speaker: "小满",
  kind: "text",
  timestamp: new Date("2022-03-01T12:00:00.000Z"),
  createdAt: new Date("2022-03-01T12:00:00.000Z"),
  content: "在的呀",
  source: "wechat_export",
  fileId: 7,
  meta: null,
};

describe("record.page and the reader's routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满", personaData: {} });
    pageRecords.mockResolvedValue({ rows: [row], hasOlder: false, hasNewer: true });
    listRecordMarks.mockResolvedValue([]);
    listMediaForRecordIds.mockResolvedValue([]);
    countRecordsByMonth.mockResolvedValue([{ month: "2022-03", count: 1 }]);
    deleteRecordRow.mockResolvedValue(true);
    upsertRecordMark.mockResolvedValue({ id: 3, kind: "bookmark", note: null });
    removeRecordMark.mockResolvedValue(true);
    afterRecordsRemoved.mockResolvedValue(undefined);
    iterateRecords.mockImplementation(async function* () {});
    getPersonaStyleProfile.mockResolvedValue({ conflict: null });
  });

  it("passes the three directions through, with their boundaries", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const older = await caller.record.page({ personaId: 5, direction: "older", limit: 50 });
    expect(older).toMatchObject({ hasOlder: false, hasNewer: true });
    expect(older.rows[0]).toMatchObject({ id: 11, content: "在的呀" });

    pageRecords.mockResolvedValue({ rows: [], hasOlder: false, hasNewer: false });
    await caller.record.page({ personaId: 5, direction: "newer", limit: 200 });
    expect(pageRecords).toHaveBeenLastCalledWith(5, 1, expect.objectContaining({
      direction: "newer", limit: 200,
    }));

    await caller.record.page({
      personaId: 5,
      direction: "around",
      anchor: { recordId: 11 },
      limit: 20,
    });
    expect(pageRecords).toHaveBeenLastCalledWith(5, 1, expect.objectContaining({
      direction: "around",
      anchor: { recordId: 11 },
    }));
  });

  it("refuses a page of more than two hundred lines", async () => {
    await expect(
      appRouter.createCaller(ctxFor(1)).record.page({ personaId: 5, direction: "older", limit: 201 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not open somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(ctxFor(1));
    for (const run of [
      () => caller.record.page({ personaId: 99, direction: "older", limit: 20 }),
      () => caller.record.outline({ personaId: 99 }),
      () => caller.record.marks.list({ personaId: 99 }),
      () => caller.record.delete({ personaId: 99, recordId: 11 }),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("renders a sticker marker and folds a line the harm filter flagged", async () => {
    pageRecords.mockResolvedValue({
      rows: [
        { ...row, kind: "sticker", content: "[sticker:狗狗探头]", meta: { label: "狗狗探头" } },
        { ...row, id: 12, content: "你真没用" },
      ],
      hasOlder: false,
      hasNewer: false,
    });
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { harmReport: { categories: [], decision: "pending" } },
    });
    const page = await appRouter
      .createCaller(ctxFor(1))
      .record.page({ personaId: 5, direction: "older", limit: 200 });
    expect(page.rows[0].content).toContain("狗狗探头");
    expect(page.rows[0].harmful).toBe(false);
    expect(page.rows[1].harmful).toBe(true);
  });

  it("deletes only a line of its own persona", async () => {
    deleteRecordRow.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(ctxFor(1)).record.delete({ personaId: 5, recordId: 11 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    deleteRecordRow.mockResolvedValue(true);
    const result = await appRouter
      .createCaller(ctxFor(1))
      .record.delete({ personaId: 5, recordId: 11 });
    expect(result).toEqual({ deleted: true });
    expect(deleteRecordRow).toHaveBeenCalledWith(11, 5, 1);
    expect(afterRecordsRemoved).toHaveBeenCalledWith({ personaId: 5, userId: 1 });
  });

  it("adds and removes a mark within the caller's own persona", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.record.marks.add({
      personaId: 5,
      recordId: 11,
      kind: "note",
      note: "记住这句",
    });
    expect(upsertRecordMark).toHaveBeenCalledWith({
      userId: 1,
      personaId: 5,
      recordId: 11,
      kind: "note",
      note: "记住这句",
    });
    await caller.record.marks.remove({ personaId: 5, id: 3 });
    expect(removeRecordMark).toHaveBeenCalledWith(3, 1, 5);
    await expect(
      caller.record.marks.add({ personaId: 5, recordId: 11, kind: "note", note: "x".repeat(1001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("passes the emotion column through to the first fight", async () => {
    const at = new Date("2022-03-01T20:00:00.000Z");
    iterateRecords.mockImplementation(async function* () {
      yield {
        id: 1,
        role: "user",
        content: "嗯",
        kind: "text",
        timestamp: at,
        createdAt: at,
        meta: null,
        emotion: null,
      };
      yield {
        id: 2,
        role: "assistant",
        content: "就嗯？",
        kind: "text",
        timestamp: new Date(at.getTime() + 60_000),
        createdAt: new Date(at.getTime() + 60_000),
        meta: null,
        emotion: "distant",
      };
    });
    getPersonaStyleProfile.mockResolvedValue({ conflict: { episodes: 1 } });
    const firsts = await appRouter
      .createCaller(ctxFor(1))
      .record.firsts({ personaId: 5 });
    expect(firsts.some((item: { key: string }) => item.key === "firstFight")).toBe(true);
  });

  it("returns the outline and the periods", async () => {
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: { periods: [{ id: "p1", from: "2022-03-01", to: "2023-06-09" }] },
    });
    const outline = await appRouter
      .createCaller(ctxFor(1))
      .record.outline({ personaId: 5 });
    expect(outline.months).toEqual([{ month: "2022-03", count: 1 }]);
    expect(outline.periods[0]).toMatchObject({ id: "p1", from: "2022-03-01" });
  });
});
