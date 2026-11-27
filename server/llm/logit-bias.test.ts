/**
 * The token bias and the two request fields it needs (B9.3).
 *
 * The failure this file guards against is a bias built on the wrong
 * tokenizer: token ids are only meaningful for the vocabulary the model
 * was trained with, so an unknown model name must produce no bias at all
 * rather than a plausible-looking object.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodingForModel } from "js-tiktoken";
import {
  LOGIT_BIAS_MAX_ITEMS,
  LOGIT_BIAS_VALUE,
  bannedWordsForPersona,
  buildLogitBias,
  isOfficialOpenAiEndpoint,
  providerSupportsGrammar,
  providerSupportsLogitBias,
} from "./logit-bias";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function requestBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

describe("buildLogitBias", () => {
  it("bans a one-token string at the floor", () => {
    expect(encodingForModel("gpt-4o").encode("呢")).toHaveLength(1);
    expect(buildLogitBias({ model: "gpt-4o", banned: ["呢"] })).toEqual({
      [String(encodingForModel("gpt-4o").encode("呢")[0])]: LOGIT_BIAS_VALUE,
    });
  });

  it("skips a string that would take more than one token", () => {
    expect(encodingForModel("gpt-4o").encode("呵呵").length).toBeGreaterThan(1);
    expect(buildLogitBias({ model: "gpt-4o", banned: ["呵呵"] })).toEqual({});
  });

  it("caps the list at forty entries", () => {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const bias = buildLogitBias({ model: "gpt-4o", banned: letters });
    expect(Object.keys(bias)).toHaveLength(LOGIT_BIAS_MAX_ITEMS);
    expect(Object.values(bias).every((value) => value === LOGIT_BIAS_VALUE)).toBe(true);
  });

  it("returns nothing for a model whose tokenizer it does not know", () => {
    expect(buildLogitBias({ model: "deepseek-chat", banned: ["呢"] })).toEqual({});
    expect(buildLogitBias({ model: "", banned: ["呢"] })).toEqual({});
  });
});

describe("bannedWordsForPersona", () => {
  function persona(suppressions: unknown = []) {
    return {
      styleProfile: {
        version: 1,
        measuredAt: "2026-01-01T00:00:00.000Z",
        recordsVersion: "1200:1200",
        fingerprint: { samples: 1200, never: ["呢", "～"] },
      },
      personaData: { suppressions },
    };
  }

  it("takes the measured never list and the confirmed subtractions", () => {
    const words = bannedWordsForPersona(
      persona([
        { id: "a", kind: "no_phrase", pattern: "好的呢", verified: true, source: "manual", evidence: [] },
        { id: "b", kind: "no_phrase", pattern: "我理解你", verified: false, source: "auto", evidence: [] },
        { id: "c", kind: "no_advice", pattern: "建议你", verified: true, source: "manual", evidence: [] },
      ]),
    );
    expect(words).toContain("呢");
    expect(words).toContain("～");
    expect(words).toContain("好的呢");
    // Unconfirmed candidates stay in the editor.
    expect(words).not.toContain("我理解你");
    // Only the "never says this word" class becomes a bias.
    expect(words).not.toContain("建议你");
  });

  it("is empty for a persona with no measurement", () => {
    expect(bannedWordsForPersona({ personaData: {} })).toEqual([]);
  });
});

describe("provider capability", () => {
  it("treats the official OpenAI address as supported", () => {
    expect(isOfficialOpenAiEndpoint({ providerName: "OpenAI", baseUrl: "https://api.openai.com/v1" })).toBe(true);
    expect(isOfficialOpenAiEndpoint({ providerName: "openai", baseUrl: null })).toBe(true);
    expect(providerSupportsLogitBias({ providerName: "OpenAI", baseUrl: "https://api.openai.com/v1" })).toBe(true);
  });

  it("treats a compatible gateway and another vendor as unsupported by default", () => {
    expect(providerSupportsLogitBias({ providerName: "OpenAI", baseUrl: "https://proxy.example.com/v1" })).toBe(false);
    expect(providerSupportsLogitBias({ providerName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" })).toBe(false);
    expect(providerSupportsLogitBias({ providerName: "Ollama", baseUrl: "http://localhost:11434" })).toBe(false);
  });

  it("lets the user's own configuration decide", () => {
    expect(
      providerSupportsLogitBias({
        providerName: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        extraConfig: { supportsLogitBias: false },
      }),
    ).toBe(false);
    expect(
      providerSupportsLogitBias({
        providerName: "OpenAI",
        baseUrl: "http://127.0.0.1:8080/v1",
        extraConfig: { supportsLogitBias: true },
      }),
    ).toBe(true);
  });

  it("has no grammar default", () => {
    expect(providerSupportsGrammar({ providerName: "OpenAI", baseUrl: "https://api.openai.com/v1" })).toBe(false);
    expect(
      providerSupportsGrammar({
        providerName: "OpenAI",
        baseUrl: "http://127.0.0.1:8080/v1",
        extraConfig: { supportsGrammar: true },
      }),
    ).toBe(true);
  });
});

describe("the request field", () => {
  const messages = [{ role: "user" as const, content: "在吗" }];
  const logitBias = { "1234": -100 };

  it("sends logit_bias on the OpenAI body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    await provider.invoke(messages, { logitBias });
    expect(requestBody().logit_bias).toEqual(logitBias);
  });

  it("leaves the field out when no bias applies", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIProvider("OpenAI", "sk-test", "https://example.invalid/v1", "gpt-4o");
    await provider.invoke(messages, {});
    expect(requestBody().logit_bias).toBeUndefined();
  });

  it("is not sent by a provider with another wire shape", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "在" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider("sk-test", "claude-sonnet-4-6", "https://example.invalid");
    await provider.invoke(messages, { logitBias });
    expect(requestBody().logit_bias).toBeUndefined();
  });
});
