import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { DescribedStatement } from "@shared/described";

const getPersonaById = vi.hoisted(() => vi.fn());
const countRecords = vi.hoisted(() => vi.fn());
const createPersona = vi.hoisted(() => vi.fn());
const createOralAccount = vi.hoisted(() => vi.fn());
const listSubmittedOralAccounts = vi.hoisted(() => vi.fn());
const updatePersona = vi.hoisted(() => vi.fn());
const resolveProvider = vi.hoisted(() => vi.fn());
const resolveProviderForUser = vi.hoisted(() => vi.fn());
const providerInvoke = vi.hoisted(() => vi.fn());
const transcribeAudio = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  ORAL_ACCOUNT_MAX_CHARS: 20_000,
  countRecords: (...args: unknown[]) => countRecords(...args),
  createOralAccount: (...args: unknown[]) => createOralAccount(...args),
  createPersona: (...args: unknown[]) => createPersona(...args),
  getPersonaById: (...args: unknown[]) => getPersonaById(...args),
  listSubmittedOralAccounts: (...args: unknown[]) => listSubmittedOralAccounts(...args),
  updatePersona: (...args: unknown[]) => updatePersona(...args),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForPurposeWithOwnership: (...args: unknown[]) => resolveProvider(...args),
  resolveProviderForUser: (...args: unknown[]) => resolveProviderForUser(...args),
}));

vi.mock("../_core/stt", () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
}));

import { interviewRouter } from "./interview";

function ctxFor(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      username: "ashu",
      passwordHash: null,
      openId: null,
      email: null,
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      lastSignedIn: new Date("2026-01-01T00:00:00Z"),
      name: "阿树",
      timezone: "Asia/Shanghai",
      locale: "zh",
    },
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: {} } as never,
    res: {} as never,
    locale: "zh",
  } as unknown as TrpcContext;
}

function caller(userId = 1) {
  return interviewRouter.createCaller(ctxFor(userId));
}

/** The persona update that was written. */
function writtenPersonaData(): Record<string, any> {
  const call = updatePersona.mock.calls.at(-1);
  return (call?.[2] as Record<string, any>)?.personaData ?? {};
}

function described(): DescribedStatement[] {
  const value = writtenPersonaData().described;
  return Array.isArray(value) ? value : [];
}

const transcript = [
  {
    aspect: "address" as const,
    question: "你们平时怎么称呼对方？",
    answer: "他叫我小满，我叫他阿树。",
  },
];

