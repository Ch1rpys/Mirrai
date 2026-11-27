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
  purgePersona,
  restorePersona,
  softDeletePersona,
  getActiveShareForMemberPersona,
  getMemoriesByPersonaId,
  getAllPersonasForReminders,
  getMessagesByPersonaId,
  getPersonaById,
  getPersonasByUserId,
  getPersonaShareByTokenHash,
  isPersonaSharedWithMember,
  listJournalEntries,
  createJournalEntry,
  listPersonaShares,
  revokePersonaShare,
  setPersonaSettings,
  updatePersona,
  upsertMedia,
} from "./db";
import { resolveRecordScope } from "@shared/persona-sharing";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { isMemorial } from "@shared/persona-state";
import { createPersonaFile, createOutboundLetter, getOutboundLetters } from "./db";
import { sharedPersonaFileBelongsToUser } from "./_core/uploads";
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

      /**
       * The owner's persona-level state reaches the member (C7.2).
       *
       * A seal, a taper step or a memorial mode is the owner's decision
       * about the shared persona. The member's row stores their own
       * switches, but not these.
       */
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({
        seal: { until: "2099-01-01", earlyOpen: "never" },
      }));
      const sealedForMember = await getPersonaById(memberPersonaId, memberId);
      expect(normalizePersonaSettings(sealedForMember?.settings).seal?.until).toBe("2099-01-01");
      await expect(
        memberCaller.chat.getHistory({ personaId: memberPersonaId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        memberCaller.letter.list({ personaId: memberPersonaId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({}));

      // A step down to letters-only reaches the member's conversation.
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({ taper: { stage: 3 } }));
      const tapered = await getPersonaById(memberPersonaId, memberId);
      let closed = "";
      try {
        for await (const _event of runConversation({
          persona: tapered!,
          userId: memberId,
          message: "在吗",
          mode: "once",
        })) {
          // Drain the generator; it must refuse before it writes.
        }
      } catch (error) {
        closed = (error as Error).message;
      }
      expect(closed).toContain("只写信");
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({}));

      // The memorial register is the owner's too.
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({ mode: "memorial" }));
      expect(isMemorial(await getPersonaById(memberPersonaId, memberId))).toBe(true);
      await setPersonaSettings(ownerPersonaId, ownerId, normalizePersonaSettings({}));

      // Rebuilding the persona and importing into it stay the owner's.
      await expect(
        memberCaller.persona.triggerAnalysis({ id: memberPersonaId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        memberCaller.skillEngine.startPipeline({ personaId: memberPersonaId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        memberCaller.file.upload({
          personaId: memberPersonaId,
          fileName: "chat.txt",
          fileType: "chat_txt",
          fileSize: 4,
          fileContent: Buffer.from("abcd").toString("base64"),
          mimeType: "text/plain",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The member hears the owner's real recordings (C7.2 + C7.3).
      await upsertMedia({
        userId: ownerId,
        personaId: ownerPersonaId,
        kind: "voice",
        fileKey: `personas/${ownerId}/${ownerPersonaId}/a.ogg`,
        hash: "v".repeat(64),
        durationSec: 12,
        fromThem: true,
        transcript: "刚下课",
      });
      const soundtrack = await memberCaller.media.listVoices({ personaId: memberPersonaId });
      expect(soundtrack.voices.map((row) => row.transcript)).toEqual(["刚下课"]);
      expect(await isPersonaSharedWithMember(ownerId, ownerPersonaId, memberId)).toBe(true);
      // The uploads guard answers the same way the soundtrack page does.
      expect(await sharedPersonaFileBelongsToUser(
        `personas/${ownerId}/${ownerPersonaId}/a.ogg`,
        memberId,
      )).toBe(true);

      // Reminders belong to the relationship the owner has, not to the
      // member's copy of the persona row.
      const reminderRows = await getAllPersonasForReminders();
      expect(reminderRows.some((row) => row.id === memberPersonaId)).toBe(false);
      expect(reminderRows.some((row) => row.id === ownerPersonaId)).toBe(true);

      // The isolation matrix runs both ways, and the diary is on it.
      await createJournalEntry({
        userId: ownerId,
        personaId: ownerPersonaId,
        body: "主人的日记",
        entryDate: "2026-03-01",
      });
      await createJournalEntry({
        userId: memberId,
        personaId: memberPersonaId,
        body: "家人的日记",
        entryDate: "2026-03-01",
      });
      const ownerJournal = await listJournalEntries({ userId: ownerId, personaId: ownerPersonaId });
      const memberJournal = await listJournalEntries({ userId: memberId, personaId: memberPersonaId });
      expect(ownerJournal.map((row) => row.body)).toEqual(["主人的日记"]);
      expect(memberJournal.map((row) => row.body)).toEqual(["家人的日记"]);
      expect(await getMessagesByPersonaId(ownerPersonaId, memberId)).toHaveLength(0);
      expect(await getMemoriesByPersonaId(ownerPersonaId, memberId)).toHaveLength(0);
      expect(await getOutboundLetters(ownerPersonaId, memberId)).toHaveLength(0);

      // Revoking closes the chat, not the history.
      expect(await revokePersonaShare(shareId, ownerId)).toBe(true);
      expect(await getActiveShareForMemberPersona(memberPersonaId, memberId)).toBeUndefined();
      expect(await isPersonaSharedWithMember(ownerId, ownerPersonaId, memberId)).toBe(false);
      expect(await sharedPersonaFileBelongsToUser(
        `personas/${ownerId}/${ownerPersonaId}/a.ogg`,
        memberId,
      )).toBe(false);
      expect((await getMessagesByPersonaId(memberPersonaId, memberId)).length)
        .toBeGreaterThanOrEqual(2);

      // Deleting the owner's persona leaves the member's row.
      await purgePersona(ownerPersonaId, ownerId);
      expect(await listPersonaShares(ownerPersonaId, ownerId)).toHaveLength(0);
      expect(await getPersonaById(memberPersonaId, memberId)).toBeTruthy();
    } finally {
      if (memberPersonaId) await purgePersona(memberPersonaId, memberId).catch(() => undefined);
      await purgePersona(ownerPersonaId, ownerId).catch(() => undefined);
    }
  });
});

describe.skipIf(!DATABASE_URL)("an invitation's expiry (C7.2)", () => {
  it("cannot be accepted once its day has passed", async () => {
    // The preview refuses an expired token; accepting through the other
    // entry point has to refuse it too.
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({ username: `share-exp-owner-${stamp}`, passwordHash: "x", name: "主人" });
    const memberId = await createUser({ username: `share-exp-member-${stamp}`, passwordHash: "x", name: "家人" });
    const ownerPersonaId = await createPersona({ userId: ownerId, name: "小满", analysisStatus: "ready" });
    try {
      const token = `token-exp-${stamp}`;
      await createPersonaShare({
        ownerUserId: ownerId,
        personaId: ownerPersonaId,
        tokenHash: hashToken(token),
        status: "invited",
        expiresAt: new Date(Date.now() - 60_000),
      } as never);
      await expect(acceptPersonaShare(hashToken(token), memberId)).resolves.toBeNull();
      // The owner still holds the persona; no half-accepted row was made.
      expect(await getPersonasByUserId(memberId)).toEqual([]);
    } finally {
      await purgePersona(ownerPersonaId, ownerId).catch(() => undefined);
    }
  });
});

describe.skipIf(!DATABASE_URL)("a shared persona's owner deletes it", () => {
  it("closes the member's door while the persona is in the bin, and reopens it on undo", async () => {
    const stamp = Date.now();
    const ownerId = await createUser({ username: `share-del-owner-${stamp}`, passwordHash: "x", name: "主人" });
    const memberId = await createUser({ username: `share-del-member-${stamp}`, passwordHash: "x", name: "家人" });
    const ownerPersonaId = await createPersona({ userId: ownerId, name: "小满", analysisStatus: "ready" });
    let memberPersonaId: number | undefined;
    try {
      const token = `token-${stamp}`;
      await createPersonaShare({
        ownerUserId: ownerId,
        personaId: ownerPersonaId,
        tokenHash: hashToken(token),
        status: "invited",
        expiresAt: new Date(Date.now() + 86_400_000),
      } as never);
      const accepted = await acceptPersonaShare(hashToken(token), memberId);
      expect(accepted).toBeTruthy();
      memberPersonaId = accepted!.personaId;

      // Before the delete the door is open.
      expect(await getActiveShareForMemberPersona(memberPersonaId, memberId)).toBeTruthy();
      expect(await isPersonaSharedWithMember(ownerId, ownerPersonaId, memberId)).toBe(true);

      // Soft delete: the member's row stays, the chat does not.
      expect(await softDeletePersona(ownerPersonaId, ownerId)).toBe(true);
      expect(await getActiveShareForMemberPersona(memberPersonaId, memberId)).toBeUndefined();
      expect(await isPersonaSharedWithMember(ownerId, ownerPersonaId, memberId)).toBe(false);
      expect(await getPersonaById(memberPersonaId, memberId)).toBeTruthy();

      // The undo brings the conversation — and the door — back.
      expect(await restorePersona(ownerPersonaId, ownerId)).toBe(true);
      expect(await getActiveShareForMemberPersona(memberPersonaId, memberId)).toBeTruthy();
    } finally {
      if (memberPersonaId) await purgePersona(memberPersonaId, memberId).catch(() => undefined);
      await purgePersona(ownerPersonaId, ownerId).catch(() => undefined);
    }
  });
});

describe.skipIf(!DATABASE_URL)("a member's own row after the share ends (C7.2)", () => {
  it("is theirs to delete once the owner has stopped sharing", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({ username: `share-del2-owner-${stamp}`, passwordHash: "x", name: "主人" });
    const memberId = await createUser({ username: `share-del2-member-${stamp}`, passwordHash: "x", name: "家人" });
    const ownerPersonaId = await createPersona({ userId: ownerId, name: "小满", analysisStatus: "ready" });
    let memberPersonaId: number | undefined;
    try {
      const token = `token-del2-${stamp}`;
      await createPersonaShare({
        ownerUserId: ownerId,
        personaId: ownerPersonaId,
        tokenHash: hashToken(token),
        status: "invited",
        expiresAt: new Date(Date.now() + 86_400_000),
      } as never);
      const accepted = await acceptPersonaShare(hashToken(token), memberId);
      expect(accepted).toBeTruthy();
      memberPersonaId = accepted!.personaId;

      // While the share is active the member leaves; they do not delete.
      const memberCaller = appRouter.createCaller(ctxFor(memberId));
      await expect(
        memberCaller.persona.delete({ id: memberPersonaId! }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // The owner stops sharing. The member's row, and the conversations
      // in it, are theirs — the promise is that they can export or
      // delete it.
      const share = await listPersonaShares(ownerPersonaId, ownerId);
      expect(await revokePersonaShare(share[0]!.id, ownerId)).toBe(true);
      await expect(
        memberCaller.persona.delete({ id: memberPersonaId! }),
      ).resolves.toEqual({ success: true });
      expect(await getPersonaById(memberPersonaId!, memberId)).toBeFalsy();
    } finally {
      if (memberPersonaId) await purgePersona(memberPersonaId, memberId).catch(() => undefined);
      await purgePersona(ownerPersonaId, ownerId).catch(() => undefined);
    }
  }, 30_000);
});
