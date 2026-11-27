import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { normalizePersonaSettings } from "@shared/persona-settings";

const getUserById = vi.fn();
const getPersonasByUserId = vi.fn();
const getPersonaById = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const getRecentEmotionTrend = vi.fn();
const getRecentCheckinAnswers = vi.fn();
const getRecentUserMood = vi.fn();
const getSafetyEvents = vi.fn();
const updatePersona = vi.fn();
const getLatestGraduationAssessment = vi.fn();

vi.mock("../db", () => ({
  getUserById: (...a: unknown[]) => getUserById(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonasByUserId(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getMemoriesByPersonaId: (...a: unknown[]) => getMemoriesByPersonaId(...a),
  getRecentEmotionTrend: (...a: unknown[]) => getRecentEmotionTrend(...a),
  getRecentCheckinAnswers: (...a: unknown[]) => getRecentCheckinAnswers(...a),
  getRecentUserMood: (...a: unknown[]) => getRecentUserMood(...a),
  getSafetyEvents: (...a: unknown[]) => getSafetyEvents(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getLatestGraduationAssessment: (...a: unknown[]) => getLatestGraduationAssessment(...a),
}));

import { appRouter } from "../routers";

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

function personaFor(userId: number, id: number, name: string) {
  return {
    id,
    userId,
    name,
    personaData: {
      personality: "温柔",
      people: [
        { id: "p-mom", name: "我妈", relation: "家人", mentions: 9, verified: false, source: "auto" },
        { id: "p-qiqi", name: "琪琪", relation: "室友", mentions: 12, verified: true, source: "auto" },
      ],
    },
    styleProfile: { version: 1, measuredAt: "2026-11-01T00:00:00.000Z", recordsVersion: "10:10", mirror: { starts: { me: 3, them: 2 } } },
    settings: null,
  };
}

describe("the inference routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockResolvedValue({
      id: 1,
      addressStyle: "叫我阿树",
      boundaries: "不谈工作",
      trajectoryAssessment: "auto",
      timezone: "Asia/Shanghai",
    });
    getPersonasByUserId.mockImplementation(async (userId: number) => (
      userId === 1 ? [personaFor(1, 5, "小满")] : [personaFor(2, 6, "阿凯")]
    ));
    getPersonaById.mockImplementation(async (id: number, userId: number) => (
      (id === 5 && userId === 1) || (id === 6 && userId === 2)
        ? personaFor(userId, id, id === 5 ? "小满" : "阿凯")
        : undefined
    ));
    getMemoriesByPersonaId.mockResolvedValue([]);
    getRecentEmotionTrend.mockResolvedValue([]);
    getRecentCheckinAnswers.mockResolvedValue([]);
    getRecentUserMood.mockResolvedValue(null);
    getSafetyEvents.mockResolvedValue([]);
    getLatestGraduationAssessment.mockResolvedValue(null);
    updatePersona.mockResolvedValue(true);
  });

  it("only ever returns the caller's own personas", async () => {
    const owner = await appRouter.createCaller(ctxFor(1)).inference.list();
    const titles = owner.sections.map((section) => section.titleParams?.name ?? section.id);
    expect(titles).toContain("小满");
    expect(titles).not.toContain("阿凯");

    const other = await appRouter.createCaller(ctxFor(2)).inference.list();
    expect(other.sections.map((section) => section.titleParams?.name ?? section.id)).toContain("阿凯");
    expect(other.sections.map((section) => section.titleParams?.name ?? section.id)).not.toContain("小满");
    // It was asked once per caller, by that caller's id.
    expect(getPersonasByUserId).toHaveBeenCalledWith(1);
    expect(getPersonasByUserId).toHaveBeenCalledWith(2);
  });

  it("returns the disabled profile keys with the persona they belong to", async () => {
    getPersonasByUserId.mockResolvedValue([
      {
        ...personaFor(1, 5, "小满"),
        styleProfile: {
          version: 1,
          measuredAt: "2026-11-01T00:00:00.000Z",
          recordsVersion: "10:10",
          conflict: {
            episodes: 6,
            durationMin: { median: 300, p25: 240, p75: 360, all: [180, 240, 300, 300, 360, 480] },
            repairBy: { them: 4, me: 2 },
            repairAcceptRate: 0.6,
            repairLines: ["好啦 不气了"],
            coldLines: ["哦。"],
          },
        },
        settings: { ...normalizePersonaSettings(null), disabledProfiles: ["conflict", "mirror"] },
      },
    ]);
    const result = await appRouter.createCaller(ctxFor(1)).inference.list();
    const conflict = result.sections
      .find((section) => section.id === "persona-5")!
      .items.find((item) => item.labelKey === "styleProfile.conflict");
    expect(conflict?.disabled).toBe(true);
  });

  it("removes only the candidate the user rejected, and only their persona", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const result = await caller.inference.rejectCandidate({
      personaId: 5,
      candidateKind: "people",
      key: "p-mom",
    });
    expect(result).toEqual({ removed: true });
    const [, userId, patch] = updatePersona.mock.calls[0];
    expect(userId).toBe(1);
    const people = (patch as { personaData: { people: Array<{ id: string }> } }).personaData.people;
    expect(people.map((row) => row.id)).toEqual(["p-qiqi"]);
  });

  it("refuses another user's persona", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.inference.rejectCandidate({
      personaId: 6,
      candidateKind: "people",
      key: "p-mom",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("refuses a candidate that is not there", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.inference.rejectCandidate({
      personaId: 5,
      candidateKind: "people",
      key: "p-nobody",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updatePersona).not.toHaveBeenCalled();
  });
});
