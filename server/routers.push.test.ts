import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const listPushSubscriptions = vi.fn();
const upsertPushSubscription = vi.fn();
const deletePushSubscription = vi.fn();
const setPushSubscriptionPreview = vi.fn();
const getPersonasByUserId = vi.fn();
const pushToUser = vi.fn();

vi.mock("./db", () => ({
  listPushSubscriptions: (...args: unknown[]) => listPushSubscriptions(...args),
  upsertPushSubscription: (...args: unknown[]) => upsertPushSubscription(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
  setPushSubscriptionPreview: (...args: unknown[]) => setPushSubscriptionPreview(...args),
  getPersonasByUserId: (...args: unknown[]) => getPersonasByUserId(...args),
}));

vi.mock("./_core/push", () => ({
  getVapidKeys: () => ({
    publicKey: "test-public",
    privateKey: "test-private",
    subject: "mailto:test@localhost",
  }),
  pushToUser: (...args: unknown[]) => pushToUser(...args),
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
    req: { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "TestBrowser" } } as any,
    res: {} as any,
    locale: "zh",
  } as unknown as TrpcContext;
}

const ENDPOINT = "https://push.example/one";

describe("push subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPushSubscriptions.mockImplementation(async (userId: number) =>
      userId === 1
        ? [{ endpoint: ENDPOINT, showPreview: false, createdAt: new Date("2026-11-19T00:00:00.000Z") }]
        : [],
    );
    upsertPushSubscription.mockImplementation(async (userId: number, input: { endpoint: string }) => ({
      id: 3,
      userId,
      endpoint: input.endpoint,
    }));
    deletePushSubscription.mockResolvedValue(true);
    getPersonasByUserId.mockResolvedValue([{ id: 9, name: "小满" }]);
    pushToUser.mockResolvedValue(1);
  });

  it("lists and deletes only the caller's own subscriptions", async () => {
    const mine = await appRouter.createCaller(ctxFor(1)).push.list();
    const theirs = await appRouter.createCaller(ctxFor(2)).push.list();
    expect(listPushSubscriptions).toHaveBeenNthCalledWith(1, 1);
    expect(listPushSubscriptions).toHaveBeenNthCalledWith(2, 2);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(JSON.stringify(mine)).not.toContain("p256dh");

    await appRouter.createCaller(ctxFor(2)).push.unsubscribe({ endpoint: ENDPOINT });
    expect(deletePushSubscription).toHaveBeenCalledWith(2, ENDPOINT);
    expect(deletePushSubscription).not.toHaveBeenCalledWith(1, ENDPOINT);
  });

  it("treats a repeated endpoint as an update, not a second insert", async () => {
    const source = readFileSync(path.join(__dirname, "db.ts"), "utf8");
    const start = source.indexOf("export async function upsertPushSubscription");
    const end = source.indexOf("export async function deletePushSubscription");
    const body = source.slice(start, end);
    expect(body).toContain(".insert(pushSubscriptions)");
    expect(body).toContain("onConflictDoUpdate");
    expect(body).toContain("pushSubscriptions.endpoint");

    const caller = appRouter.createCaller(ctxFor(1));
    const input = {
      endpoint: ENDPOINT,
      keys: { p256dh: "first-key", auth: "first-auth" },
    };
    await caller.push.subscribe(input);
    await caller.push.subscribe({
      endpoint: ENDPOINT,
      keys: { p256dh: "second-key", auth: "second-auth" },
    });
    expect(upsertPushSubscription).toHaveBeenCalledTimes(2);
    expect(upsertPushSubscription.mock.calls[0][0]).toBe(1);
    expect(upsertPushSubscription.mock.calls[1][0]).toBe(1);
    expect(upsertPushSubscription.mock.calls[1][1]).toEqual(
      expect.objectContaining({ endpoint: ENDPOINT, p256dh: "second-key", auth: "second-auth" }),
    );
  });
});
