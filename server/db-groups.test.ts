/**
 * Group chat in a real database (C9.8).
 *
 * Rooms, members and lines are all keyed by the owner, and deleting a
 * room, a persona or the account has to take the right rows with it.
 * These are the database halves of the acceptance; the rules are tested
 * with doubles elsewhere.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as db from "./db";

const DATABASE_URL = process.env.DATABASE_URL;
const suffix = Math.floor(Math.random() * 1_000_000);

describe.skipIf(!DATABASE_URL)("group chat in postgres", () => {
  let userId = 0;
  let otherUserId = 0;
  let personaId = 0;
  let secondPersonaId = 0;
  let otherPersonaId = 0;

  beforeAll(async () => {
    userId = await db.createUser({
      username: `group-user-${suffix}`,
      passwordHash: "x",
      name: "阿树",
    });
    otherUserId = await db.createUser({
      username: `group-other-${suffix}`,
      passwordHash: "x",
      name: "别人",
    });
    personaId = await db.createPersona({
      userId,
      name: "小满",
      analysisStatus: "ready",
    } as never);
    secondPersonaId = await db.createPersona({
      userId,
      name: "阿凯",
      analysisStatus: "ready",
    } as never);
    otherPersonaId = await db.createPersona({
      userId: otherUserId,
      name: "别人的分身",
      analysisStatus: "ready",
    } as never);
  });

  afterAll(async () => {
    await db.deleteUserAccount(userId);
    await db.deleteUserAccount(otherUserId);
  });

  it("keeps one account's rooms, members and lines away from another", async () => {
    const room = await db.createGroupRoom(userId, "我们的群");
    expect(room).not.toBeNull();
    await db.addGroupRoomMember(room!.id, userId, personaId);
    await db.addGroupRoomMember(room!.id, userId, secondPersonaId);
    const message = await db.createGroupMessage({
      roomId: room!.id,
      userId,
      role: "user",
      content: "在吗",
    });
    expect(message).not.toBeNull();

    expect(await db.listGroupRooms(otherUserId)).toEqual([]);
    expect(await db.getGroupRoom(room!.id, otherUserId)).toBeNull();
    expect(await db.listGroupRoomMembers(room!.id, otherUserId)).toEqual([]);
    expect(await db.listGroupMessages(room!.id, otherUserId)).toEqual([]);
    expect(await db.renameGroupRoom(room!.id, otherUserId, "改掉")).toBe(false);
    expect(await db.deleteGroupRoom(room!.id, otherUserId)).toBe(false);
    expect(await db.removeGroupRoomMember(room!.id, otherUserId, personaId)).toBe(false);

    expect((await db.listGroupRooms(userId)).map((row) => row.id)).toEqual([room!.id]);
    expect((await db.listGroupRoomMembers(room!.id, userId)).map((row) => row.personaId)).toEqual([
      personaId,
      secondPersonaId,
    ]);
    expect((await db.listGroupMessages(room!.id, userId)).map((row) => row.content)).toEqual([
      "在吗",
    ]);
  });

  it("adds a persona once and refuses a duplicate", async () => {
    const room = await db.createGroupRoom(userId, "去重");
    expect(await db.addGroupRoomMember(room!.id, userId, personaId)).toBe(true);
    expect(await db.addGroupRoomMember(room!.id, userId, personaId)).toBe(false);
    expect(await db.countGroupRoomMembers(room!.id, userId)).toBe(1);
    await db.deleteGroupRoom(room!.id, userId);
  });

  it("pages the room's lines by id, oldest to newest", async () => {
    const room = await db.createGroupRoom(userId, "分页");
    for (const text of ["一", "二", "三"]) {
      await db.createGroupMessage({ roomId: room!.id, userId, role: "user", content: text });
    }
    const newest = await db.listGroupMessages(room!.id, userId, { limit: 2 });
    expect(newest.map((row) => row.content)).toEqual(["三", "二"]);
    const older = await db.listGroupMessages(room!.id, userId, {
      limit: 2,
      beforeId: newest[newest.length - 1]!.id,
    });
    expect(older.map((row) => row.content)).toEqual(["一"]);
    await db.deleteGroupRoom(room!.id, userId);
    expect(await db.listGroupMessages(room!.id, userId)).toEqual([]);
  });

  it("takes a persona's memberships and lines with it and leaves the room", async () => {
    const room = await db.createGroupRoom(userId, "删分身");
    await db.addGroupRoomMember(room!.id, userId, personaId);
    await db.addGroupRoomMember(room!.id, userId, secondPersonaId);
    await db.createGroupMessage({
      roomId: room!.id,
      userId,
      role: "assistant",
      personaId: personaId,
      content: "我说的",
    });
    await db.createGroupMessage({
      roomId: room!.id,
      userId,
      role: "assistant",
      personaId: secondPersonaId,
      content: "另一个人说的",
    });
    await db.purgePersona(personaId, userId);
    const members = await db.listGroupRoomMembers(room!.id, userId);
    expect(members.map((row) => row.personaId)).toEqual([secondPersonaId]);
    const lines = await db.listGroupMessages(room!.id, userId);
    expect(lines.map((row) => row.content)).toEqual(["另一个人说的"]);
    expect(await db.getGroupRoom(room!.id, userId)).not.toBeNull();
    await db.deleteGroupRoom(room!.id, userId);
  });

  it("takes the rooms, members and lines with the account", async () => {
    const room = await db.createGroupRoom(otherUserId, "删账号");
    await db.addGroupRoomMember(room!.id, otherUserId, otherPersonaId);
    await db.createGroupMessage({
      roomId: room!.id,
      userId: otherUserId,
      role: "user",
      content: "还在",
    });
    await db.deleteUserAccount(otherUserId);
    expect(await db.listGroupRooms(otherUserId)).toEqual([]);
    expect(await db.listGroupRoomMembers(room!.id, otherUserId)).toEqual([]);
    expect(await db.listGroupMessages(room!.id, otherUserId)).toEqual([]);
  });

  it("stores and merges the feature flags on the user row", async () => {
    expect(await db.getUserFeatures(userId)).toEqual({ groupChat: false });
    expect(await db.setUserFeatures(userId, { groupChat: true })).toEqual({ groupChat: true });
    expect(await db.getUserFeatures(userId)).toEqual({ groupChat: true });
    expect(await db.setUserFeatures(userId, {})).toEqual({ groupChat: true });
    expect(await db.setUserFeatures(userId, { groupChat: false })).toEqual({ groupChat: false });
  });
});
