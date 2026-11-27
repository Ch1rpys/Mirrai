import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * A reason given in a blind sitting, through the whole path it is for:
 * the candidate queue shows it, and confirming it writes the thing the
 * reason asked for.
 *
 * Two things used to break that path. The sitting's pair stored the
 * case's *position* (`caseId`) and the queue treated it as a message id,
 * so the candidate pointed at an unrelated number. And `confirm`
 * aggregated only the unlike marks, so a blind-test candidate was not
 * found and could not be confirmed at all.
 */

const getPersonaById = vi.fn();
const updatePersona = vi.fn();
const getMessageById = vi.fn();
const listFidelityFeedbackForPersona = vi.fn();
const listBlindSessions = vi.fn();
const getEvalCases = vi.fn();

vi.mock("./db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  updatePersona: (...a: unknown[]) => updatePersona(...a),
  getMessageById: (...a: unknown[]) => getMessageById(...a),
  listFidelityFeedbackForPersona: (...a: unknown[]) => listFidelityFeedbackForPersona(...a),
  listBlindSessions: (...a: unknown[]) => listBlindSessions(...a),
  getEvalCases: (...a: unknown[]) => getEvalCases(...a),
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

const FAKE_LINE = "分身写的另一句";

const persona = {
  id: 5,
  userId: 1,
  name: "小A",
  personaData: {} as Record<string, unknown>,
} as any;

/** One finished sitting where the sitter picked the persona's line. */
function finishedSitting() {
  return {
    id: 7,
    userId: 1,
    personaId: 5,
    subject: "friend",
    groups: [
      { caseId: 3, real: "这句是真话", fake: FAKE_LINE, realFirst: false },
    ],
    answers: [{ group: 0, pick: "second", seconds: 3, reason: "word" }],
    startedAt: new Date("2026-11-20T00:00:00.000Z"),
    finishedAt: new Date("2026-11-20T00:10:00.000Z"),
    tokenHash: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

/** The stored cases: case 3's expected line was cut from record 42. */
function storedCases() {
  return [0, 1, 2, 3].map((index) => ({
    id: index + 1,
    contextJson: [],
    expectedJson:
      index === 3
        ? { id: 42, role: "assistant", content: "这句是真话", timestamp: null }
        : { id: 100 + index, role: "assistant", content: `别的一句${index}`, timestamp: null },
    expectedState: null,
    occurredAt: new Date(2026, 0, index + 1),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  persona.personaData = {};
  getPersonaById.mockImplementation(async (id: number, userId: number) =>
    id === 5 && userId === 1 ? persona : null,
  );
  updatePersona.mockImplementation(async (_id: number, _userId: number, data: any) => {
    Object.assign(persona, data);
    return persona;
  });
  // The expected answer is an imported record, not a chat message: the
  // snippet has to come from the pair, not a `messages` lookup.
  getMessageById.mockResolvedValue(null);
  listFidelityFeedbackForPersona.mockResolvedValue([]);
  listBlindSessions.mockResolvedValue([finishedSitting()]);
  getEvalCases.mockResolvedValue(storedCases());
});

describe("a blind-test reason in the candidate queue", () => {
  it("becomes a candidate that points at the expected answer and can be confirmed", async () => {
    const caller = appRouter.createCaller(ctxFor(1));

    const listed = await caller.fidelity.candidates({ personaId: 5 });
    expect(listed.items).toHaveLength(1);
    const item = listed.items[0]!;
    expect(item.key).toBe("word:42");
    expect(item.messageId).toBe(42);
    expect(item.reason).toBe("word");
    expect(item.kind).toBe("suppression");
    // The unlike line the reason is about: the persona's line in the pair.
    expect(item.snippet).toBe(FAKE_LINE);

    const confirmed = await caller.fidelity.confirm({ personaId: 5, key: item.key });
    expect(confirmed).toEqual({ key: "word:42", kind: "suppression" });

    const written = updatePersona.mock.calls.at(-1)?.[2] as {
      personaData: Record<string, any>;
    };
    expect(written.personaData.rejectedFeedbackKeys).toContain("word:42");
    const rule = (written.personaData.suppressions ?? [])[0];
    expect(rule?.pattern).toContain(FAKE_LINE);

    // The confirmed candidate does not come back on the next aggregation.
    const again = await caller.fidelity.candidates({ personaId: 5 });
    expect(again.items).toEqual([]);
  });

  it("still shows an unlike mark's own message as its snippet", async () => {
    listBlindSessions.mockResolvedValue([]);
    listFidelityFeedbackForPersona.mockResolvedValue([
      { id: 1, messageId: 9, reason: "word", rewrite: null },
    ]);
    getMessageById.mockResolvedValue({ id: 9, content: "你好吗", metadata: null });

    const listed = await appRouter
      .createCaller(ctxFor(1))
      .fidelity.candidates({ personaId: 5 });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.messageId).toBe(9);
    expect(listed.items[0]!.snippet).toBe("你好吗");
  });
});
