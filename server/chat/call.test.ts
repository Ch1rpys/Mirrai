import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createCallOnlyServer, isAnswerSlot, splitCallSentences } from "./call";

const createMessage = vi.fn();
const createSafetyEvent = vi.fn();
const getMessagesByPersonaId = vi.fn();
const setMessageContent = vi.fn();
const cancelPendingReplyJobs = vi.fn();
vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMessage: (...args: unknown[]) => createMessage(...args),
  createSafetyEvent: (...args: unknown[]) => createSafetyEvent(...args),
  getMessagesByPersonaId: (...args: unknown[]) => getMessagesByPersonaId(...args),
  setMessageContent: (...args: unknown[]) => setMessageContent(...args),
  cancelPendingReplyJobs: (...args: unknown[]) => cancelPendingReplyJobs(...args),
}));

function callProfile(slots: Array<{ weekday: number; hour: number; n: number }>) {
  return {
    calls: {
      samples: 20,
      byDirection: { in: 14, out: 6, missed: 0 },
      durationSec: { median: 1800, p90: 3000, total: 36000 },
      perWeekMedian: 1,
      answerSlots: slots,
      longest: { recordId: 9, durationSec: 3600, at: "2024-06-02T13:00:00.000Z" },
      first: { recordId: 1, at: "2022-03-06T13:00:00.000Z" },
      last: { recordId: 20, at: "2024-09-29T13:00:00.000Z" },
    },
  };
}

/**
 * The moment the tests run at: 20:00 in Shanghai, a Thursday.
 * The default persona's record says that is when they answer.
 */
const NOW = new Date("2026-01-15T12:00:00.000Z");

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  timezone: "Asia/Shanghai",
  settings: { layers: { callMode: true } },
  styleProfile: callProfile([{ weekday: 4, hour: 20, n: 5 }]),
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn(async () => ({ id: 1, name: "阿树", timezone: "Asia/Shanghai" })),
    getPersona: vi.fn(async () => persona),
    resolveProvider: vi.fn(async () => ({ name: "test" } as never)),
    transcribe: vi.fn(async () => ({ text: "在吗" })),
    synthesize: vi.fn(async () => Buffer.from("audio")),
    converse: vi.fn(async function* () {
      yield { type: "delta", text: "在的。" };
      yield { type: "delta", text: "今天怎么样。" };
      yield { type: "done", messageId: 1, crisis: false };
    }),
    trimReply: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  };
}

let close: (() => void) | null = null;

async function connect(
  port: number,
  origin: boolean | string = true,
): Promise<{ ws: WebSocket; messages: any[] }> {
  const originHeader =
    typeof origin === "string" ? origin : origin ? `http://127.0.0.1:${port}` : null;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/call?personaId=5`, {
    headers: originHeader ? { Origin: originHeader } : {},
  });
  const messages: any[] = [];
  ws.on("message", (data, isBinary) => {
    messages.push(isBinary ? { binary: true, bytes: Buffer.from(data as Buffer).toString() } : JSON.parse(String(data)));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, response) => reject(new Error(`http ${response.statusCode}`)));
  });
  return { ws, messages };
}

async function waitFor(messages: any[], match: (message: any) => boolean, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = messages.find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out; got ${JSON.stringify(messages)}`);
}

afterEach(() => {
  close?.();
  close = null;
});

beforeEach(() => {
  createMessage.mockReset();
  createMessage.mockResolvedValue(1);
  createSafetyEvent.mockReset();
  createSafetyEvent.mockResolvedValue(1);
  getMessagesByPersonaId.mockReset();
  getMessagesByPersonaId.mockResolvedValue([]);
  setMessageContent.mockReset();
  setMessageContent.mockResolvedValue(true);
  cancelPendingReplyJobs.mockReset();
  cancelPendingReplyJobs.mockResolvedValue(0);
});

