import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const getPersonaById = vi.hoisted(() => vi.fn());
const listOralAccounts = vi.hoisted(() => vi.fn());
const listSubmittedOralAccounts = vi.hoisted(() => vi.fn());
const getOralMemories = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
const createOralAccount = vi.hoisted(() => vi.fn());
const updateOralAccount = vi.hoisted(() => vi.fn());
const extractOralMemories = vi.hoisted(() => vi.fn());
const transcribeAudio = vi.hoisted(() => vi.fn());
const resolveProviderForUser = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  ORAL_ACCOUNT_MAX_CHARS: 20_000,
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  listOralAccounts: (...args: unknown[]) => listOralAccounts(...args),
  listSubmittedOralAccounts: (...args: unknown[]) => listSubmittedOralAccounts(...args),
  getOralMemories: (...args: unknown[]) => getOralMemories(...args),
  getUserById: (...args: unknown[]) => getUserById(...args),
  createOralAccount: (...args: unknown[]) => createOralAccount(...args),
  updateOralAccount: (...args: unknown[]) => updateOralAccount(...args),
}));

vi.mock("../oral/extract", () => ({
  extractOralMemories: (...args: unknown[]) => extractOralMemories(...args),
}));

vi.mock("../_core/stt", () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...args: unknown[]) => resolveProviderForUser(...args),
}));

import { oralRouter } from "./oral";

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
      name: userId === 1 ? "阿树" : "小满的妹妹",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

