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
  DISCORD_INTENTS,
  discordIdentify,
  handleDiscordMessage,
  interpretDiscordMessage,
  runDiscordGateway,
  type DiscordSocket,
} from "./discord";

let cursor: string | null;
let binding: { id: number; personaId: number; isActive: boolean } | null;

function dm(overrides: Record<string, unknown> = {}) {
  return {
    channelId: "222",
    messageId: "111",
    authorId: "333",
    text: "在吗",
    ...overrides,
  };
}

class FakeSocket implements DiscordSocket {
  readonly sent: string[] = [];
  private handlers = new Map<string, Array<(event: any) => void>>();
  constructor(readonly label: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(type: string, handler: (event: any) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  emit(type: string, event: any): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  dispatch(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  cursor = JSON.stringify({ bindCode: "123456", bindAttempts: 0 });
  binding = null;
  getChannelState.mockImplementation(async () => ({ cursor, status: "running" }));
  upsertChannelState.mockImplementation(async (_u: number, _c: string, data: { cursor?: string | null }) => {
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
});

describe("interpreting a Discord message", () => {
  it("takes a direct message and ignores a guild channel", () => {
    expect(interpretDiscordMessage({
      id: "1",
      channel_id: "2",
      content: "在吗",
      author: { id: "3", bot: false },
      channel_type: 1,
    })).toEqual({ channelId: "2", messageId: "1", authorId: "3", text: "在吗" });
    expect(interpretDiscordMessage({
      id: "1",
      channel_id: "2",
      guild_id: "9",
      content: "在吗",
      author: { id: "3", bot: false },
    })).toBeNull();
  });

  it("ignores a bot's own message and an empty one", () => {
    expect(interpretDiscordMessage({
      id: "1", channel_id: "2", content: "在吗", author: { id: "3", bot: true },
    })).toBeNull();
    expect(interpretDiscordMessage({
      id: "1", channel_id: "2", content: "  ", author: { id: "3", bot: false },
    })).toBeNull();
  });
});

describe("the identify payload", () => {
  it("asks for direct messages and not for the privileged content intent", () => {
    expect(DISCORD_INTENTS).toBe(4096);
    const payload = discordIdentify("bot-token") as { op: number; d: { token: string; intents: number } };
    expect(payload.op).toBe(2);
    expect(payload.d.token).toBe("bot-token");
    expect(payload.d.intents).toBe(4096);
  });
});

describe("an unbound Discord conversation", () => {
  it("only answers a bind attempt", async () => {
    const sent: string[] = [];
    await handleDiscordMessage({ userId: 1, message: dm(), sendText: async (_c, t) => { sent.push(t); } });
    expect(sent).toEqual([]);
    expect(handleChannelChat).not.toHaveBeenCalled();

    await handleDiscordMessage({
      userId: 1,
      message: dm({ text: "/bind 123456" }),
      sendText: async (_c, t) => { sent.push(t); },
    });
    expect(setChannelBindingPersona).toHaveBeenCalledWith(expect.objectContaining({
      channel: "discord",
      targetId: "222",
    }));
    expect(sent.join("\n")).toContain("数字分身");
  });

  it("uses the code up after three wrong tries", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await handleDiscordMessage({
        userId: 1,
        message: dm({ text: "/bind 000000" }),
        sendText: async () => undefined,
      });
    }
    expect(JSON.parse(cursor ?? "{}").bindCode).toBeUndefined();
  });
});

describe("a bound Discord conversation", () => {
  beforeEach(() => {
    binding = { id: 3, personaId: 7, isActive: true };
  });

  it("answers with the persona's reply", async () => {
    const sent: string[] = [];
    await handleDiscordMessage({ userId: 1, message: dm(), sendText: async (_c, t) => { sent.push(t); } });
    expect(handleChannelChat).toHaveBeenCalledWith(expect.objectContaining({
      channel: "discord",
      conversationKey: "222",
      personaId: 7,
    }));
    expect(sent).toEqual(["在的呀"]);
  });

  it("says the message failed when the send does", async () => {
    const sent: string[] = [];
    await handleDiscordMessage({
      userId: 1,
      message: dm(),
      sendText: async (_c, text) => {
        if (text === "在的呀") throw new Error("discord is down");
        sent.push(text);
      },
    });
    expect(sent.join("\n")).toContain("消息没有发出去");
  });
});

describe("the gateway loop", () => {
  it("reconnects after the socket closes", async () => {
    const sockets: FakeSocket[] = [];
    const controller = new AbortController();
    const factory = vi.fn((_url: string) => {
      const socket = new FakeSocket(`socket-${sockets.length}`);
      sockets.push(socket);
      return socket;
    });
    const messages: string[] = [];
    const done = runDiscordGateway({
      token: "bot-token",
      signal: controller.signal,
      socketFactory: factory,
      reconnectDelayMs: 0,
      onMessage: async (message) => {
        messages.push(message.text);
      },
    });
    // Let the first connection register its handlers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sockets).toHaveLength(1);
    sockets[0].dispatch({ op: 10, d: { heartbeat_interval: 45_000 } });
    expect(sockets[0].sent.some((line) => JSON.parse(line).op === 2)).toBe(true);
    sockets[0].dispatch({ op: 0, t: "READY", s: 1, d: { session_id: "session" } });
    sockets[0].dispatch({
      op: 0,
      t: "MESSAGE_CREATE",
      s: 2,
      d: { id: "1", channel_id: "222", content: "在吗", author: { id: "333", bot: false } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(messages).toEqual(["在吗"]);

    sockets[0].close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sockets.length).toBe(2);
    // The second connection resumes the session it had.
    sockets[1].dispatch({ op: 10, d: { heartbeat_interval: 45_000 } });
    const resume = sockets[1].sent.map((line) => JSON.parse(line)).find((payload) => payload.op === 6);
    expect(resume?.d).toMatchObject({ session_id: "session", seq: 2 });
    controller.abort();
    sockets[1].close();
    await done;
  });
});
