import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
const listPushSubscriptions = vi.fn();
const deletePushSubscription = vi.fn();
const markPushSuccess = vi.fn();
const markPushFailure = vi.fn();

vi.mock("web-push", () => ({
  generateVAPIDKeys: () => ({ publicKey: "generated-public", privateKey: "generated-private" }),
  setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  sendNotification: (...args: unknown[]) => sendNotification(...args),
}));

vi.mock("../db", () => ({
  listPushSubscriptions: (...args: unknown[]) => listPushSubscriptions(...args),
  deletePushSubscription: (...args: unknown[]) => deletePushSubscription(...args),
  markPushSuccess: (...args: unknown[]) => markPushSuccess(...args),
  markPushFailure: (...args: unknown[]) => markPushFailure(...args),
}));

import { buildPushPayload, pushToUser } from "./push";

const NAME = "名字不该出现";
const TEXT = "正文不该出现在默认负载里" + "测".repeat(40);

function subscription(showPreview: boolean) {
  return {
    id: 1,
    userId: 4,
    endpoint: "https://push.example/device",
    p256dh: "key-p256",
    auth: "key-auth",
    showPreview,
    failCount: 0,
    userAgent: null,
    lastSuccessAt: null,
    createdAt: new Date("2026-11-19T00:00:00.000Z"),
  };
}

describe("browser push payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "test-public";
    process.env.VAPID_PRIVATE_KEY = "test-private";
    process.env.VAPID_SUBJECT = "mailto:test@localhost";
    sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    listPushSubscriptions.mockResolvedValue([subscription(false)]);
    deletePushSubscription.mockResolvedValue(true);
    markPushSuccess.mockResolvedValue(undefined);
    markPushFailure.mockResolvedValue(undefined);
  });

  it("leaves the name and the message text out of the default payload", async () => {
    const serialized = buildPushPayload(
      { kind: "reply", personaId: 7, personaName: NAME, text: TEXT },
      false,
    );
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(serialized).not.toContain(NAME);
    expect(serialized).not.toContain("正文不该出现");
    expect(payload).toEqual({ kind: "reply", personaId: 7, url: "/chat/7" });

    await pushToUser(4, { kind: "reply", personaId: 7, personaName: NAME, text: TEXT });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const sent = sendNotification.mock.calls[0][1] as string;
    expect(sent).not.toContain(NAME);
    expect(sent).not.toContain("正文不该出现");
  });

  it("adds the name and the first 40 characters when the subscription asks for a preview", async () => {
    listPushSubscriptions.mockResolvedValue([subscription(true)]);
    await pushToUser(4, { kind: "reply", personaId: 7, personaName: NAME, text: TEXT });
    const sent = JSON.parse(sendNotification.mock.calls[0][1] as string) as {
      title: string;
      body: string;
    };
    expect(sent.title).toBe(NAME);
    expect(sent.body).toBe(Array.from(TEXT).slice(0, 40).join(""));
    expect(sent.body).toHaveLength(40);
    expect(sent.body.endsWith("测")).toBe(true);
  });

  it("deletes a subscription the push service says is gone", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    await expect(
      pushToUser(4, { kind: "reminder", personaId: 7, personaName: NAME, text: "hi" }),
    ).resolves.toBe(1);
    expect(deletePushSubscription).toHaveBeenCalledWith(4, "https://push.example/device");
    expect(markPushFailure).not.toHaveBeenCalled();
  });

  it("does not throw when sending fails for any other reason", async () => {
    sendNotification.mockRejectedValue(new Error("network down"));
    await expect(
      pushToUser(4, { kind: "reminder", personaId: 7, personaName: NAME, text: "hi" }),
    ).resolves.toBe(1);
    expect(markPushFailure).toHaveBeenCalledWith(4, "https://push.example/device");
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});
