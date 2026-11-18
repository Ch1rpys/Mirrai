import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai";
import { ClaudeProvider } from "./claude";
import { OllamaProvider } from "./ollama";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const messages = [{ role: "user" as const, content: "在吗" }];
const stop = ["\n"];

function requestBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

describe("stop sequences on the request", () => {
  it("sends stop on the OpenAI chat body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider(
      "OpenAI",
      "sk-test",
      "https://example.invalid/v1",
      "gpt-4o",
    );
    await provider.invoke(messages, { stop });
    expect(requestBody().stop).toEqual(["\n"]);
  });

  it("sends stop_sequences on the Claude messages body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke(messages, { stop });
    const body = requestBody();
    expect(body.stop_sequences).toEqual(["\n"]);
    expect(body.stop).toBeUndefined();
  });

  it("puts stop on Ollama options", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "在" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    await provider.invoke(messages, { stop, temperature: 0.2 });
    const body = requestBody();
    expect(body.options).toEqual({ temperature: 0.2, stop: ["\n"] });
  });

  it("omits stop when the list is empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider(
      "OpenAI",
      "sk-test",
      "https://example.invalid/v1",
      "gpt-4o",
    );
    await provider.invoke(messages, { stop: [] });
    expect(requestBody().stop).toBeUndefined();
  });
});

describe("sampling and extraBody on the request", () => {
  it("puts the three sampling fields on the OpenAI chat body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    await provider.invoke(messages, {
      topP: 0.9,
      presencePenalty: 0.2,
      frequencyPenalty: 0.1,
    });
    const body = requestBody();
    expect(body.top_p).toBe(0.9);
    expect(body.presence_penalty).toBe(0.2);
    expect(body.frequency_penalty).toBe(0.1);
  });

  it("merges extraBody into the OpenAI chat body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    await provider.invoke(messages, { extraBody: { enable_thinking: false } });
    expect(requestBody().enable_thinking).toBe(false);
  });

  it("does not let extraBody replace model, messages, stream or tools", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    await provider.invoke(messages, {
      extraBody: { model: "other", messages: [], stream: true, tools: [], enable_thinking: false },
    });
    const body = requestBody();
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(Array.isArray(body.messages)).toBe(true);
    expect((body.messages as unknown[]).length).toBeGreaterThan(0);
    expect(body.enable_thinking).toBe(false);
  });

  it("sends top_p on the Claude messages body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke(messages, { topP: 0.8 });
    const body = requestBody();
    expect(body.top_p).toBe(0.8);
    expect(body.presence_penalty).toBeUndefined();
  });

  it("maps frequencyPenalty onto Ollama repeat_penalty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "在" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    await provider.invoke(messages, { topP: 0.9, frequencyPenalty: 0.5 });
    expect(requestBody().options).toEqual({ top_p: 0.9, repeat_penalty: 1.5 });
  });
});
