import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

/**
 * A quotation that cannot be used leaves nothing behind (C8.10).
 *
 * The route-level tests use a mocked database, so they cannot see the
 * order of the two writes: the user's message and the quotation check.
 * A rejected turn used to write the message first (with the foreign ids
 * in its metadata) and only then refuse the quotation — and the history
 * showed another persona's line under it.
 *
 * A database is required: `describe.skipIf(!process.env.DATABASE_URL)`
 * is the rule for every DB test (`server/skip-audit.test.ts` names this
 * file).
 */

const llmInvoke = vi.hoisted(() => vi.fn());
vi.mock("../llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm")>();
  return {
    ...actual,
    llmService: {
      ...actual.llmService,
      invoke: llmInvoke,
      invokeWithProvider: llmInvoke,
    },
  };
});

import {
  createCollectedMessage,
  createMessage,
  createPersona,
  createUser,
  deleteUserAccount,
  getMessagesByPersonaId,
} from "../db";
import { appRouter } from "../routers";

const DATABASE_URL = process.env.DATABASE_URL;

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      username: `quoted-db-${userId}`,
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
    res: {} as TrpcContext["res"],
  } as unknown as TrpcContext;
}

describe.skipIf(!DATABASE_URL)("a rejected quotation, in the database (C8.10)", () => {
  const users: number[] = [];

  afterEach(async () => {
    for (const id of users.splice(0)) {
      await deleteUserAccount(id).catch(() => undefined);
    }
  });

  async function seed() {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({
      username: `quoted-order-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    users.push(userId);
    const personaId = await createPersona({ userId, name: "小满", analysisStatus: "ready" });
    const otherPersonaId = await createPersona({
      userId,
      name: "另一个",
      analysisStatus: "ready",
    });
    const recordId = await createCollectedMessage({
      userId,
      personaId: otherPersonaId,
      source: "generic",
      role: "user",
      speaker: "阿树",
      content: "别的分身的话",
      timestamp: new Date("2023-05-01T12:00:00Z"),
    });
    return { userId, personaId, otherPersonaId, recordId: recordId! };
  }

  it("writes no message for a turn whose quotation is refused", async () => {
    const { userId, personaId, recordId } = await seed();
    const caller = appRouter.createCaller(ctxFor(userId));

    const refusal = await caller.chat
      .send({ personaId, message: "聊聊这个", locale: "zh", quotedRecordIds: [recordId] })
      .catch((error) => error);
    expect(refusal.code).toBe("BAD_REQUEST");

    // Nothing of the refused turn is in the transcript — not even the
    // user's message, and therefore not the foreign ids.
    expect(await getMessagesByPersonaId(personaId, userId)).toEqual([]);
    const history = await caller.chat.getHistory({ personaId });
    expect(history.filter((row: { role: string }) => row.role === "user")).toEqual([]);
    // And the model never ran.
    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it("does not show another persona's line under a message that quotes it", async () => {
    const { userId, personaId, recordId } = await seed();
    // A row written by an older build (or by a hand edit) still carries
    // the foreign id. Reading the history must not resolve it.
    await createMessage({
      personaId,
      userId,
      role: "user",
      content: "这条消息引用了别的分身的记录",
      metadata: { quotedRecordIds: [recordId] },
    });
    const caller = appRouter.createCaller(ctxFor(userId));
    const history = await caller.chat.getHistory({ personaId });
    const row = history.find((entry: { role: string }) => entry.role === "user") as
      | { quotedRecords?: Array<{ content: string }> }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.quotedRecords).toEqual([]);
  });
});
