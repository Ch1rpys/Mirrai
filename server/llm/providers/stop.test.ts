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
