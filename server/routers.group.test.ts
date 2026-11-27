/**
 * The group-chat routes (C9.8).
 *
 * What matters most here is what does NOT happen: a group round never
 * touches the pair's messages, memories, mood, intimacy or chat count,
 * and nothing is ever called twice for one user line. The persona lines
 * themselves are mocked — `server/group/reply.test.ts` covers the prompt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeatures = vi.fn();
const getRoom = vi.fn();
const createRoom = vi.fn();
const deleteRoom = vi.fn();
const renameRoom = vi.fn();
const listRooms = vi.fn();
const listMembers = vi.fn();
const countMembers = vi.fn();
const addMember = vi.fn();
const removeMember = vi.fn();
const listMessages = vi.fn();
const lastMessage = vi.fn();
const createMessage = vi.fn();
const getPersonas = vi.fn();
const getPersona = vi.fn();
const composeReply = vi.fn();

vi.mock("./db", () => ({
  getUserFeatures: (...a: unknown[]) => getFeatures(...a),
  getGroupRoom: (...a: unknown[]) => getRoom(...a),
  createGroupRoom: (...a: unknown[]) => createRoom(...a),
  deleteGroupRoom: (...a: unknown[]) => deleteRoom(...a),
  renameGroupRoom: (...a: unknown[]) => renameRoom(...a),
  listGroupRooms: (...a: unknown[]) => listRooms(...a),
  listGroupRoomMembers: (...a: unknown[]) => listMembers(...a),
  countGroupRoomMembers: (...a: unknown[]) => countMembers(...a),
  addGroupRoomMember: (...a: unknown[]) => addMember(...a),
  removeGroupRoomMember: (...a: unknown[]) => removeMember(...a),
  listGroupMessages: (...a: unknown[]) => listMessages(...a),
  getLastGroupMessage: (...a: unknown[]) => lastMessage(...a),
  createGroupMessage: (...a: unknown[]) => createMessage(...a),
  getPersonasByUserId: (...a: unknown[]) => getPersonas(...a),
  getPersonaById: (...a: unknown[]) => getPersona(...a),
  // The pair's own write path; the group routes must never reach it.
  createMessage: vi.fn(),
  createMemory: vi.fn(),
  updatePersona: vi.fn(),
  incrementChatCount: vi.fn(),
}));

vi.mock("./group/reply", () => ({
  composeGroupReply: (...a: unknown[]) => composeReply(...a),
  groupLengthCap: () => 13,
  includesMemorial: () => false,
}));

import { groupRouter } from "./routers-v6/group";

const ctx = {
  user: { id: 7, name: "阿树", username: "ashu", timezone: "Asia/Shanghai" },
  locale: "zh",
} as any;

function caller() {
  return groupRouter.createCaller(ctx);
}

function personaRow(id: number, name: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    userId: 7,
    name,
    avatarUrl: null,
    analysisStatus: "ready",
    presence: "active",
    graduationStatus: null,
    timezone: "Asia/Shanghai",
    settings: {},
    styleProfile:
      extras.group === false
        ? null
        : {
            version: 1,
            measuredAt: "2024-01-01T00:00:00.000Z",
            recordsVersion: "100:100",
            group: {
              samples: 120,
              afterMeRate: 0.6,
              afterOthersRate: 0.2,
              lengthMedian: 5,
              gapMedianMessages: 5,
            },
          },
    ...extras,
  };
}

const memberRows = [
  { id: 11, roomId: 3, userId: 7, personaId: 1, joinedAt: new Date("2024-05-01T20:00:00Z") },
  { id: 12, roomId: 3, userId: 7, personaId: 2, joinedAt: new Date("2024-05-01T20:01:00Z") },
];
const personas = [personaRow(1, "小满"), personaRow(2, "阿凯")];

const room = { id: 3, userId: 7, name: "我们的群", createdAt: new Date("2024-05-01T19:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  getFeatures.mockResolvedValue({ groupChat: true });
  getRoom.mockResolvedValue(room);
  listRooms.mockResolvedValue([room]);
  listMembers.mockResolvedValue(memberRows);
  countMembers.mockResolvedValue(2);
  getPersonas.mockResolvedValue(personas);
  getPersona.mockImplementation(async (id: number) => personas.find((row) => row.id === id) ?? null);
  lastMessage.mockResolvedValue(null);
  listMessages.mockResolvedValue([]);
  let nextId = 100;
  createMessage.mockImplementation(async (input: Record<string, unknown>) => ({
    id: nextId++,
    roomId: input.roomId,
    userId: input.userId,
    role: input.role,
    personaId: input.personaId ?? null,
    content: input.content,
    metadata: input.metadata ?? null,
    createdAt: new Date(),
  }));
  createRoom.mockResolvedValue(room);
  deleteRoom.mockResolvedValue(true);
  addMember.mockResolvedValue(true);
  composeReply.mockResolvedValue("在的呀");
});

describe("the feature switch", () => {
  it("refuses every route when the user has not turned group chat on", async () => {
    getFeatures.mockResolvedValue({ groupChat: false });
    const api = caller();
    await expect(api.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.create({ name: "群", personaIds: [1, 2] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.rename({ roomId: 3, name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.delete({ roomId: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.addMember({ roomId: 3, personaId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.removeMember({ roomId: 3, personaId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.history({ roomId: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.send({ roomId: 3, text: "在吗" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(composeReply).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });
});

describe("listing rooms", () => {
  it("returns the rooms with their members and whether each was measured", async () => {
    getPersonas.mockResolvedValue([personaRow(1, "小满"), personaRow(2, "阿凯", { group: false })]);
    const result = await caller().list();
    expect(result.rooms).toHaveLength(1);
    const roomView = result.rooms[0]!;
    expect(roomView.id).toBe(3);
    expect(roomView.name).toBe("我们的群");
    expect(roomView.members.map((row) => row.personaId)).toEqual([1, 2]);
    expect(roomView.members[0]!.hasGroupData).toBe(true);
    expect(roomView.members[1]!.hasGroupData).toBe(false);
    expect(roomView.lastMessage).toBeNull();
  });
});

describe("creating a room", () => {
  it("needs two to five personas", async () => {
    await expect(caller().create({ name: "群", personaIds: [1] })).rejects.toThrow();
    await expect(
      caller().create({ name: "群", personaIds: [1, 2, 3, 4, 5, 6] }),
    ).rejects.toThrow();
  });

  it("creates the room and adds each persona", async () => {
    const result = await caller().create({ name: "  我们的群  ", personaIds: [1, 2] });
    expect(result).toEqual({ id: 3 });
    expect(createRoom).toHaveBeenCalledWith(7, "我们的群");
    expect(addMember).toHaveBeenCalledWith(3, 7, 1);
    expect(addMember).toHaveBeenCalledWith(3, 7, 2);
  });

  it("refuses somebody else's persona", async () => {
    getPersona.mockResolvedValue(null);
    await expect(caller().create({ name: "群", personaIds: [9, 2] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("refuses an asleep persona", async () => {
    getPersona.mockImplementation(async (id: number) =>
      id === 2
        ? personaRow(2, "阿凯", { graduationStatus: "graduated" })
        : personaRow(1, "小满"),
    );
    await expect(caller().create({ name: "群", personaIds: [1, 2] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("refuses a persona whose other person said no (C10.3)", async () => {
    getPersona.mockImplementation(async (id: number) =>
      id === 2
        ? personaRow(2, "阿凯", { settings: { consent: "asked_no" } })
        : personaRow(1, "小满"),
    );
    await expect(caller().create({ name: "群", personaIds: [1, 2] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("refuses a sealed persona", async () => {
    getPersona.mockImplementation(async (id: number) =>
      id === 2
        ? personaRow(2, "阿凯", { settings: { seal: { until: "2099-01-01", earlyOpen: "never" } } })
        : personaRow(1, "小满"),
    );
    await expect(caller().create({ name: "群", personaIds: [1, 2] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("leaves no half-made room when a member cannot be added", async () => {
    addMember.mockRejectedValueOnce(new Error("boom"));
    await expect(caller().create({ name: "群", personaIds: [1, 2] })).rejects.toThrow("boom");
    expect(deleteRoom).toHaveBeenCalledWith(3, 7);
  });
});

describe("sending one line", () => {
  it("answers with as many lines as the rules chose, and stores both sides", async () => {
    const result = await caller().send({ roomId: 3, text: "今天好累" });
    expect(result.crisis).toBeNull();
    expect(result.userMessage.content).toBe("今天好累");
    // One generation per persona that was chosen to answer. `composeReply`
    // is the shape of that one generation; the provider is called inside
    // it exactly once (`server/group/reply.test.ts` pins mode/rerank).
    expect(composeReply.mock.calls.length).toBe(result.replies.length);
    expect(result.replies.length).toBeGreaterThan(0);
    expect(result.replies.length).toBeLessThanOrEqual(2);
    for (const reply of result.replies) {
      expect(reply.content).toBe("在的呀");
      expect(reply.personaId).toBeGreaterThan(0);
    }
    // The user line and each persona line, all in the room only.
    expect(createMessage).toHaveBeenCalledTimes(1 + result.replies.length);
  });

  it("does not answer again until the user writes again", async () => {
    await caller().send({ roomId: 3, text: "今天好累" });
    const afterFirst = composeReply.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(composeReply.mock.calls.length).toBe(afterFirst);
    await caller().send({ roomId: 3, text: "睡了吗" });
    expect(composeReply.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("gives a crisis line no persona answer and no model call", async () => {
    const result = await caller().send({ roomId: 3, text: "我想死" });
    expect(result.crisis).not.toBeNull();
    expect(result.crisis!.text).toContain("12356");
    expect(result.replies).toEqual([]);
    expect(composeReply).not.toHaveBeenCalled();
  });

  it("answers a called persona even when it was not measured", async () => {
    getPersonas.mockResolvedValue([personaRow(1, "小满", { group: false }), personaRow(2, "阿凯")]);
    composeReply.mockResolvedValue("我在");
    const result = await caller().send({ roomId: 3, text: "@小满 在吗" });
    expect(result.replies.map((row) => row.personaId)).toEqual([1]);
  });

  it("mutes a member whose other person said no (C10.3)", async () => {
    getPersonas.mockResolvedValue([
      personaRow(1, "小满"),
      personaRow(2, "阿凯", { settings: { consent: "asked_no" } }),
    ]);
    composeReply.mockResolvedValue("我在");
    const result = await caller().send({ roomId: 3, text: "@小满 @阿凯 在吗" });
    expect(result.replies.map((row) => row.personaId)).toEqual([1]);
    expect(composeReply).toHaveBeenCalledTimes(1);
  });

  it("mutes a member who can no longer join the room", async () => {
    // Sleeping, sealed and not-ready personas cannot be added to a room;
    // one that fell into that state after joining must stay quiet too.
    getPersonas.mockResolvedValue([
      personaRow(1, "小满"),
      personaRow(2, "阿凯", { presence: "asleep" }),
    ]);
    composeReply.mockResolvedValue("我在");
    const result = await caller().send({ roomId: 3, text: "@小满 @阿凯 在吗" });
    expect(result.replies.map((row) => row.personaId)).toEqual([1]);
    expect(composeReply).toHaveBeenCalledTimes(1);
    expect((composeReply.mock.calls[0]![0] as { persona: { id: number } }).persona.id).toBe(1);
  });

  it("reports an unknown room as not found", async () => {
    getRoom.mockResolvedValue(null);
    await expect(caller().send({ roomId: 99, text: "在吗" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

});

describe("history", () => {
  it("reads oldest first, with each persona's name", async () => {
    const rows = [
      {
        id: 5,
        roomId: 3,
        userId: 7,
        role: "assistant",
        personaId: 2,
        content: "我也在",
        metadata: null,
        createdAt: new Date("2024-05-01T21:02:00Z"),
      },
      {
        id: 4,
        roomId: 3,
        userId: 7,
        role: "user",
        personaId: null,
        content: "在吗",
        metadata: null,
        createdAt: new Date("2024-05-01T21:01:00Z"),
      },
    ];
    listMessages.mockResolvedValue(rows);
    const result = await caller().history({ roomId: 3 });
    expect(result.messages.map((row) => row.id)).toEqual([4, 5]);
    expect(result.messages[1]!.personaName).toBe("阿凯");
    expect(result.messages[0]!.personaName).toBeNull();
    expect(result.room.name).toBe("我们的群");
    expect(result.nextCursor).toBeNull();
  });

  it("pages back with the id cursor", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: 60 - index,
      roomId: 3,
      userId: 7,
      role: "user" as const,
      personaId: null,
      content: "x",
      metadata: null,
      createdAt: new Date(),
    }));
    listMessages.mockResolvedValue(rows);
    const result = await caller().history({ roomId: 3 });
    expect(result.nextCursor).toBe(21);
  });
});

describe("members", () => {
  it("refuses a sixth member", async () => {
    countMembers.mockResolvedValue(5);
    await expect(caller().addMember({ roomId: 3, personaId: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses to leave one persona alone in a room", async () => {
    countMembers.mockResolvedValue(2);
    await expect(caller().removeMember({ roomId: 3, personaId: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("adds and removes", async () => {
    countMembers.mockResolvedValue(3);
    await expect(caller().addMember({ roomId: 3, personaId: 1 })).resolves.toEqual({ success: true });
    countMembers.mockResolvedValue(3);
    removeMember.mockResolvedValue(true);
    await expect(caller().removeMember({ roomId: 3, personaId: 1 })).resolves.toEqual({
      success: true,
    });
  });
});

describe("the group code itself", () => {
  it("has no pair-conversation write path in it", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const files = [
      "server/routers-v6/group.ts",
      "server/group/reply.ts",
      "server/group/turns.ts",
    ];
    const sources = files
      .map((file) => readFileSync(path.join(root, file), "utf-8"))
      .join("\n");
    /**
     * The pair's own writes, memory extraction, the state machines and any
     * self-scheduling are not reachable from the group code: the lines
     * only go to `group_messages` through `createGroupMessage`, and the
     * next round starts with the user's next message, never a timer.
     */
    for (const forbidden of [
      "createMessage(",
      "createMemory(",
      "updatePersona(",
      "incrementChatCount(",
      "extractMemories(",
      "memory-extract",
      "updateIntimacy(",
      "createEmotionSnapshot(",
      "runConversation(",
      "importRecords(",
      "setTimeout(",
      "setInterval(",
      "setImmediate(",
      "queueMicrotask(",
      "createLetter",
      "pushToUser(",
    ]) {
      expect(sources, `group code must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("uses the one generation path", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const reply = readFileSync(path.join(root, "server/group/reply.ts"), "utf-8");
    expect(reply).toContain("planTurn");
    expect(reply).toContain("executePlan");
  });
});
