import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

const getPersonaById = vi.fn();
const buildTimeline = vi.fn();
const setTurningPointDecision = vi.fn();

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));

vi.mock("./records/timeline", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTimeline: (...a: unknown[]) => buildTimeline(...a),
  setTurningPointDecision: (...a: unknown[]) => setTurningPointDecision(...a),
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

describe("record.timeline and the turning-point decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockResolvedValue({ id: 5, userId: 1, name: "小满" });
    buildTimeline.mockResolvedValue({ series: [], points: [] });
    setTurningPointDecision.mockResolvedValue({ id: "2023-W29", status: "confirmed" });
  });

  it("returns the curves and refuses somebody else's persona", async () => {
    const result = await appRouter.createCaller(ctxFor(1)).record.timeline({ personaId: 5 });
    expect(result).toEqual({ series: [], points: [] });
    expect(buildTimeline).toHaveBeenCalledWith({ personaId: 5, userId: 1 });

    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).record.timeline({ personaId: 99 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a confirmation, a rejection and a note", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.turningPoint.confirm({ personaId: 5, id: "2023-W29", note: "换工作" });
    expect(setTurningPointDecision).toHaveBeenLastCalledWith({
      personaId: 5,
      userId: 1,
      id: "2023-W29",
      status: "confirmed",
      note: "换工作",
    });
    await caller.turningPoint.reject({ personaId: 5, id: "2023-W31" });
    expect(setTurningPointDecision).toHaveBeenLastCalledWith({
      personaId: 5,
      userId: 1,
      id: "2023-W31",
      status: "rejected",
    });
    await caller.turningPoint.annotate({ personaId: 5, id: "2023-W33", note: "那周搬家" });
    expect(setTurningPointDecision).toHaveBeenLastCalledWith({
      personaId: 5,
      userId: 1,
      id: "2023-W33",
      status: "confirmed",
      note: "那周搬家",
    });
  });

  it("carries the changes of the point the user confirmed into the stored decision (C2.5)", async () => {
    // The page shows the user what moved before it asks them to keep the
    // turn. Those changes have to be written with the decision: a later
    // run that no longer measures the week must still be able to show
    // the line and "what changed", not an empty list.
    const changes = [
      { series: "charsMedian", before: 10, after: 6 },
      { series: "total", before: 32, after: 11 },
    ] as const;
    const caller = appRouter.createCaller(ctxFor(1));
    await caller.turningPoint.confirm({ personaId: 5, id: "2023-W29", note: "换工作", changes: [...changes] });
    expect(setTurningPointDecision).toHaveBeenLastCalledWith({
      personaId: 5,
      userId: 1,
      id: "2023-W29",
      status: "confirmed",
      note: "换工作",
      changes: [...changes],
    });
    await caller.turningPoint.annotate({ personaId: 5, id: "2023-W33", note: "那周搬家", changes: [...changes] });
    expect(setTurningPointDecision).toHaveBeenLastCalledWith({
      personaId: 5,
      userId: 1,
      id: "2023-W33",
      status: "confirmed",
      note: "那周搬家",
      changes: [...changes],
    });
  });

  it("refuses malformed changes before writing anything (C2.5)", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const badSeries = [{ series: "not-a-series", before: 1, after: 2 }] as never;
    await expect(
      caller.turningPoint.confirm({ personaId: 5, id: "2023-W29", changes: badSeries }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const badNumber = [{ series: "total", before: "nine", after: 2 }] as never;
    await expect(
      caller.turningPoint.confirm({ personaId: 5, id: "2023-W29", changes: badNumber }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const tooMany = Array.from({ length: 13 }, () => ({
      series: "total" as const,
      before: 10,
      after: 6,
    }));
    await expect(
      caller.turningPoint.confirm({ personaId: 5, id: "2023-W29", changes: tooMany }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setTurningPointDecision).not.toHaveBeenCalled();
  });

  it("does not decide on somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(
      appRouter.createCaller(ctxFor(1)).turningPoint.confirm({ personaId: 99, id: "2023-W29" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
