import { describe, it, expect, vi, beforeEach } from "vitest";

const getChannelState = vi.fn();
const upsertChannelState = vi.fn();
const getChannelBinding = vi.fn();
const getChannelDefaultPersona = vi.fn();
const setChannelBindingPersona = vi.fn();
const getPersonaById = vi.fn();
const getChannelBindingsByUserId = vi.fn();
const getUserLocale = vi.fn();
const handleChannelChat = vi.fn();
const handleCommand = vi.fn();
const getActivePersonaId = vi.fn();

vi.mock("../db", () => ({
  getChannelState: (...a: unknown[]) => getChannelState(...a),
  upsertChannelState: (...a: unknown[]) => upsertChannelState(...a),
  getChannelBinding: (...a: unknown[]) => getChannelBinding(...a),
  getChannelDefaultPersona: (...a: unknown[]) => getChannelDefaultPersona(...a),
  setChannelBindingPersona: (...a: unknown[]) => setChannelBindingPersona(...a),
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
  getChannelBindingsByUserId: (...a: unknown[]) => getChannelBindingsByUserId(...a),
  getUserLocale: (...a: unknown[]) => getUserLocale(...a),
}));

vi.mock("./bridge", () => ({
  handleChannelChat: (...a: unknown[]) => handleChannelChat(...a),
}));

vi.mock("./commands", () => ({
  handleCommand: (...a: unknown[]) => handleCommand(...a),
  getActivePersonaId: (...a: unknown[]) => getActivePersonaId(...a),
}));

import {
  handleTelegramUpdate,
  interpretTelegramUpdate,
  runTelegramPoll,
  telegramAdapter,
  type TelegramUpdate,
} from "./telegram";
import { readChannelCursor } from "./binding";

/** The channel's cursor, mutable so a write is visible to the next read. */
let cursor: string | null;
/** The active binding, or null when the conversation is unbound. */
let binding: { id: number; personaId: number; isActive: boolean } | null;

function update(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
  return {
    update_id: 1001,
    message: {
      message_id: 5,
      from: { id: 42, is_bot: false, first_name: "阿树" },
      chat: { id: 42, type: "private" },
      text: "在吗",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cursor = null;
  binding = null;
  getChannelState.mockImplementation(async () => (cursor ? { cursor, status: "running" } : { cursor: null, status: "running" }));
  upsertChannelState.mockImplementation(async (_userId: number, _channel: string, data: { cursor?: string | null }) => {
    if ("cursor" in data) cursor = data.cursor ?? null;
    return 1;
  });
  getChannelBinding.mockImplementation(async () => binding ?? undefined);
  getChannelDefaultPersona.mockResolvedValue({ personaId: 7 });
  setChannelBindingPersona.mockResolvedValue(1);
  getPersonaById.mockResolvedValue({ id: 7, name: "小满" });
  getChannelBindingsByUserId.mockResolvedValue([]);
  getUserLocale.mockResolvedValue("zh");
  handleChannelChat.mockResolvedValue({ parts: ["在的呀"], gapsMs: [] });
  handleCommand.mockResolvedValue({ handled: false });
  getActivePersonaId.mockReturnValue(7);
  cursor = JSON.stringify({ cursor: "1000", bindCode: "123456", bindAttempts: 0 });
});

describe("interpreting a Telegram update", () => {
  it("takes the chat, sender and text out", () => {
    expect(interpretTelegramUpdate(update())).toMatchObject({
      updateId: 1001,
      chatId: "42",
      chatType: "private",
      senderId: "42",
      text: "在吗",
      fromBot: false,
    });
  });

  it("has nothing for an update without a message", () => {
    expect(interpretTelegramUpdate({ update_id: 1 })).toBeNull();
  });
});

describe("an unbound conversation", () => {
  it("is not answered, and no model is called", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update(),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(sent).toEqual([]);
    expect(handleChannelChat).not.toHaveBeenCalled();
  });

  it("drops a group message without a word", async () => {
    cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 0 });
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, chat: { id: -100, type: "supergroup" } } }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(sent).toEqual([]);
    expect(getChannelBinding).not.toHaveBeenCalled();
    expect(handleChannelChat).not.toHaveBeenCalled();
  });

  it("drops the bot's own message", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({
        message: { ...update().message!, from: { id: 1, is_bot: true }, text: "/bind 123456" },
      }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(sent).toEqual([]);
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });

  it("says how many tries are left after a wrong code", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, text: "/bind 000000" } }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(sent.join("\n")).toContain("2");
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
    expect(JSON.parse(cursor!).bindAttempts).toBe(1);
  });

  it("uses the code up after three wrong tries", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await handleTelegramUpdate({
        userId: 1,
        update: update({ message: { ...update().message!, text: "/bind 000000" } }),
        sendText: async () => undefined,
      });
    }
    const stored = JSON.parse(cursor ?? "{}");
    expect(stored.bindCode).toBeUndefined();
    expect(stored.bindAttempts).toBeUndefined();
    // And a later correct-looking code cannot resurrect it.
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, text: "/bind 123456" } }),
      sendText: async () => undefined,
    });
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
  });

  it("binds the conversation with the right code and says so", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, text: "/bind 123456" } }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(setChannelBindingPersona).toHaveBeenCalledWith({
      userId: 1,
      channel: "telegram",
      targetId: "42",
      personaId: 7,
      targetName: "阿树",
    });
    expect(sent.join("\n")).toContain("数字分身");
    expect(JSON.parse(cursor ?? "{}").bindCode).toBeUndefined();
  });

  it("does not bind when the channel has no persona", async () => {
    getChannelDefaultPersona.mockResolvedValue(undefined);
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, text: "/bind 123456" } }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(setChannelBindingPersona).not.toHaveBeenCalled();
    expect(sent.join("\n")).toContain("还没有选分身");
  });
});

