/**
 * The tool fields on the three adapters that have them (C9.4).
 *
 * Two things are being pinned here. First, a request that carries tools
 * puts them in the body in the provider's own shape — and a request
 * without tools has exactly the body it had before this existed.
 * Second, the calls the model asks for are read back out.
 *
 * Shapes checked against the official references on 2026-11-24:
 *   OpenAI:  https://github.com/openai/openai-openapi/blob/main/openapi.yaml
 *            https://platform.openai.com/docs/api-reference/chat/create
 *   Claude:  https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts
 *   Ollama:  https://docs.ollama.com/api/chat
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai";
import { ClaudeProvider } from "./claude";
import { OllamaProvider } from "./ollama";
import type { LLMToolDef } from "../types";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function requestBody(): Record<string, any> {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, any>;
}

const weatherTool: LLMToolDef = {
  name: "get_weather",
  description: "Look at the weather.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
};

const messages = [{ role: "user" as const, content: "在吗" }];

function openai(answer: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
}

describe("tools on the OpenAI chat body", () => {
  it("sends tools, the choice and the JSON format in the provider's shape", async () => {
    const provider = openai({ choices: [{ message: { content: "在" } }] });
    await provider.invoke(messages, {
      tools: [weatherTool],
      toolChoice: "auto",
      responseFormat: "json",
    });
    const body = requestBody();
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Look at the weather.",
          parameters: weatherTool.parameters,
        },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sends a named tool choice as the function object", async () => {
    const provider = openai({ choices: [{ message: { content: "在" } }] });
    await provider.invoke(messages, { tools: [weatherTool], toolChoice: { name: "get_weather" } });
    expect(requestBody().tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("leaves the body unchanged when there is no tool", async () => {
    const provider = openai({ choices: [{ message: { content: "在" } }] });
    await provider.invoke(messages);
    const body = requestBody();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "temperature"]);
  });

  it("reads the calls the answer asked for", async () => {
    const provider = openai({
      choices: [{
        message: {
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: "{\"city\":\"上海\"}" },
            },
          ],
        },
      }],
    });
    const text = await provider.invoke(messages, { tools: [weatherTool] });
    expect(text).toBe("");
    expect(provider.lastToolCalls).toEqual([
      { id: "call_1", name: "get_weather", arguments: "{\"city\":\"上海\"}" },
    ]);
  });

  it("clears the calls on the next answer that has none", async () => {
    const provider = openai({
      choices: [{
        message: {
          tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: "{}" } }],
        },
      }],
    });
    await provider.invoke(messages, { tools: [weatherTool] });
    expect(provider.lastToolCalls).toHaveLength(1);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在的" } }] }), { status: 200 }),
    );
    await provider.invoke(messages);
    expect(provider.lastToolCalls).toBeNull();
  });

  it("turns an assistant tool call and its result into OpenAI's two messages", async () => {
    const provider = openai({ choices: [{ message: { content: "在" } }] });
    await provider.invoke([
      { role: "user", content: "外面冷吗" },
      {
        role: "assistant",
        content: "我看看",
        toolCalls: [{ id: "call_1", name: "get_weather", arguments: "{\"city\":\"上海\"}" }],
      },
      { role: "tool", content: "12 degrees", toolCallId: "call_1", toolName: "get_weather" },
    ]);
    const sent = requestBody().messages as Array<Record<string, unknown>>;
    expect(sent[1]).toEqual({
      role: "assistant",
      content: "我看看",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: "{\"city\":\"上海\"}" },
      }],
    });
    expect(sent[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "12 degrees" });
  });
});

describe("tools on the Claude messages body", () => {
  it("sends the schema as input_schema and the choice as an object", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke(messages, { tools: [weatherTool], toolChoice: "auto" });
    const body = requestBody();
    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "Look at the weather.",
        input_schema: weatherTool.parameters,
      },
    ]);
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("names a forced tool and leaves the field out when tools are off", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke(messages, { tools: [weatherTool], toolChoice: { name: "get_weather" } });
    expect(requestBody().tool_choice).toEqual({ type: "tool", name: "get_weather" });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    await provider.invoke(messages, { tools: [weatherTool], toolChoice: "none" });
    expect(requestBody().tools).toBeUndefined();
    expect(requestBody().tool_choice).toBeUndefined();
  });

  it("reads text and tool_use blocks out of one answer", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      content: [
        { type: "text", text: "我查一下" },
        { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "上海" } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    const text = await provider.invoke(messages, { tools: [weatherTool] });
    expect(text).toBe("我查一下");
    expect(provider.lastToolCalls).toEqual([
      { id: "toolu_1", name: "get_weather", arguments: "{\"city\":\"上海\"}" },
    ]);
  });

  it("sends a tool call back as blocks and its result as a user message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke([
      { role: "user", content: "外面冷吗" },
      {
        role: "assistant",
        content: "我看看",
        toolCalls: [{ id: "toolu_1", name: "get_weather", arguments: "{\"city\":\"上海\"}" }],
      },
      { role: "tool", content: "12 degrees", toolCallId: "toolu_1" },
    ]);
    const sent = requestBody().messages as Array<{ role: string; content: any }>;
    expect(sent[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "我看看" },
        { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "上海" } },
      ],
    });
    expect(sent[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "12 degrees" }],
    });
  });

  it("merges two tool results into one user message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke([
      { role: "user", content: "两件事" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "toolu_1", name: "a", arguments: "{}" },
          { id: "toolu_2", name: "b", arguments: "{}" },
        ],
      },
      { role: "tool", content: "one", toolCallId: "toolu_1" },
      { role: "tool", content: "two", toolCallId: "toolu_2" },
    ]);
    const sent = requestBody().messages as Array<{ role: string; content: any }>;
    expect(sent).toHaveLength(3);
    expect(sent[2].role).toBe("user");
    expect(sent[2].content).toHaveLength(2);
  });
});

describe("the JSON mode on Ollama", () => {
  it("puts format: json on the body when the caller asks", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    await provider.invoke(messages, { responseFormat: "json" });
    expect(requestBody().format).toBe("json");
  });

  it("leaves format out otherwise, and never sends tools", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "在" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://localhost:11434", "llama3");
    await provider.invoke(messages, { tools: [weatherTool], toolChoice: "auto" });
    const body = requestBody();
    expect(body.format).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});
