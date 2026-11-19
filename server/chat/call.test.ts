import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createCallOnlyServer, isAnswerSlot, splitCallSentences } from "./call";

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

const persona = {
  id: 5,
  userId: 1,
  name: "小满",
  timezone: "Asia/Shanghai",
  settings: { layers: { callMode: true } },
  styleProfile: callProfile([]),
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn(async () => ({ id: 1, name: "阿树", timezone: "Asia/Shanghai" })),
    getPersona: vi.fn(async () => persona),
    transcribe: vi.fn(async () => ({ text: "在吗" })),
    synthesize: vi.fn(async () => Buffer.from("audio")),
    converse: vi.fn(async function* () {
      yield { type: "delta", text: "在的。" };
      yield { type: "delta", text: "今天怎么样。" };
      yield { type: "done", messageId: 1, crisis: false };
    }),
    trimReply: vi.fn(async () => {}),
    now: () => new Date("2026-01-15T12:00:00.000Z"),
    ...overrides,
  };
}

let close: (() => void) | null = null;

async function connect(port: number, origin = true): Promise<{ ws: WebSocket; messages: any[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/call?personaId=5`, {
    headers: origin ? { Origin: `http://127.0.0.1:${port}` } : {},
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

describe("the call protocol", () => {
  it("splits a reply into spoken sentences and checks a slot", () => {
    expect(splitCallSentences("一。二！三？")).toEqual(["一。", "二！", "三？"]);
    expect(
      isAnswerSlot([{ weekday: 4, hour: 20 }], new Date("2026-01-15T12:00:00.000Z"), "Asia/Shanghai"),
    ).toBe(true);
    expect(
      isAnswerSlot([{ weekday: 0, hour: 9 }], new Date("2026-01-15T12:00:00.000Z"), "Asia/Shanghai"),
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
    expect(messages.filter((m) => m.binary).length).toBe(2);
    expect(d.synthesize).toHaveBeenCalledTimes(2);
  });

  it("stops after an interrupt and keeps only what was sent", async () => {
    let release: () => void = () => {};
    const synth = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Buffer.from("audio");
    });
    const trimReply = vi.fn(async () => {});
    const server = createCallOnlyServer(deps({ synthesize: synth, trimReply }));
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messages.filter((m) => m.type === "reply")).toHaveLength(1);
    expect(messages.some((m) => m.type === "turn-end")).toBe(false);
    expect(trimReply).toHaveBeenCalledWith(5, 1, expect.any(Date), "在的。");
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

  it("tells the client when the utterance hit a crisis", async () => {
    const server = createCallOnlyServer(deps({
      converse: vi.fn(async function* () {
        yield { type: "delta", text: "我先陪你。" };
        yield { type: "done", messageId: 1, crisis: true };
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
    await waitFor(messages, (m) => m.type === "crisis");
    expect(messages.some((m) => m.type === "crisis")).toBe(true);
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