function caller(userId: number) {
  return oralRouter.createCaller(ctxFor(userId));
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    personaId: 5,
    userId: 1,
    tellerName: "阿树",
    body: "小满讨厌香菜。",
    submittedAt: new Date("2026-03-01T00:00:00Z"),
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("what people remember, over the route (C7.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonaById.mockImplementation(async (id: number, userId: number) => {
      if (id === 5 && userId === 1) return { id: 5, userId: 1, name: "小满", personaData: {} };
      if (id === 11 && userId === 2) {
        return { id: 11, userId: 2, name: "小满", sharedFromPersonaId: 5, sharedFromUserId: 1 };
      }
      return null;
    });
    listOralAccounts.mockResolvedValue([]);
    listSubmittedOralAccounts.mockResolvedValue([]);
    getOralMemories.mockResolvedValue([]);
    getUserById.mockResolvedValue({ id: 1, name: "阿树" });
    createOralAccount.mockResolvedValue(21);
    resolveProviderForUser.mockResolvedValue(undefined);
    transcribeAudio.mockResolvedValue({ text: "我记得他爱吃面。", engine: "http" });
    extractOralMemories.mockResolvedValue({
      created: 1,
      dropped: 0,
      repeated: 0,
      readable: true,
      conflictKeys: [],
    });
  });

  it("shows the owner their own drafts and the family's submitted accounts", async () => {
    listOralAccounts.mockResolvedValue([
      account({ id: 1, submittedAt: null, body: "还没提交的。" }),
      account({ id: 2, userId: 2, tellerName: "小满的妹妹", body: "家人提交的。" }),
    ]);
    getOralMemories.mockResolvedValue([
      { id: 7, factKey: "coriander", title: "讨厌香菜。", description: "A", status: "active" },
      { id: 8, factKey: "coriander", title: "喜欢香菜。", description: "B", status: "active" },
      { id: 9, factKey: "coriander", title: "旧的。", description: "C", status: "superseded" },
    ]);

    const result = await caller(1).list({ personaId: 5 });

    // The owner reads the owner's persona row, not a member row.
    expect(listOralAccounts).toHaveBeenCalledWith(5, 1);
    expect(result.isOwner).toBe(true);
    expect(result.accounts.map((row) => [row.id, row.mine, row.submitted])).toEqual([
      [1, true, false],
      [2, false, true],
    ]);
    expect(result.conflicts).toEqual([
      {
        key: "coriander",
        items: [
          { id: 7, title: "讨厌香菜。", description: "A" },
          { id: 8, title: "喜欢香菜。", description: "B" },
        ],
      },
    ]);
  });

  it("shows a family member only what they told, and no conflicts", async () => {
    listOralAccounts.mockResolvedValue([account({ id: 3, userId: 2, tellerName: "小满的妹妹" })]);
    const result = await caller(2).list({ personaId: 11 });

    expect(listOralAccounts).toHaveBeenCalledWith(5, 2);
    expect(result.isOwner).toBe(false);
    expect(result.ownerName).toBe("阿树");
    expect(result.accounts).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(getOralMemories).not.toHaveBeenCalled();
  });

  it("refuses a share that has been stopped", async () => {
    getPersonaById.mockImplementation(async (id: number, userId: number) =>
      id === 12 && userId === 2
        ? { id: 12, userId: 2, name: "小满", sharedFromPersonaId: 5 }
        : null,
    );
    await expect(caller(2).list({ personaId: 12 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(2).save({ personaId: 12, body: "还想写。" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(2).transcribe({
        personaId: 12,
        audioContent: Buffer.from("x").toString("base64"),
        fileName: "a.webm",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createOralAccount).not.toHaveBeenCalled();
  });

  it("keeps a new account as a draft until it is submitted", async () => {
    const created = await caller(1).save({
      personaId: 5,
      body: "  我记得他爱吃面。  ",
    });
    expect(createOralAccount).toHaveBeenCalledWith({
      personaId: 5,
      userId: 1,
      tellerName: "阿树",
      body: "我记得他爱吃面。",
      submittedAt: null,
    });
    expect(created).toEqual({ id: 21, submitted: false });

    await caller(1).save({ personaId: 5, body: "我记得他爱吃面。", submit: true });
    const submitted = createOralAccount.mock.calls.at(-1)![0] as { submittedAt: Date | null };
    expect(submitted.submittedAt).toBeInstanceOf(Date);
  });

  it("writes a family member's account on the owner's persona, with their own name", async () => {
    await caller(2).save({ personaId: 11, body: "他打游戏会摔鼠标。", submit: true });
    expect(createOralAccount).toHaveBeenCalledWith({
      personaId: 5,
      userId: 2,
      tellerName: "小满的妹妹",
      body: "他打游戏会摔鼠标。",
      submittedAt: expect.any(Date),
    });
  });

  it("refuses an empty account and one that is too long", async () => {
    await expect(caller(1).save({ personaId: 5, body: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller(1).save({ personaId: 5, body: "字".repeat(20_001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createOralAccount).not.toHaveBeenCalled();
  });

  it("does not let somebody edit another person's account", async () => {
    updateOralAccount.mockResolvedValue(null);
    await expect(
      caller(2).save({ personaId: 11, id: 4, body: "改一句。" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateOralAccount).toHaveBeenCalledWith(4, 2, 5, { body: "改一句。" });
  });

  it("sends a recording to the same transcription path as a voice note, and stores nothing", async () => {
    const result = await caller(1).transcribe({
      personaId: 5,
      audioContent: Buffer.from("fake audio").toString("base64"),
      fileName: "memo.webm",
    });
    expect(result).toEqual({ text: "我记得他爱吃面。" });
    expect(resolveProviderForUser).toHaveBeenCalledWith({ userId: 1, providerName: undefined });
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "memo.webm",
      purpose: "chat",
    }));
    expect(createOralAccount).not.toHaveBeenCalled();
  });

  it("rejects audio with a name the upload allow-list does not accept", async () => {
    await expect(
      caller(1).transcribe({
        personaId: 5,
        audioContent: Buffer.from("fake audio").toString("base64"),
        fileName: "memo.txt",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("lets only the owner turn accounts into memories", async () => {
    await expect(caller(2).extract({ personaId: 11 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(extractOralMemories).not.toHaveBeenCalled();
  });

  it("extracts from the submitted accounts of the owner's persona", async () => {
    listSubmittedOralAccounts.mockResolvedValue([
      { id: 1, userId: 1, tellerName: "阿树", body: "小满讨厌香菜。", submittedAt: new Date() },
      { id: 2, userId: 2, tellerName: "小满的妹妹", body: "他爱吃面。", submittedAt: new Date() },
    ]);

    const result = await caller(1).extract({ personaId: 5 });

    expect(listSubmittedOralAccounts).toHaveBeenCalledWith(5, 1);
    expect(extractOralMemories).toHaveBeenCalledWith({
      persona: expect.objectContaining({ id: 5, userId: 1 }),
      userId: 1,
      accounts: [
        { id: 1, tellerName: "阿树", body: "小满讨厌香菜。" },
        { id: 2, tellerName: "小满的妹妹", body: "他爱吃面。" },
      ],
      locale: "zh",
    });
    expect(result.created).toBe(1);
  });
});
