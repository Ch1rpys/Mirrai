import { describe, expect, it } from "vitest";
import {
  answerLetter,
  countUnopenedCapsules,
  countUnreadAutoRepliesByPersona,
  countUnreadLetters,
  createLetter,
  createMessage,
  createPersona,
  createScheduledItem,
  createUser,
  getPersonasByUserId,
  listInboxLetters,
  listInboxScheduled,
  markLetterRead,
  markPersonaRead,
  markScheduledOpened,
} from "./db";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * The mailbox's counting rules, against a real database (C8.2).
 *
 * The router tests use mocks, so they prove the grouping; these prove
 * the queries — in particular that a proactive message and a follow-up
 * do not raise the unread number while a deferred reply and the answer
 * to a scheduled message do, and that a reply that arrived before the
 * conversation was last open does not.
 */
describe.skipIf(!DATABASE_URL)("the mailbox, in the database (C8.2)", () => {
  async function setup() {
    const stamp = Date.now() + Math.floor(Math.random() * 100_000);
    const userId = await createUser({
      username: `mailbox-${stamp}`,
      passwordHash: "x",
      name: "阿树",
    });
    const otherId = await createUser({
      username: `mailbox-other-${stamp}`,
      passwordHash: "x",
      name: "路人",
    });
    const personaId = await createPersona({
      userId,
      name: "小满",
      analysisStatus: "ready",
    });
    const otherPersonaId = await createPersona({
      userId: otherId,
      name: "别人的分身",
      analysisStatus: "ready",
    });
    return { userId, otherId, personaId, otherPersonaId };
  }

  it("counts only the things the user is waiting on", async () => {
    const { userId, personaId } = await setup();

    // Nothing read yet.
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "我先去睡了",
      origin: "proactive",
    });
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "人呢",
      origin: "followup",
    });
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "刚看到，我回来了",
      metadata: { deferred: { jobId: 7, reason: "delay" } },
    });
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "你定的那条，我看到了",
      metadata: { scheduled: true },
    });

    const personas = [{ id: personaId, lastReadAt: null }];
    expect(await countUnreadAutoRepliesByPersona(userId, personas)).toEqual({
      [personaId]: 2,
    });

    // The user opens the conversation: both are read.
    expect(await markPersonaRead(personaId, userId)).toBe(true);
    const stored = await getPersonasByUserId(userId);
    const afterRead = [{ id: personaId, lastReadAt: stored[0]!.lastReadAt }];
    expect(await countUnreadAutoRepliesByPersona(userId, afterRead)).toEqual({});

    // Something arrives after that: unread again.
    await createMessage({
      personaId,
      userId,
      role: "assistant",
      content: "回你了",
      metadata: { deferred: { jobId: 8, reason: "busy" } },
    });
    expect(await countUnreadAutoRepliesByPersona(userId, afterRead)).toEqual({
      [personaId]: 1,
    });

    // The user's own messages never count.
    await createMessage({ personaId, userId, role: "user", content: "在吗" });
    expect(await countUnreadAutoRepliesByPersona(userId, afterRead)).toEqual({
      [personaId]: 1,
    });
  });

  it("counts an answered letter until it is read, and only for its owner", async () => {
    const { userId, otherId, personaId, otherPersonaId } = await setup();
    const letter = await createLetter({
      userId,
      personaId,
      body: "有些话只能写下来。",
      status: "waiting",
      replyAt: new Date(),
    });
    await answerLetter(letter.id, userId, "我看到了。", new Date());

    expect(await countUnreadLetters(userId, [personaId])).toBe(1);
    expect(await countUnreadLetters(otherId, [personaId])).toBe(0);
    // A persona outside the list is not counted — that is how the
    // router leaves sealed personas out.
    expect(await countUnreadLetters(userId, [])).toBe(0);

    // Another user cannot mark it read.
    expect(await markLetterRead(letter.id, otherId)).toBe(false);
    expect(await countUnreadLetters(userId, [personaId])).toBe(1);

    expect(await markLetterRead(letter.id, userId)).toBe(true);
    expect(await countUnreadLetters(userId, [personaId])).toBe(0);

    // The same helper also lists the letters with the persona name.
    const rows = await listInboxLetters(userId, [personaId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personaName).toBe("小满");
    expect(rows[0]?.replyText).toBe("我看到了。");
    expect(await listInboxLetters(otherId, [otherPersonaId])).toEqual([]);
  });

  it("counts a due capsule until it is opened", async () => {
    const { userId, personaId } = await setup();
    const due = new Date(Date.now() - 60_000);
    const capsule = await createScheduledItem({
      userId,
      personaId,
      kind: "capsule",
      body: "给一年后的你",
      dueAt: due,
      status: "delivered",
    });
    // A capsule that has not come due does not count.
    await createScheduledItem({
      userId,
      personaId,
      kind: "capsule",
      body: "还早",
      dueAt: new Date(Date.now() + 86_400_000),
      status: "scheduled",
    });

    expect(await countUnopenedCapsules(userId, [personaId], new Date())).toBe(1);
    const rows = await listInboxScheduled(userId, [personaId]);
    expect(rows.some((row) => row.id === capsule.id)).toBe(true);

    expect(await markScheduledOpened(capsule.id, userId)).toBe(true);
    expect(await countUnopenedCapsules(userId, [personaId], new Date())).toBe(0);
  });
});
