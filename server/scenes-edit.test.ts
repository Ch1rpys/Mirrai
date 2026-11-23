import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Editing a scene, copying one, and making one out of the record (C8.13).
 *
 * The database module is mocked, like the rest of the scene tests: what
 * is being checked here is the route's rules — who may change what, and
 * what a scene made from a stretch of the record remembers.
 */

const getSceneById = vi.fn();
const getPersonaById = vi.fn();
const createScene = vi.fn();
const updateScene = vi.fn();
const deleteScene = vi.fn();
const activateScene = vi.fn();
const getRecordsByIds = vi.fn();
const iterateRecords = vi.fn(async function* () {
  /* Filled in per test. */
}) as any;

vi.mock("./db", () => ({
  getSceneById: (...a: unknown[]) => getSceneById(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  createScene: (...a: unknown[]) => createScene(...a),
  updateScene: (...a: unknown[]) => updateScene(...a),
  deleteScene: (...a: unknown[]) => deleteScene(...a),
  activateScene: (...a: unknown[]) => activateScene(...a),
  getRecordsByIds: (...a: unknown[]) => getRecordsByIds(...a),
  iterateRecords: (...a: unknown[]) => iterateRecords(...(a as [])),
  getUserTimezone: vi.fn().mockResolvedValue(null),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { copy, copyKey } from "@shared/copy";

const PERSONA = {
  id: 5,
  userId: 1,
  name: "小A",
  timezone: "Asia/Shanghai",
  personaData: null,
};

function makeCtx(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      username: "test-user",
      passwordHash: null,
      openId: "test-open-id",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "local",
      role: "user",
      tokenVersion: 0,
      graduationMode: "suggest",
      timezone: null,
      budget: null,
    backupSettings: null,
    lockPinHash: null,
    lockSettings: null,
    encryption: null,
    features: null,
      locale: "zh",
      addressStyle: null,
      boundaries: null,
      trajectoryAssessment: "auto",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    locale: "zh",
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

/** A record row, with the fields the routes and the selector read. */
function record(id: number, at: string, content: string, personaId = 5) {
  return {
    id,
    personaId,
    userId: 1,
    role: id % 2 === 0 ? "user" : "assistant",
    speaker: null,
    kind: "text",
    content,
    timestamp: new Date(at),
    createdAt: new Date(at),
  };
}

const BUILTIN_SCENE = {
  id: 3,
  userId: null,
  name: "深夜聊天",
  description: "夜深人静",
  icon: "🌙",
  systemPromptOverlay: "现在是深夜。",
  emotionalState: "nostalgic",
  starters: ["睡不着吗？"],
  isBuiltin: true,
  recordRange: null,
  createdAt: new Date(),
};

const OWN_SCENE = {
  ...BUILTIN_SCENE,
  id: 4,
  userId: 1,
  name: "一起做饭",
  isBuiltin: false,
  recordRange: null,
};

beforeEach(() => {
  for (const fn of [
    getSceneById,
    getPersonaById,
    createScene,
    updateScene,
    deleteScene,
    activateScene,
    getRecordsByIds,
  ]) {
    fn.mockReset();
  }
  iterateRecords.mockReset();
  iterateRecords.mockImplementation(async function* () {
    /* Empty unless a test fills it. */
  });
  getPersonaById.mockResolvedValue(PERSONA);
  createScene.mockImplementation(async (data: Record<string, unknown>) => ({ id: 42, ...data }));
  updateScene.mockImplementation(async (id: number, userId: number, patch: object) => ({
    ...OWN_SCENE,
    id,
    userId,
    ...patch,
  }));
});

describe("editing a scene", () => {
  it("changes a scene of the user's own", async () => {
    getSceneById.mockResolvedValue(OWN_SCENE);
    const caller = appRouter.createCaller(makeCtx());

    const updated = await caller.scene.update({
      id: 4,
      name: "一起做饭吧",
      description: "厨房里的晚上",
      icon: "🍳",
      systemPromptOverlay: "你们在厨房里一起做饭。",
      emotionalState: "playful",
      starters: ["今天做什么？"],
    });

    expect(updateScene).toHaveBeenCalledWith(4, 1, {
      name: "一起做饭吧",
      description: "厨房里的晚上",
      icon: "🍳",
      systemPromptOverlay: "你们在厨房里一起做饭。",
      emotionalState: "playful",
      starters: ["今天做什么？"],
    });
    expect((updated as any).name).toBe("一起做饭吧");
  });

  it("answers NOT_FOUND for somebody else's scene", async () => {
    // The owner filter lives in the read: another user's scene is
    // indistinguishable from one that does not exist.
    getSceneById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());

    await expect(caller.scene.update({ id: 4, name: "改个名" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("refuses a built-in scene, and says what to do instead", async () => {
    getSceneById.mockResolvedValue(BUILTIN_SCENE);
    const caller = appRouter.createCaller(makeCtx());

    await expect(caller.scene.update({ id: 3, name: "改个名" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: copy("zh", "errors.sceneBuiltinReadOnly"),
    });
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("puts the same limit on an edit as on a create", async () => {
    getSceneById.mockResolvedValue(OWN_SCENE);
    const caller = appRouter.createCaller(makeCtx());
    const tooLong = "x".repeat(20_001);

    await expect(
      caller.scene.update({ id: 4, systemPromptOverlay: tooLong }),
    ).rejects.toThrow();
    await expect(
      caller.scene.create({ name: "一个场景", systemPromptOverlay: tooLong }),
    ).rejects.toThrow();
    expect(updateScene).not.toHaveBeenCalled();
    expect(createScene).not.toHaveBeenCalled();
  });
});

describe("copying a scene", () => {
  it("copies a built-in scene into the user's own, with its wording", async () => {
    getSceneById.mockResolvedValue(BUILTIN_SCENE);
    const caller = appRouter.createCaller(makeCtx());

    await caller.scene.duplicate({ id: 3 });

    expect(createScene).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        // A built-in scene is copied in the language the person reads it
        // in, not in the row's Chinese identity.
        name: `${copyKey("zh", "scenes.latenight.name")}（副本）`,
        icon: "🌙",
        description: copyKey("zh", "scenes.latenight.description"),
        systemPromptOverlay: copyKey("zh", "scenes.latenight.overlay"),
        emotionalState: "nostalgic",
        // One starter in the row, three in the definition: the row's
        // own wording is kept rather than half-swapped.
        starters: ["睡不着吗？"],
        isBuiltin: false,
      }),
    );
  });

  it("makes the copy editable — which is the way to change a built-in", async () => {
    getSceneById.mockResolvedValueOnce(BUILTIN_SCENE);
    const caller = appRouter.createCaller(makeCtx());
    await caller.scene.duplicate({ id: 3 });

    const copied = (createScene.mock.calls[0]![0] as any);
    getSceneById.mockResolvedValue({ ...copied, id: 9, userId: 1, isBuiltin: false });
    const updated = await caller.scene.update({ id: 9, name: "我的深夜聊天" });

    expect(updateScene).toHaveBeenCalledWith(9, 1, { name: "我的深夜聊天" });
    expect((updated as any).name).toBe("我的深夜聊天");
  });

  it("answers NOT_FOUND for a scene that is not readable", async () => {
    getSceneById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());

    await expect(caller.scene.duplicate({ id: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createScene).not.toHaveBeenCalled();
  });
});

describe("a scene made from a stretch of the record", () => {
  const SEGMENT = [
    record(100, "2026-03-01T04:00:00.000Z", "今天风很大"),
    record(101, "2026-03-01T04:01:00.000Z", "我把窗户关上了"),
    record(102, "2026-03-01T04:02:00.000Z", "你那边下雨了吗"),
    record(103, "2026-03-01T04:03:00.000Z", "下了，还不小"),
    record(104, "2026-03-02T04:00:00.000Z", "雨停了"),
    record(105, "2026-03-02T04:01:00.000Z", "今天出门走走吗"),
    record(106, "2026-03-02T04:02:00.000Z", "好啊，等我一下"),
    record(107, "2026-03-02T04:03:00.000Z", "我在楼下等你"),
  ];

  beforeEach(() => {
    getRecordsByIds.mockImplementation(async (ids: number[]) =>
      SEGMENT.filter((row) => ids.includes(row.id)),
    );
    iterateRecords.mockImplementation(async function* () {
      for (const row of SEGMENT) yield row;
    });
  });

  it("remembers the two ends, the days, and the persona it came from", async () => {
    const caller = appRouter.createCaller(makeCtx());

    await caller.scene.createFromRecords({ personaId: 5, fromId: 100, toId: 107 });

    expect(createScene).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        name: "2026-03-01–2026-03-02",
        description: copy("zh", "scenes.rangeDescription", {
          from: "2026-03-01",
          to: "2026-03-02",
        }),
        starters: [],
        isBuiltin: false,
        recordRange: {
          personaId: 5,
          fromId: 100,
          toId: 107,
          from: "2026-03-01",
          to: "2026-03-02",
        },
      }),
    );
  });

  it("names a one-day stretch by its day", async () => {
    // Every line of this stretch was said on the same day.
    const day = SEGMENT.slice(0, 6).map((row, index) =>
      record(100 + index, `2026-03-01T04:0${index}:00.000Z`, row.content),
    );
    getRecordsByIds.mockImplementation(async (ids: number[]) =>
      day.filter((row) => ids.includes(row.id)),
    );
    iterateRecords.mockImplementation(async function* () {
      for (const row of day) yield row;
    });
    const caller = appRouter.createCaller(makeCtx());

    await caller.scene.createFromRecords({ personaId: 5, fromId: 100, toId: 105 });

    expect(createScene).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "2026-03-01",
        recordRange: expect.objectContaining({ from: "2026-03-01", to: "2026-03-01" }),
      }),
    );
  });

  it("refuses a stretch with too few lines to be a context", async () => {
    const short = SEGMENT.slice(0, 2);
    getRecordsByIds.mockImplementation(async (ids: number[]) =>
      short.filter((row) => ids.includes(row.id)),
    );
    iterateRecords.mockImplementation(async function* () {
      for (const row of short) yield row;
    });
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.scene.createFromRecords({ personaId: 5, fromId: 100, toId: 101 }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "errors.sceneRangeTooShort"),
    });
    expect(createScene).not.toHaveBeenCalled();
  });

  it("refuses records of another persona", async () => {
    getRecordsByIds.mockResolvedValue([
      record(100, "2026-03-01T04:00:00.000Z", "不是他的", 6),
      record(107, "2026-03-02T04:03:00.000Z", "也不是他的", 6),
    ]);
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.scene.createFromRecords({ personaId: 5, fromId: 100, toId: 107 }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "errors.sceneRangeNotYours"),
    });
    expect(createScene).not.toHaveBeenCalled();
  });
});

describe("using a stretch scene on a persona", () => {
  it("is refused when the scene came from another persona", async () => {
    getSceneById.mockResolvedValue({
      ...OWN_SCENE,
      id: 8,
      recordRange: { personaId: 6, fromId: 100, toId: 107, from: "2026-03-01", to: "2026-03-02" },
    });
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.scene.activate({ personaId: 5, sceneId: 8 }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: copy("zh", "errors.sceneRangeOwner"),
    });
    expect(activateScene).not.toHaveBeenCalled();
  });

  it("is allowed on the persona it came from", async () => {
    getSceneById.mockResolvedValue({
      ...OWN_SCENE,
      id: 8,
      recordRange: { personaId: 5, fromId: 100, toId: 107, from: "2026-03-01", to: "2026-03-02" },
    });
    const caller = appRouter.createCaller(makeCtx());

    await caller.scene.activate({ personaId: 5, sceneId: 8 });

    expect(activateScene).toHaveBeenCalledWith(5, 8, 1);
  });

  it("is refused for a scene the user cannot read", async () => {
    getSceneById.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(makeCtx());

    await expect(
      caller.scene.activate({ personaId: 5, sceneId: 8 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(activateScene).not.toHaveBeenCalled();
  });
});
