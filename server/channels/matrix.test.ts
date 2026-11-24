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
  handleMatrixMessage,
  interpretMatrixSync,
  runMatrixSync,
  sendMatrixMessage,
  type MatrixMessage,
} from "./matrix";

let cursor: string | null;
let binding: { id: number; personaId: number; isActive: boolean } | null;

function message(overrides: Partial<MatrixMessage> = {}): MatrixMessage {
  return {
    roomId: "!abc:example.org",
    eventId: "$e1",
    senderId: "@bob:example.org",
    text: "在吗",
    ...overrides,
  };
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

describe("interpreting /sync", () => {
  it("takes text messages out of joined rooms and invites out of invites", () => {
    const result = interpretMatrixSync({
      next_batch: "s2",
      rooms: {
        join: {
          "!abc:example.org": {
            timeline: {
              events: [
                {
                  type: "m.room.message",
                  event_id: "$e1",
                  sender: "@bob:example.org",
                  content: { msgtype: "m.text", body: "在吗" },
                },
                {
                  type: "m.room.message",
                  event_id: "$e2",
                  sender: "@bob:example.org",
                  content: { msgtype: "m.image", body: "a picture" },
                },
                { type: "m.room.member", event_id: "$e3", sender: "@bob:example.org" },
              ],
            },
          },
        },
        invite: { "!new:example.org": {} },
      },
    });
    expect(result.nextBatch).toBe("s2");
    expect(result.messages).toEqual([
      { roomId: "!abc:example.org", eventId: "$e1", senderId: "@bob:example.org", text: "在吗" },
    ]);
    expect(result.invites).toEqual(["!new:example.org"]);
  });
});

describe("an unbound Matrix conversation", () => {
  it("only answers a bind attempt", async () => {
    const sent: string[] = [];
    await handleMatrixMessage({ userId: 1, message: message(), sendText: async (_r, t) => { sent.push(t); } });
    expect(sent).toEqual([]);
    expect(handleChannelChat).not.toHaveBeenCalled();

    await handleMatrixMessage({
      userId: 1,
      message: message({ text: "/bind 123456" }),
      sendText: async (_r, t) => { sent.push(t); },
    });
    expect(setChannelBindingPersona).toHaveBeenCalledWith(expect.objectContaining({
      channel: "matrix",
      targetId: "!abc:example.org",
    }));
    expect(sent.join("\n")).toContain("数字分身");
  });

  it("uses the code up after three wrong tries", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await handleMatrixMessage({
        userId: 1,
        message: message({ text: "/bind 000000" }),
        sendText: async () => undefined,
      });
    }
    expect(JSON.parse(cursor ?? "{}").bindCode).toBeUndefined();
  });
});

describe("a bound Matrix conversation", () => {
  beforeEach(() => {
    binding = { id: 3, personaId: 7, isActive: true };
  });

  it("answers with the persona's reply", async () => {
    const sent: string[] = [];
    await handleMatrixMessage({ userId: 1, message: message(), sendText: async (_r, t) => { sent.push(t); } });
    expect(handleChannelChat).toHaveBeenCalledWith(expect.objectContaining({
      channel: "matrix",
      conversationKey: "!abc:example.org",
    }));
    expect(sent).toEqual(["在的呀"]);
  });

  it("says the message failed when the send does", async () => {
    const sent: string[] = [];
    await handleMatrixMessage({
      userId: 1,
      message: message(),
      sendText: async (_room, text) => {
        if (text === "在的呀") throw new Error("matrix is down");
        sent.push(text);
      },
    });
    expect(sent.join("\n")).toContain("消息没有发出去");
  });
});

describe("sending", () => {
  it("puts the message under an encoded room id with the token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ event_id: "$x" }), { status: 200 }));
    await sendMatrixMessage(
      fetchMock as unknown as typeof fetch,
      { homeserverUrl: "https://matrix.example", accessToken: "syt_token" },
      "!abc:example.org",
      "在的呀",
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // `!` is a legal path character; the colon is what has to be encoded.
    expect(url).toContain("/_matrix/client/v3/rooms/!abc%3Aexample.org/send/m.room.message/");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer syt_token");
    expect(JSON.parse(String(init.body))).toEqual({ msgtype: "m.text", body: "在的呀" });
  });
});

describe("the sync loop", () => {
  it("keeps the cursor and skips its own events", async () => {
    const urls: string[] = [];
    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return new Response(JSON.stringify({
          next_batch: "s2",
          rooms: {
            join: {
              "!abc:example.org": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      event_id: "$e1",
                      sender: "@bob:example.org",
                      content: { msgtype: "m.text", body: "在吗" },
                    },
                    {
                      type: "m.room.message",
                      event_id: "$e2",
                      sender: "@bot:example.org",
                      content: { msgtype: "m.text", body: "bot's own line" },
                    },
                  ],
                },
              },
            },
          },
        }), { status: 200 });
      }
      controller.abort();
      return new Response(JSON.stringify({ next_batch: "s3" }), { status: 200 });
    });
    const received: string[] = [];
    const synced: string[] = [];
    await runMatrixSync({
      credentials: { homeserverUrl: "https://matrix.example", accessToken: "token" },
      ownUserId: "@bot:example.org",
      signal: controller.signal,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onMessage: async (event) => {
        received.push(event.text);
      },
      onSync: async (since) => {
        synced.push(since);
      },
    });
    expect(received).toEqual(["在吗"]);
    expect(synced).toEqual(["s2"]);
    expect(urls[1]).toContain("since=s2");
  });

  it("retries after a failed sync", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    let calls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      calls += 1;
      urls.push(String(url));
      if (calls === 1) throw new Error("network");
      controller.abort();
      return new Response(JSON.stringify({ next_batch: "s2" }), { status: 200 });
    });
    const onError = vi.fn();
    await runMatrixSync({
      credentials: { homeserverUrl: "https://matrix.example", accessToken: "token" },
      ownUserId: "@bot:example.org",
      signal: controller.signal,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onMessage: async () => undefined,
      onError,
    });
    expect(onError).toHaveBeenCalled();
    expect(calls).toBe(2);
    expect(urls[0]).not.toContain("since=");
  }, 10_000);
});
