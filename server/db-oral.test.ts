import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  acceptPersonaShare,
  createMemory,
  createOralAccount,
  createPersona,
  createPersonaShare,
  createUser,
  purgePersona,
  deleteUserAccount,
  getOralMemories,
  listOralAccounts,
  listSubmittedOralAccounts,
  supersedeMemory,
  updateOralAccount,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe.skipIf(!DATABASE_URL)("what people remember, in the database (C7.4)", () => {
  it("keeps a draft to its teller, and shows the owner only what was submitted", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({
      username: `oral-owner-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const memberId = await createUser({
      username: `oral-member-${stamp}`,
      passwordHash: "x",
      name: "琪琪",
    });
    const strangerId = await createUser({
      username: `oral-stranger-${stamp}`,
      passwordHash: "x",
      name: "路人",
    });
    const ownerPersonaId = await createPersona({
      userId: ownerId,
      name: "小满",
      analysisStatus: "ready",
    });
    const token = `oral-${stamp}`;
    await createPersonaShare({
      personaId: ownerPersonaId,
      ownerUserId: ownerId,
      status: "invited",
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    let memberPersonaId: number | null = null;

    try {
      memberPersonaId = (await acceptPersonaShare(hashToken(token), memberId))!.personaId;

      const ownerDraft = await createOralAccount({
        personaId: ownerPersonaId,
        userId: ownerId,
        tellerName: "阿树",
        body: "还没想好怎么说。",
        submittedAt: null,
      });
      const ownerSubmitted = await createOralAccount({
        personaId: ownerPersonaId,
        userId: ownerId,
        tellerName: "阿树",
        body: "他讨厌香菜。",
        submittedAt: new Date("2026-03-01T00:00:00Z"),
      });
      const memberDraft = await createOralAccount({
        personaId: ownerPersonaId,
        userId: memberId,
        tellerName: "琪琪",
        body: "他打游戏会摔鼠标，这句还没提交。",
        submittedAt: null,
      });
      const memberSubmitted = await createOralAccount({
        personaId: ownerPersonaId,
        userId: memberId,
        tellerName: "琪琪",
        body: "他怕黑。",
        submittedAt: new Date("2026-03-02T00:00:00Z"),
      });

      // The owner reads their own draft and the family's submitted
      // account; the family's draft stays private.
      const forOwner = await listOralAccounts(ownerPersonaId, ownerId);
      expect(forOwner.map((row) => row.id).sort()).toEqual(
        [ownerDraft, ownerSubmitted, memberSubmitted].sort(),
      );
      // A family member reads what they told, drafts included, and
      // nothing of the owner's other than what was submitted.
      const forMember = await listOralAccounts(ownerPersonaId, memberId);
      expect(forMember.map((row) => row.id).sort()).toEqual(
        [memberDraft, memberSubmitted].sort(),
      );
      // A stranger reading the id gets nothing at all.
      expect(await listOralAccounts(ownerPersonaId, strangerId)).toEqual([]);

      // The extraction reads the submitted accounts, and only for the
      // owner: the personas join is the ownership check.
      const submitted = await listSubmittedOralAccounts(ownerPersonaId, ownerId);
      expect(submitted.map((row) => row.id).sort()).toEqual(
        // The owner's draft is not submitted; nor is the family member's.
        [ownerSubmitted, memberSubmitted].sort(),
      );
      expect(await listSubmittedOralAccounts(ownerPersonaId, memberId)).toEqual([]);

      // Editing is scoped to the teller: the owner cannot edit the
      // family's words, and a family member cannot edit the owner's.
      expect(await updateOralAccount(memberSubmitted, ownerId, ownerPersonaId, { body: "改过。" })).toBeNull();
      expect(await updateOralAccount(ownerDraft, memberId, ownerPersonaId, { body: "改过。" })).toBeNull();
      const edited = await updateOralAccount(memberSubmitted, memberId, ownerPersonaId, {
        body: "他晚上怕黑。",
      });
      expect(edited?.body).toBe("他晚上怕黑。");

      // Oral memories are the extractor's, and they stay apart from the
      // chat's memories of the same persona.
      const fear = await createMemory({
        personaId: ownerPersonaId,
        userId: ownerId,
        title: "怕黑。",
        description: "来自 琪琪 的讲述：「他怕黑」",
        factKey: "fear_of_dark",
        source: "oral",
        subject: "them",
      });
      await createMemory({
        personaId: ownerPersonaId,
        userId: ownerId,
        title: "第一次见面",
        description: null,
        factKey: "first_meeting",
        source: "records",
        subject: "them",
      });
      // Only what people told us is the oral extractor's business; the
      // memory mined from the records stays out of it.
      expect((await getOralMemories(ownerPersonaId, ownerId)).map((row) => row.factKey))
        .toEqual(["fear_of_dark"]);

      // Two accounts disagree, and the owner picks one: the other row is
      // kept, marked superseded, and no longer counts.
      const rival = await createMemory({
        personaId: ownerPersonaId,
        userId: ownerId,
        title: "晚上不怕黑。",
        description: "来自 阿树 的讲述：「他晚上不怕黑」",
        factKey: "fear_of_dark",
        source: "oral",
        subject: "them",
      });
      await supersedeMemory({
        loserId: rival,
        winnerId: fear,
        personaId: ownerPersonaId,
        userId: ownerId,
      });
      const oral = await getOralMemories(ownerPersonaId, ownerId);
      expect(oral.map((row) => row.factKey)).toEqual(["fear_of_dark", "fear_of_dark"]);
      expect(oral.find((row) => row.id === fear)?.status).toBe("active");
      expect(oral.find((row) => row.id === rival)?.status).toBe("superseded");
      expect(await getOralMemories(ownerPersonaId, memberId)).toEqual([]);
    } finally {
      if (memberPersonaId) await deleteUserAccount(memberId);
      await deleteUserAccount(ownerId);
      await deleteUserAccount(strangerId);
    }
  });

  it("deletes every account of a persona, whoever told it", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({
      username: `oral-del-owner-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const memberId = await createUser({
      username: `oral-del-member-${stamp}`,
      passwordHash: "x",
      name: "琪琪",
    });
    const ownerPersonaId = await createPersona({
      userId: ownerId,
      name: "小满",
      analysisStatus: "ready",
    });
    try {
      await createOralAccount({
        personaId: ownerPersonaId,
        userId: ownerId,
        tellerName: "阿树",
        body: "我讲的。",
        submittedAt: new Date(),
      });
      await createOralAccount({
        personaId: ownerPersonaId,
        userId: memberId,
        tellerName: "琪琪",
        body: "家人讲的。",
        submittedAt: new Date(),
      });

      // Deleting the persona takes the family member's words with it —
      // they are about somebody who no longer has a persona here.
      await purgePersona(ownerPersonaId, ownerId);
      expect(await listOralAccounts(ownerPersonaId, ownerId)).toEqual([]);
      expect(await listSubmittedOralAccounts(ownerPersonaId, ownerId)).toEqual([]);
      expect(await getOralMemories(ownerPersonaId, ownerId)).toEqual([]);
    } finally {
      await deleteUserAccount(memberId);
      await deleteUserAccount(ownerId);
    }
  });

  it("deletes the accounts a user told on somebody else's persona", async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 10_000);
    const ownerId = await createUser({
      username: `oral-acct-owner-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const memberId = await createUser({
      username: `oral-acct-member-${stamp}`,
      passwordHash: "x",
      name: "琪琪",
    });
    const ownerPersonaId = await createPersona({
      userId: ownerId,
      name: "小满",
      analysisStatus: "ready",
    });
    try {
      await createOralAccount({
        personaId: ownerPersonaId,
        userId: memberId,
        tellerName: "琪琪",
        body: "家人讲的。",
        submittedAt: new Date(),
      });
      await deleteUserAccount(memberId);
      expect(await listSubmittedOralAccounts(ownerPersonaId, ownerId)).toEqual([]);
    } finally {
      await deleteUserAccount(ownerId);
    }
  });
});
