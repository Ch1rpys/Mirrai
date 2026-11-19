import { describe, expect, it, vi, afterEach } from "vitest";
import { streamChat } from "./chat-stream";
import { translate } from "@/i18n";

/**
 * The frame-parsing helpers are unit-tested elsewhere. What matters here is
 * that the whole round trip works: the client posts to the streaming
 * endpoint, reads the event stream, and hands the caller the same text the
 * server produced — token by token.
 */

/** A response whose body is a sequence of chunks, delivered as they arrive. */
function mockSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;

  const body = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    body,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("streamChat", () => {
  it("delivers the reply token by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: delta\ndata: {"text":"在"}\n\n',
        'event: delta\ndata: {"text":"的"}\n\n',
        'event: emotion\ndata: {"state":"warm"}\n\n',
        'event: done\ndata: {"messageId":7,"emotionalState":"warm","graduationSuggested":false,"careNote":null,"crisis":false}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;

    const deltas: string[] = [];
    let done: any = null;
    let emotion: string | undefined;

    await streamChat({
      personaId: 1,
      message: "在吗",
      callbacks: {
        onDelta: (text) => deltas.push(text),
        onEmotion: (state) => { emotion = state; },
        onDone: (info) => { done = info; },
      },
    });

    expect(deltas).toEqual(["在", "的"]);
    expect(deltas.join("")).toBe("在的");
    expect(emotion).toBe("warm");
    expect(done?.messageId).toBe(7);
    expect(done?.emotionalState).toBe("warm");
  });

  it("hands a choice event to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: choice\ndata: {"options":["好的呀","好的。"],"replyToMessageId":7}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;
    let choice: { options: [string, string]; replyToMessageId: number } | null = null;
    await streamChat({
      personaId: 1,
      message: "在吗",
      callbacks: {
        onDelta: () => {},
        onChoice: (info) => { choice = info; },
      },
    });
    expect(choice).toEqual({
      options: ["好的呀", "好的。"],
      replyToMessageId: 7,
    });
  });

  it("hands a superseded event to the caller and does not treat it as a drop", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: delta\ndata: {"text":"在"}\n\n',
        "event: superseded\ndata: {}\n\n",
      ]),
    );
    globalThis.fetch = fetchMock as any;
    const deltas: string[] = [];
    const errors: string[] = [];
    let superseded = 0;
    await streamChat({
      personaId: 1,
      message: "在吗",
      callbacks: {
        onDelta: (text) => deltas.push(text),
        onError: (message) => errors.push(message),
        onSuperseded: () => { superseded += 1; },
      },
    });
    expect(deltas).toEqual(["在"]);
    expect(superseded).toBe(1);
    expect(errors).toEqual([]);
  });

  it("posts the message and the locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse([]));
    globalThis.fetch = fetchMock as any;

    await streamChat({
      personaId: 3,
      message: "hello",
      locale: "en",
      callbacks: { onDelta: () => {} },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      personaId: 3,
      message: "hello",
      locale: "en",
    });
  });

  it("hands thinking, silence and burst events to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: thinking\ndata: {"notice":"在想"}\n\n',
        'event: delay\ndata: {"ms":0}\n\n',
        'event: burst\ndata: {"texts":["嗯","在"]}\n\n',
        'event: silence\ndata: {"notice":"TA 这会儿没回"}\n\n',
        'event: done\ndata: {"messageId":8,"emotionalState":"warm","graduationSuggested":false,"careNote":null,"crisis":false}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;

    const thinking: string[] = [];
    const bursts: string[][] = [];
    const silences: string[] = [];
    const delays: number[] = [];
    await streamChat({
      personaId: 1,
      message: "在吗",
      periodId: "period-1",
      callbacks: {
        onDelta: () => {},
        onThinking: (notice) => thinking.push(notice),
        onDelay: (ms) => { delays.push(ms); },
        onBurst: (texts) => bursts.push(texts),
        onSilence: (notice) => silences.push(notice),
      },
    });
    expect(thinking).toEqual(["在想"]);
    expect(delays).toEqual([0]);
    expect(bursts).toEqual([["嗯", "在"]]);
    expect(silences).toEqual(["TA 这会儿没回"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).periodId).toBe("period-1");
  });

  it("hands a replace event to the caller", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: delta\ndata: {"text":"好的。"}\n\n',
        'event: replace\ndata: {"text":"好的"}\n\n',
        'event: done\ndata: {"messageId":9,"emotionalState":"warm","graduationSuggested":false,"careNote":null,"crisis":false}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;
    const replaced: string[] = [];
    await streamChat({
      personaId: 1,
      message: "在吗",
      callbacks: {
        onDelta: () => {},
        onReplace: (text) => replaced.push(text),
      },
    });
    expect(replaced).toEqual(["好的"]);
  });

  it("reassembles a frame that arrives split across chunks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: delta\ndata: {"text":"hel',
        'lo"}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;

    const deltas: string[] = [];
    await streamChat({
      personaId: 1,
      message: "hi",
      callbacks: { onDelta: (text) => deltas.push(text) },
    });

    expect(deltas.join("")).toBe("hello");
  });

  it("reports an error event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse([
        'event: delta\ndata: {"text":"我"}\n\n',
        'event: error\ndata: {"message":"upstream exploded","partial":true}\n\n',
      ]),
    );
    globalThis.fetch = fetchMock as any;

    const errors: Array<{ message: string; partial: boolean }> = [];
    const deltas: string[] = [];

    await streamChat({
      personaId: 1,
      message: "hi",
      callbacks: {
        onDelta: (text) => deltas.push(text),
        onError: (message, partial) => errors.push({ message, partial }),
      },
    });

    // The partial text is kept — half an answer is still worth something.
    expect(deltas.join("")).toBe("我");
    expect(errors).toEqual([{ message: "upstream exploded", partial: true }]);
  });

  it("says the error in the reader's language when there is no sentence", async () => {
    /**
     * The fallback was a hard-coded English "Unknown error", in a
     * message that is otherwise in the reader's language: so a Chinese
     * reader saw "生成中断：Unknown error".
     */
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse(['event: error\ndata: {}\n\n']),
    );
    globalThis.fetch = fetchMock as any;

    const errors: Array<{ message: string; partial: boolean }> = [];
    await streamChat({
      personaId: 1,
      message: "hi",
      locale: "zh",
      callbacks: {
        onDelta: () => {},
        onError: (message, partial) => errors.push({ message, partial }),
      },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).not.toContain("Unknown error");
    expect(errors[0].message).toBe(translate("zh", "errors.unknown"));
  });

  it("reports a stream that ends before the reply is finished", async () => {
    // The connection drops mid-reply: the body ends, and no `done` ever
    // arrives. The bubble was then left streaming for ever.
    const fetchMock = vi.fn().mockResolvedValue(
      mockSseResponse(['event: delta\ndata: {"text":"我"}\n\n']),
    );
    globalThis.fetch = fetchMock as any;

    const errors: Array<{ message: string; partial: boolean }> = [];
    const deltas: string[] = [];

    await streamChat({
      personaId: 1,
      message: "hi",
      callbacks: {
        onDelta: (text) => deltas.push(text),
        onError: (message, partial) => errors.push({ message, partial }),
      },
    });

    // What arrived is kept, and the user is told it was cut short.
    expect(deltas.join("")).toBe("我");
    expect(errors).toHaveLength(1);
    expect(errors[0].partial).toBe(true);
  });

  it("throws with the status when the server refuses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse([], 500));
    globalThis.fetch = fetchMock as any;

    await expect(
      streamChat({ personaId: 1, message: "hi", callbacks: { onDelta: () => {} } }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("passes the abort signal to the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockSseResponse([]));
    globalThis.fetch = fetchMock as any;

    const controller = new AbortController();
    await streamChat({
      personaId: 1,
      message: "hi",
      signal: controller.signal,
      callbacks: { onDelta: () => {} },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(controller.signal);
  });
});