describe("the call protocol", () => {
  it("splits a reply into spoken sentences and checks a slot", () => {
    expect(splitCallSentences("一。二！三？")).toEqual(["一。", "二！", "三？"]);
    expect(
      isAnswerSlot([{ weekday: 4, hour: 20 }], new Date("2026-01-15T12:00:00.000Z"), "Asia/Shanghai"),
    ).toBe(true);
    expect(
      isAnswerSlot([{ weekday: 0, hour: 9 }], new Date("2026-01-15T12:00:00.000Z"), "Asia/Shanghai"),
    ).toBe(false);
    // No recorded slot is "no usual time", not "any time".
    expect(
      isAnswerSlot([], new Date("2026-01-15T12:00:00.000Z"), "Asia/Shanghai"),
    ).toBe(false);
  });

  it("refuses an upgrade without this app's origin", async () => {
    const server = createCallOnlyServer(deps());
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port, false)).rejects.toThrow(/http 403/);
  });

  it("refuses a connection without a session cookie", async () => {
    const server = createCallOnlyServer(deps({
      authenticate: vi.fn(async () => {
        throw new Error("no cookie");
      }),
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port)).rejects.toThrow(/http 401/);
  });

  it("refuses an Origin that is not this app", async () => {
    const server = createCallOnlyServer(deps());
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port, "http://evil.example")).rejects.toThrow(/http 403/);
    await expect(connect(port, `ftp://127.0.0.1:${port}`)).rejects.toThrow(/http 403/);
  });

  it("refuses a persona that is not the user's", async () => {
    const server = createCallOnlyServer(deps({
      getPersona: vi.fn(async () => ({ ...persona, userId: 2 })),
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port)).rejects.toThrow(/http 404/);
  });

  it("refuses a persona with the switch off", async () => {
    const server = createCallOnlyServer(deps({
      getPersona: vi.fn(async () => ({ ...persona, settings: { layers: { callMode: false } } })),
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port)).rejects.toThrow(/http 403/);
  });

  it("answers one utterance with transcript, sentences, audio and turn-end", async () => {
    const d = deps();
    const server = createCallOnlyServer(d);
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await waitFor(messages, (m) => m.type === "ready");
    ws.send(Buffer.from("audio"));
    await waitFor(messages, (m) => m.type === "turn-end");
    expect(messages.filter((m) => m.type === "transcript").map((m) => m.text)).toEqual(["在吗"]);
    expect(messages.filter((m) => m.type === "reply").map((m) => m.text)).toEqual([
      "在的。",
      "今天怎么样。",
    ]);
    expect(messages.filter((m) => m.type === "reply").map((m) => m.seq)).toEqual([0, 1]);
    const firstReply = messages.findIndex((m) => m.type === "reply");
    const firstAudio = messages.findIndex((m) => m.binary);
    const secondReply = messages.findIndex(
      (m, index) => m.type === "reply" && index > firstReply,
    );
    expect(firstReply).toBeGreaterThan(messages.findIndex((m) => m.type === "transcript"));
    expect(firstAudio).toBeGreaterThan(firstReply);
    expect(secondReply).toBeGreaterThan(firstAudio);
    expect(messages.filter((m) => m.binary).length).toBe(2);
    expect(d.synthesize).toHaveBeenCalledTimes(2);
  });

  it("stops after an interrupt and keeps only the sentence it sent in the database", async () => {
    let release: () => void = () => {};
    const synth = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Buffer.from("audio");
    });
    /**
     * The real trim path, not a mock: the reply row is rewritten to the
     * sentences that were actually spoken. Only the database writer is
     * mocked, because that is the seam outside the call server.
     */
    getMessagesByPersonaId.mockResolvedValue([
      { id: 77, role: "assistant", createdAt: NOW },
    ] as never);
    const base = deps({
      synthesize: synth,
      converse: vi.fn(async function* () {
        yield { type: "delta", text: "在的。" };
        yield { type: "delta", text: "今天怎么样。" };
        yield { type: "delta", text: "晚上吃什么。" };
        yield { type: "done", messageId: 1, crisis: false };
      }),
    });
    delete (base as Record<string, unknown>).trimReply;
    const server = createCallOnlyServer(base);
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await waitFor(messages, (m) => m.type === "ready");
    ws.send(Buffer.from("audio"));
    await waitFor(messages, (m) => m.type === "reply");
    ws.send(JSON.stringify({ type: "interrupt" }));
    await waitFor(messages, (m) => m.type === "interrupt-ack");
    release();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(messages.filter((m) => m.type === "reply")).toHaveLength(1);
    expect(messages.some((m) => m.type === "turn-end")).toBe(false);
    expect(getMessagesByPersonaId).toHaveBeenCalledWith(5, 1, 5);
    expect(setMessageContent).toHaveBeenCalledWith(77, 1, "在的。");
  });

  it("declines outside the recorded answer slot, and starts again when forced", async () => {
    const withSlots = {
      ...persona,
      styleProfile: callProfile([{ weekday: 0, hour: 9, n: 3 }]),
    };
    const server = createCallOnlyServer(deps({
      getPersona: vi.fn(async () => withSlots),
      now: () => new Date("2026-01-15T12:00:00.000Z"), // 20:00 Shanghai
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    const declined = await waitFor(messages, (m) => m.type === "declined");
    expect(declined.slots).toEqual([{ weekday: 0, hour: 9, n: 3 }]);
    ws.send(JSON.stringify({ type: "start", force: true }));
    await waitFor(messages, (m) => m.type === "ready");
  });

  it("answers a crisis utterance through the real conversation path and records it", async () => {
    /**
     * No `converse` override here: the real conversation path runs, so
     * the crisis detector sees what the user said instead of a preset
     * event. That is the part a mocked `converse` cannot check.
     */
    createMessage.mockResolvedValue(1);
    const base = deps({
      transcribe: vi.fn(async () => ({ text: "我不想活了" })),
    });
    delete (base as Record<string, unknown>).converse;
    const server = createCallOnlyServer(base);
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await waitFor(messages, (m) => m.type === "ready");
    ws.send(Buffer.from("audio"));
    await waitFor(messages, (m) => m.type === "crisis");
    await waitFor(messages, (m) => m.type === "turn-end");
    const replies = messages.filter((m) => m.type === "reply");
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((m) => typeof m.text === "string" && m.text.length > 0)).toBe(true);
    // The crisis answer is still spoken, like any other answer.
    expect(messages.some((m) => m.binary)).toBe(true);
    expect(createSafetyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "crisis", severity: "critical" }),
    );
    const assistant = createMessage.mock.calls.filter(
      (call) => (call[0] as { role?: string }).role === "assistant",
    );
    expect(assistant).toHaveLength(1);
    const stored = String((assistant[0]![0] as { content?: string }).content ?? "");
    expect(stored.length).toBeGreaterThan(0);
    for (const reply of replies) expect(stored).toContain(reply.text);
  });

  it("speaks the projected sentence when the conversation replaces it", async () => {
    const server = createCallOnlyServer(deps({
      converse: vi.fn(async function* () {
        yield { type: "delta", text: "在的。" };
        // B3.4's style projection is delivered as a replacement.
        yield { type: "replace", text: "在的" };
        yield { type: "done", messageId: 1, crisis: false };
      }),
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await waitFor(messages, (m) => m.type === "ready");
    ws.send(Buffer.from("audio"));
    await waitFor(messages, (m) => m.type === "turn-end");
    const replies = messages.filter((m) => m.type === "reply").map((m) => m.text);
    expect(replies).toEqual(["在的"]);
  });

  it("decides whether to pick up from the slots the records measured", async () => {
    // Calls were measured but no hour repeated, so there is no usual
    // time to answer: decline, and let the user force it through.
    const noSlot = { ...persona, styleProfile: callProfile([]) };
    const server = createCallOnlyServer(deps({ getPersona: vi.fn(async () => noSlot) }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    const declined = await waitFor(messages, (m) => m.type === "declined");
    expect(declined.slots).toEqual([]);
    ws.send(JSON.stringify({ type: "start", force: true }));
    await waitFor(messages, (m) => m.type === "ready");
  });

  it("passes the user's own provider to the transcription engine", async () => {
    const transcribe = vi.fn(async () => ({ text: "在吗" }));
    const server = createCallOnlyServer(deps({ transcribe }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    ws.send(Buffer.from("audio"));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "chat", provider: { name: "test" } }),
    );
  });

  it("refuses the upgrade when the provider engine has no provider to use", async () => {
    const server = createCallOnlyServer(
      deps({ resolveProvider: vi.fn(async () => null) }),
    );
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    await expect(connect(port)).rejects.toThrow(/http 503/);
  });

  it("runs two quick utterances one after the other", async () => {
    let n = 0;
    const server = createCallOnlyServer(deps({
      converse: vi.fn(async function* () {
        n += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { type: "delta", text: `第${n}句。` };
        yield { type: "done", messageId: n, crisis: false };
      }),
    }));
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws, messages } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    await waitFor(messages, (m) => m.type === "ready");
    ws.send(Buffer.from("first"));
    ws.send(Buffer.from("second"));
    await waitFor(messages, () => messages.filter((m) => m.type === "turn-end").length >= 2);
    const order = messages
      .map((m) => m.type)
      .filter((type) => type === "transcript" || type === "turn-end");
    expect(order).toEqual(["transcript", "turn-end", "transcript", "turn-end"]);
    expect(messages.filter((m) => m.type === "reply")).toHaveLength(2);
  });

  it("writes a system notice with the call length on hang-up", async () => {
    createMessage.mockReset();
    createMessage.mockResolvedValue(1);
    const server = createCallOnlyServer(deps());
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const { ws } = await connect(port);
    ws.send(JSON.stringify({ type: "start" }));
    ws.send(JSON.stringify({ type: "hangup" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        origin: "system-notice",
        content: "通话 0 分 00 秒",
      }),
    );
  });

  it("refuses a second call from the same user", async () => {
    const server = createCallOnlyServer(deps());
    const port = await server.listen();
    close = () => {
      server.call.close();
      server.server.close();
    };
    const first = await connect(port);
    first.ws.send(JSON.stringify({ type: "start" }));
    await waitFor(first.messages, (m) => m.type === "ready");
    await expect(connect(port)).rejects.toThrow(/http 409/);
  });
});
