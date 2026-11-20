import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  acceptPersonaShare,
  countRecords,
  createCollectedMessages,
  createMemory,
  createMessage,
  createPersona,
  createPersonaShare,
  createUser,
  deletePersona,
  getActiveShareForMemberPersona,
  getMemoriesByPersonaId,
  getMessagesByPersonaId,
  getPersonaById,
  getPersonaShareByTokenHash,
  listPersonaShares,
  revokePersonaShare,
  updatePersona,
} from "./db";
import { resolveRecordScope } from "@shared/persona-sharing";
import { createPersonaFile, createOutboundLetter, getOutboundLetters } from "./db";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const llmInvoke = vi.hoisted(() => vi.fn());
vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return {
    ...actual,
    llmService: {
      ...actual.llmService,
      invoke: llmInvoke,
      invokeWithProvider: llmInvoke,
    },
  };
});

import { runConversation } from "./chat/service";

const DATABASE_URL = process.env.DATABASE_URL;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

describe.skipIf(!DATABASE_URL)("sharing a persona with family (C7.2)", () => {
  it("hydrates the member from the owner, and keeps their conversations apart", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({
      username: `share-owner-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const memberId = await createUser({
      username: `share-member-${stamp}`,
      passwordHash: "x",
      name: "小林",
    });
    const ownerPersonaId = await createPersona({
      userId: ownerId,
      name: "小满",
      personaData: { personality: "安静", speakingStyle: "短句" },
      analysisStatus: "ready",
    });
    const token = `share-${stamp}`;
    const shareId = await createPersonaShare({
      personaId: ownerPersonaId,
      ownerUserId: ownerId,
      status: "invited",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

    let memberPersonaId: number | null = null;
    try {
      const accepted = await acceptPersonaShare(hashToken(token), memberId);
      expect(accepted).not.toBeNull();
      memberPersonaId = accepted!.personaId;

      // The member sees the owner's identity, not a copy taken at accept time.
      const hydrated = await getPersonaById(memberPersonaId, memberId);
      expect(hydrated?.personaData).toEqual({ personality: "安静", speakingStyle: "短句" });
      expect((hydrated as any)?.sharedFromUserId).toBe(ownerId);
      expect(hydrated?.name).toBe("小满");

      await updatePersona(ownerPersonaId, ownerId, {
        personaData: { personality: "更安静", speakingStyle: "更短" },
      });
      const reread = await getPersonaById(memberPersonaId, memberId);
      expect(reread?.personaData).toEqual({ personality: "更安静", speakingStyle: "更短" });

      // The token is one-time, the owner cannot accept it, and the
      // database holds only the hash.
      const stored = await getPersonaShareByTokenHash(hashToken(token));
      expect(stored?.tokenHash).toBe(hashToken(token));
      expect(stored?.tokenHash).not.toBe(token);
      expect(await acceptPersonaShare(hashToken(token), memberId)).toBeNull();
      expect(await acceptPersonaShare(hashToken(token), ownerId)).toBeNull();

      // The owner's records are what the member's turns read.
      await createCollectedMessages([
        {
          userId: ownerId,
          personaId: ownerPersonaId,
          source: "generic",
          role: "assistant",
          content: "在的呀",
          timestamp: new Date("2022-03-01T12:00:00Z"),
          kind: "text",
        },
        {
          userId: ownerId,
          personaId: ownerPersonaId,
          source: "generic",
          role: "user",
          content: "在吗",
          timestamp: new Date("2022-03-01T12:00:01Z"),
          kind: "text",
        },
      ]);
      const scope = resolveRecordScope(reread as any);
      expect(scope).toEqual({ personaId: ownerPersonaId, userId: ownerId });
      expect(await countRecords(scope.personaId, scope.userId)).toBe(2);
      expect(await countRecords(memberPersonaId, memberId)).toBe(0);

      // The member's own conversation stays on their row and their user id.
      await createMessage({
        userId: memberId,
        personaId: memberPersonaId,
        role: "user",
        content: "这是家人的话",
        channel: "web",
      });
      expect(await getMessagesByPersonaId(memberPersonaId, ownerId)).toHaveLength(0);
      expect(await getMessagesByPersonaId(memberPersonaId, memberId)).toHaveLength(1);
      await createMemory({
        userId: memberId,
        personaId: memberPersonaId,
        title: "家人的记忆",
        category: "memory",
        subject: "them",
      });
      expect(await getMemoriesByPersonaId(memberPersonaId, ownerId)).toHaveLength(0);
      expect(await getMemoriesByPersonaId(memberPersonaId, memberId)).toHaveLength(1);

      // The member chats one turn: the personas' own words are read from
      // the owner's records, and the new messages belong to the member.
      const captured: any[] = [];
      llmInvoke.mockImplementation(async (_provider: unknown, params: any) => {
        captured.push(params);
        return "在的呀";
      });
      const events: any[] = [];
      for await (const event of runConversation({
        persona: reread!,
        userId: memberId,
        message: "在吗",
        mode: "once",
      })) {
        events.push(event);
      }
      expect(events.some((event) => event.type === "error")).toBe(false);
      const promptText = JSON.stringify(captured);
      expect(promptText).toContain("在的呀");
      const memberMessages = await getMessagesByPersonaId(memberPersonaId, memberId);
      expect(memberMessages.length).toBeGreaterThanOrEqual(2);
      expect(memberMessages.every((row) => row.userId === memberId)).toBe(true);

      // The member may read the persona, not the record or the rules.
      const memberCaller = appRouter.createCaller(ctxFor(memberId));
      await expect(
        memberCaller.record.page({ personaId: memberPersonaId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        memberCaller.record.search({ personaId: memberPersonaId, q: "在吗" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        memberCaller.persona.update({ id: memberPersonaId, name: "改个名字" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const fileId = await createPersonaFile({
        personaId: memberPersonaId,
        userId: memberId,
        fileType: "chat_txt",
        originalName: "x.txt",
        fileKey: `personas/${memberId}/${memberPersonaId}/x.txt`,
        fileUrl: "/uploads/x.txt",
        fileSize: 3,
      });
      await expect(
        memberCaller.import.confirm({
          fileId,
          format: "wechat-txt-2line",
          me: ["我"],
          them: ["TA"],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The member's letters and the owner's are separate ledgers.
      await createOutboundLetter({
        userId: memberId,
        personaId: memberPersonaId,
        text: "家人的话",
        status: "ready",
      });
      expect(await getOutboundLetters(memberPersonaId, ownerId)).toHaveLength(0);
      expect(await getOutboundLetters(memberPersonaId, memberId)).toHaveLength(1);

      // Revoking closes the chat, not the history.
      expect(await revokePersonaShare(shareId, ownerId)).toBe(true);
      expect(await getActiveShareForMemberPersona(memberPersonaId, memberId)).toBeUndefined();
      expect((await getMessagesByPersonaId(memberPersonaId, memberId)).length)
        .toBeGreaterThanOrEqual(2);

      // Deleting the owner's persona leaves the member's row.
      await deletePersona(ownerPersonaId, ownerId);
      expect(await listPersonaShares(ownerPersonaId, ownerId)).toHaveLength(0);
      expect(await getPersonaById(memberPersonaId, memberId)).toBeTruthy();
    } finally {
      if (memberPersonaId) await deletePersona(memberPersonaId, memberId).catch(() => undefined);
      await deletePersona(ownerPersonaId, ownerId).catch(() => undefined);
    }
  });
});