describe("a bound conversation", () => {
  beforeEach(() => {
    binding = { id: 3, personaId: 7, isActive: true };
  });

  it("answers with the persona's reply", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update(),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(handleChannelChat).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      conversationKey: "42",
      personaId: 7,
      messageText: "在吗",
      channel: "telegram",
    }));
    expect(sent).toEqual(["在的呀"]);
  });

  it("says the message failed when the send does", async () => {
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update(),
      sendText: async (_chat, text) => {
        if (text === "在的呀") throw new Error("telegram is down");
        sent.push(text);
      },
    });
    expect(sent.join("\n")).toContain("消息没有发出去");
  });

  it("handles a command and does not call the model", async () => {
    handleCommand.mockResolvedValue({ handled: true, reply: "你的分身：小满" });
    const sent: string[] = [];
    await handleTelegramUpdate({
      userId: 1,
      update: update({ message: { ...update().message!, text: "/分身列表" } }),
      sendText: async (_chat, text) => { sent.push(text); },
    });
    expect(handleChannelChat).not.toHaveBeenCalled();
    expect(sent).toEqual(["你的分身：小满"]);
  });
});

describe("the long poll", () => {
  it("acknowledges an update by moving the offset past it", async () => {
    const urls: string[] = [];
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({
        ok: true,
        result: [{ update_id: 77, message: { message_id: 1, chat: { id: 1, type: "private" }, text: "在吗" } }],
      }), { status: 200 });
    });
    const onUpdate = vi.fn(async () => {
      controller.abort();
    });
    await runTelegramPoll({
      userId: 1,
      token: "token",
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUpdate,
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(cursor!).cursor).toBe("78");
    // The second call is the one whose URL carries the new offset — but the
    // loop was aborted inside onUpdate, so there is only one request here.
    expect(urls[0]).toContain("/bottoken/getUpdates");
  });

  it("backs off and tries again after a failed poll", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      controller.abort();
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    });
    const onError = vi.fn();
    await runTelegramPoll({
      userId: 1,
      token: "token",
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUpdate: async () => undefined,
      onError,
    });
    expect(onError).toHaveBeenCalled();
    expect(calls).toBe(2);
  });
});

describe("the adapter", () => {
  it("refuses to start without a bot token", async () => {
    getChannelState.mockResolvedValue({ cursor: null, credentialsEnc: null });
    await expect(telegramAdapter.start(1, "zh")).rejects.toThrow(/凭据/);
    expect(upsertChannelState).not.toHaveBeenCalledWith(
      1,
      "telegram",
      expect.objectContaining({ status: "running" }),
    );
  });

  it("shows the binding code in its status while unbound", async () => {
    cursor = JSON.stringify({ bindCode: "654321" });
    getChannelState.mockResolvedValue({ cursor, status: "running" });
    const status = await telegramAdapter.status(1);
    expect(status.channel).toBe("telegram");
    expect(status.detail).toMatchObject({ bindCode: "654321" });
  });

  it("keeps the code out of the status once a conversation is bound", async () => {
    cursor = JSON.stringify({ bindCode: "654321" });
    getChannelState.mockResolvedValue({ cursor, status: "running" });
    getChannelBindingsByUserId.mockResolvedValue([{ id: 1, isActive: true }]);
    const status = await telegramAdapter.status(1);
    expect(status.detail?.bindCode).toBeUndefined();
  });

  it("stops cleanly", async () => {
    await telegramAdapter.stop(1);
    expect(upsertChannelState).toHaveBeenCalledWith(1, "telegram", { status: "stopped" });
  });

  it("reads back the cursor it stored", async () => {
    cursor = JSON.stringify({ cursor: "900" });
    const stored = await readChannelCursor(1, "telegram");
    expect(stored.cursor).toBe("900");
  });
});
