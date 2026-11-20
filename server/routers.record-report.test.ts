import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const getRecordsVersion = vi.fn();
const getRecordReportCache = vi.fn();
const saveRecordReportCache = vi.fn();
const countRecords = vi.fn();
const iterateRecords = vi.fn();
const getPersonaStyleProfile = vi.fn();

vi.mock("./_core/style-profile", () => ({
  afterRecordsChanged: vi.fn(),
  afterRecordsRemoved: vi.fn(),
  measureStyleProfile: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getRecordsVersion: (...a: unknown[]) => getRecordsVersion(...a),
  getRecordReportCache: (...a: unknown[]) => getRecordReportCache(...a),
  saveRecordReportCache: (...a: unknown[]) => saveRecordReportCache(...a),
  countRecords: (...a: unknown[]) => countRecords(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...a),
  getPersonaStyleProfile: (...a: unknown[]) => getPersonaStyleProfile(...a),
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

const rows = [
  {
    id: 1,
    role: "user",
    content: "在吗",
    kind: "text",
    timestamp: new Date("2022-03-01T12:00:00.000Z"),
    createdAt: new Date("2022-03-01T12:00:00.000Z"),
    meta: null,
  },
  {
    id: 2,
    role: "assistant",
    content: "在的呀",
    kind: "text",
    timestamp: new Date("2022-03-01T12:00:30.000Z"),
    createdAt: new Date("2022-03-01T12:00:30.000Z"),
    meta: null,
  },
];

describe("record.report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, timezone: "Asia/Shanghai" });
    getRecordsVersion.mockResolvedValue("2:2");
    getRecordReportCache.mockResolvedValue(null);
    saveRecordReportCache.mockResolvedValue(undefined);
    countRecords.mockResolvedValue(2);
    iterateRecords.mockImplementation(async function* () {
      yield* rows;
    });
    getPersonaStyleProfile.mockResolvedValue({ calls: null });
  });

  it("builds once and returns the cache the second time", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const first = await caller.record.report({ personaId: 5 });
    expect(first.status).toBe("ready");
    expect(iterateRecords).toHaveBeenCalledTimes(1);
    expect(saveRecordReportCache).toHaveBeenCalledTimes(1);
    const saved = saveRecordReportCache.mock.calls[0][0];
    expect(saved.recordsVersion).toBe("2:2");

    getRecordReportCache.mockResolvedValue({
      recordsVersion: "2:2",
      report: saved.report,
      createdAt: new Date(),
    });
    const second = await caller.record.report({ personaId: 5 });
    expect(second.status).toBe("ready");
    expect(iterateRecords).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the records version moved", async () => {
    getRecordReportCache.mockResolvedValue({
      recordsVersion: "1:1",
      report: { stale: true },
      createdAt: new Date(),
    });
    const result = await appRouter.createCaller(ctxFor(1)).record.report({ personaId: 5 });
    expect(result.status).toBe("ready");
    expect(iterateRecords).toHaveBeenCalledTimes(1);
  });

  it("says building for a very large record instead of blocking", async () => {
    countRecords.mockResolvedValue(200_001);
    const result = await appRouter.createCaller(ctxFor(1)).record.report({ personaId: 5 });
    expect(result).toEqual({ status: "building" });
  });

  it("does not read somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).record.report({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