describe("the interview routes (C1.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProvider.mockResolvedValue({
      provider: { invoke: (...args: unknown[]) => providerInvoke(...args) },
      owned: true,
    });
    providerInvoke.mockResolvedValue("你们平时怎么称呼对方？");
    getPersonaById.mockResolvedValue({
      id: 5,
      userId: 1,
      name: "小满",
      personaData: {},
      llmProvider: null,
      sharedFromPersonaId: null,
    });
    countRecords.mockResolvedValue(0);
    createPersona.mockResolvedValue(42);
    createOralAccount.mockResolvedValue(7);
    listSubmittedOralAccounts.mockResolvedValue([]);
    updatePersona.mockResolvedValue(true);
    transcribeAudio.mockResolvedValue({ text: "他叫我小满", engine: "test" });
    resolveProviderForUser.mockResolvedValue({ name: "voice-provider" });
  });

  it("asks the next question with purpose other, decided by the code", async () => {
    const result = await caller().next({ transcript: [] });
    expect(result).toMatchObject({ done: false, aspect: "address", round: 1 });
    const [request] = providerInvoke.mock.calls[0] as [unknown, { purpose: string }];
    expect(request).toBeTruthy();
    expect((providerInvoke.mock.calls[0] as unknown[])[1]).toMatchObject({ purpose: "other" });
  });

  it("ends when the person says 就这些", async () => {
    const result = await caller().next({
      transcript: [
        { aspect: "address", question: "你们怎么称呼？", answer: "就这些" },
      ],
    });
    expect(result.done).toBe(true);
    expect(result.reason).toBe("user-said-done");
  });

  it("turns a spoken answer into words, and stores nothing", async () => {
    const result = await caller().transcribe({
      audioContent: Buffer.from("audio").toString("base64"),
      fileName: "interview.webm",
    });
    expect(result.text).toBe("他叫我小满");
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(transcribeAudio.mock.calls[0]?.[0]).toMatchObject({
      purpose: "chat",
      provider: { name: "voice-provider" },
    });
    expect(resolveProviderForUser).toHaveBeenCalledWith({ userId: 1 });
    expect(createOralAccount).not.toHaveBeenCalled();
  });

  it("creates the persona from the interview, and stores the transcript as an oral account", async () => {
    providerInvoke.mockResolvedValue(
      JSON.stringify([
        {
          field: "address",
          text: "他叫她小满，她叫他阿树。",
          quote: "他叫我小满，我叫他阿树",
        },
        {
          field: "personality",
          text: "说话很直接。",
          quote: "这句话访谈里没有",
        },
      ]),
    );
    const result = await caller().finish({ name: "小满", transcript });
    expect(result.personaId).toBe(42);
    expect(result.statements).toBe(1);
    expect(result.dropped).toBe(1);

    const created = createPersona.mock.calls[0]?.[0] as Record<string, any>;
    expect(created).toMatchObject({ userId: 1, name: "小满", source: "described" });
    const described = created.personaData.described as DescribedStatement[];
    expect(described).toHaveLength(1);
    expect(described[0]).toMatchObject({
      text: "他叫她小满，她叫他阿树。",
      source: "described",
      quote: "他叫我小满，我叫他阿树",
      teller: "阿树",
    });

    // The interview itself was the material sent for the persona, fenced.
    const messages = providerInvoke.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
    const promptUser = String(messages[1]?.content ?? "");
    expect(promptUser).toContain("他叫我小满，我叫他阿树");
    const outside = promptUser.replace(
      /MATERIAL>>>:([0-9a-f]+)[\s\S]*?<<<END MATERIAL>>>:\1/g,
      "",
    );
    expect(outside).not.toContain("他叫我小满，我叫他阿树");

    const oral = createOralAccount.mock.calls[0]?.[0] as Record<string, any>;
    expect(oral).toMatchObject({ personaId: 42, userId: 1, tellerName: "阿树" });
    expect(String(oral.body)).toContain("他叫我小满，我叫他阿树");
    expect(oral.submittedAt).toBeInstanceOf(Date);

    // The generation is a distillation; the questions are `other`.
    expect((providerInvoke.mock.calls[0] as unknown[])[1]).toMatchObject({
      purpose: "distill",
    });
  });

  it("describes an existing persona from an interview, without creating another one", async () => {
    providerInvoke.mockResolvedValue(
      JSON.stringify([
        { field: "personality", text: "生气时先沉默。", quote: "他生气时一句话都不说" },
      ]),
    );
    const result = await caller().finish({
      personaId: 5,
      transcript: [
        {
          aspect: "angry",
          question: "他生气的时候是什么样？",
          answer: "他生气时一句话都不说，过一天才说。",
        },
      ],
    });
    expect(result.personaId).toBe(5);
    expect(createPersona).not.toHaveBeenCalled();
    expect(createOralAccount).toHaveBeenCalledTimes(1);
    const stored = described();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe("described");
    expect(stored[0]?.quote).toBe("他生气时一句话都不说");
  });

  it("refuses to describe a persona that already has records", async () => {
    countRecords.mockResolvedValue(3);
    await expect(
      caller().finish({ personaId: 5, transcript }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createOralAccount).not.toHaveBeenCalled();
  });

  it("writes the persona from the submitted oral accounts, with the teller of each sentence (C7.4)", async () => {
    const accounts = [
      {
        id: 9,
        userId: 2,
        tellerName: "琪琪",
        body: "他讨厌香菜，每次都要挑出来。",
        submittedAt: new Date("2026-03-01T00:00:00Z"),
      },
      {
        id: 3,
        userId: 1,
        tellerName: "阿树",
        body: "他生气时一句话都不说。",
        submittedAt: new Date("2026-03-01T00:00:00Z"),
      },
    ];
    listSubmittedOralAccounts.mockResolvedValue(accounts);
    providerInvoke.mockResolvedValue(
      JSON.stringify([
        { field: "likes", text: "讨厌香菜。", quote: "讨厌香菜，每次都要挑出来" },
        { field: "personality", text: "生气时先沉默。", quote: "他生气时一句话都不说" },
        { field: "routine", text: "早起。", quote: "每天早上六点起床" },
      ]),
    );

    const result = await caller().fromOral({ personaId: 5 });
    expect(result).toMatchObject({ personaId: 5, statements: 2, dropped: 1 });
    expect(result.tellers).toEqual(["琪琪", "阿树"]);

    // The accounts were the transcript, and they were fenced as material.
    const messages = providerInvoke.mock.calls[0]?.[0] as Array<{ content: string }>;
    const user = String(messages[1]?.content ?? "");
    expect(user).toContain("他讨厌香菜，每次都要挑出来");
    expect(user).toContain("他生气时一句话都不说");
    const outsideFence = user.replace(
      /MATERIAL>>>:([0-9a-f]+)[\s\S]*?<<<END MATERIAL>>>:\1/g,
      "",
    );
    expect(outsideFence).not.toContain("他讨厌香菜");

    // Every sentence names who told it, and its quote is in that account.
    const stored = described();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      source: "described",
      quote: "讨厌香菜，每次都要挑出来",
      teller: "琪琪",
      accountId: 9,
    });
    expect(stored[1]).toMatchObject({ teller: "阿树", accountId: 3 });
    for (const statement of stored) {
      const account = accounts.find((row) => row.id === statement.accountId);
      expect(account?.body).toContain(statement.quote);
    }
  });

  it("refuses the oral-account path when nothing was submitted", async () => {
    listSubmittedOralAccounts.mockResolvedValue([]);
    await expect(caller().fromOral({ personaId: 5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(providerInvoke).not.toHaveBeenCalled();
  });

  it("does not describe somebody else's persona", async () => {
    getPersonaById.mockResolvedValue(undefined);
    await expect(caller(2).fromOral({ personaId: 5 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller(2).finish({ personaId: 5, transcript })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("says honestly when the description could not be read", async () => {
    providerInvoke.mockResolvedValue("这不是 JSON");
    await expect(
      caller().finish({ name: "小满", transcript }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createPersona).not.toHaveBeenCalled();
  });
});
