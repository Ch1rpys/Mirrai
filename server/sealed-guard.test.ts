import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TrpcContext } from "./_core/context";

const getPersonaSettings = vi.fn();
const getPersonaById = vi.fn();
const getPersonaStyleProfile = vi.fn();
const setPersonaSettings = vi.fn();
const getMemoryTitles = vi.fn();
const getFileSummaryTitles = vi.fn();
const deletePersona = vi.fn();
const getMessagesByPersonaId = vi.fn();
const getLetters = vi.fn();
const countLetters = vi.fn();
const getMemoriesByPersonaId = vi.fn();
const pageRecords = vi.fn();

vi.mock("./db", () => ({
  getPersonaSettings: (...args: unknown[]) => getPersonaSettings(...args),
  getPersonaStateSettings: (...args: unknown[]) => getPersonaSettings(...args),
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  getPersonaStyleProfile: (...args: unknown[]) => getPersonaStyleProfile(...args),
  setPersonaSettings: (...args: unknown[]) => setPersonaSettings(...args),
  getMemoryTitles: (...args: unknown[]) => getMemoryTitles(...args),
  getFileSummaryTitles: (...args: unknown[]) => getFileSummaryTitles(...args),
  deletePersona: (...args: unknown[]) => deletePersona(...args),
  getMessagesByPersonaId: (...args: unknown[]) => getMessagesByPersonaId(...args),
  getLetters: (...args: unknown[]) => getLetters(...args),
  countLetters: (...args: unknown[]) => countLetters(...args),
  getMemoriesByPersonaId: (...args: unknown[]) => getMemoriesByPersonaId(...args),
  pageRecords: (...args: unknown[]) => pageRecords(...args),
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
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const SEALED = { seal: { until: "2099-01-01", earlyOpen: "never" } };

describe("a sealed persona (C6.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaSettings.mockResolvedValue(SEALED);
    getPersonaById.mockResolvedValue({
      id: 1,
      userId: 1,
      name: "小满",
      relationshipDesc: "朋友",
      togetherFrom: "2020-01-01",
      togetherTo: null,
      personaData: null,
      graduationStatus: null,
    });
    getPersonaStyleProfile.mockResolvedValue(null);
    setPersonaSettings.mockResolvedValue(true);
    getMemoryTitles.mockResolvedValue([]);
    getFileSummaryTitles.mockResolvedValue([]);
    deletePersona.mockResolvedValue(undefined);
    getMessagesByPersonaId.mockResolvedValue([]);
    getLetters.mockResolvedValue([]);
    countLetters.mockResolvedValue(0);
    getMemoriesByPersonaId.mockResolvedValue([]);
    pageRecords.mockResolvedValue({ records: [] });
  });

  it("refuses the conversation, the letters, the memories and the record reader", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.chat.getHistory({ personaId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("封存"),
    });
    await expect(caller.letter.list({ personaId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.memory.list({ personaId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.record.page({ personaId: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMessagesByPersonaId).not.toHaveBeenCalled();
    expect(pageRecords).not.toHaveBeenCalled();
  });

  it("still lets the user export the persona and delete it", async () => {
    const caller = appRouter.createCaller(ctxFor(1));
    const manual = await caller.persona.exportManual({ personaId: 1 });
    expect(typeof manual.html).toBe("string");
    await expect(caller.persona.delete({ id: 1 })).resolves.toEqual({ success: true });
    expect(deletePersona).toHaveBeenCalledWith(1, 1);
  });

  it("still lets the user lift the seal", async () => {
    getPersonaSettings.mockResolvedValue(SEALED);
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.persona.seal.set({
      personaId: 1,
      until: null,
    })).resolves.toEqual({ sealed: false, until: null });
  });

  it("refuses an early-open request when the seal is never", async () => {
    getPersonaSettings.mockResolvedValue({
      seal: { until: "2099-01-01", earlyOpen: "never" },
    });
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.seal.requestOpen({ personaId: 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setPersonaSettings).not.toHaveBeenCalled();
  });

  it("records an early-open request when the seal is cooling", async () => {
    getPersonaSettings.mockResolvedValue({
      seal: { until: "2099-01-01", earlyOpen: "cooling" },
    });
    await expect(
      appRouter.createCaller(ctxFor(1)).persona.seal.requestOpen({ personaId: 1 }),
    ).resolves.toEqual({ requested: true });
    const written = setPersonaSettings.mock.calls[0][2];
    expect(typeof written.seal.requestedAt).toBe("string");
  });

  it("does not guard a persona that is not sealed", async () => {
    getPersonaSettings.mockResolvedValue({});
    const caller = appRouter.createCaller(ctxFor(1));
    await expect(caller.letter.list({ personaId: 1 })).resolves.toBeTruthy();
    expect(getLetters).toHaveBeenCalled();
  });

  it("is applied to every router group that takes a personaId", () => {
    // The guard sits on `protectedProcedure`, so a router-v6 procedure
    // that takes a personaId through `protectedProcedure` has it. What
    // this test refuses is a group that reaches a personaId through a
    // public procedure, which would bypass the guard.
    const server = join(__dirname);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(join(server, "routers-v6"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const chunks = source.split(/(?=publicProcedure|protectedProcedure)/);
      for (const chunk of chunks) {
        if (!chunk.startsWith("publicProcedure")) continue;
        // The public procedures in `blind.ts` take a guest token, not a
        // persona; a personaId inside one would be the bypass this test
        // is looking for.
        if (/\bpersonaId\s*:/.test(chunk)) {
          offenders.push(`${file}: public procedure with personaId`);
        }
      }
    }
    expect(offenders).toEqual([]);
    const trpc = readFileSync(join(server, "_core", "trpc.ts"), "utf8");
    expect(trpc).toMatch(/protectedProcedure = t\.procedure\.use\(requireUser\)\.use\(sealedGuard\)/);
  });
});
