import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The usage ledger (C8.9).
 *
 * Every model call has to leave one row, with the reason it was made
 * and the tokens it used. A provider that reports usage is believed
 * (`estimated: false`); a provider that does not is counted locally and
 * the row says so. And a ledger that cannot be written must not change
 * the answer the user gets.
 */
const insertLlmUsage = vi.fn();
const getLlmConfigsByUserId = vi.fn();

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  insertLlmUsage: (...a: unknown[]) => insertLlmUsage(...a),
  getLlmConfigsByUserId: (...a: unknown[]) => getLlmConfigsByUserId(...a),
}));

import { llmService } from "./index";
import type { LLMMessage, LLMProvider, LLMUsage } from "./types";
import {
  costMicrosFor,
  estimateMessagesTokens,
  estimateTokens,
  normalizeUsagePrice,
} from "./usage";

class FakeProvider implements LLMProvider {
  name = "Fake";
  modelName = "fake-model-1";
  capabilities = { streaming: false, vision: false, tools: false, jsonMode: false };
  lastUsage: LLMUsage | null = null;
  constructor(
    private reply: string,
    usage: LLMUsage | null,
  ) {
    this.lastUsage = usage;
  }
  isConfigured() {
    return true;
  }
  async invoke(): Promise<string> {
    return this.reply;
  }
  stream?: (messages: LLMMessage[], options?: unknown) => AsyncIterable<{ text: string }>;
}

const messages: LLMMessage[] = [
  { role: "system", content: "You are somebody's person." },
  { role: "user", content: "在吗" },
];

describe("the usage ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertLlmUsage.mockResolvedValue(undefined);
    getLlmConfigsByUserId.mockResolvedValue([]);
  });

  it("writes one row per call, with the purpose it was made for", async () => {
    const provider = new FakeProvider("在的呀", { promptTokens: 42, completionTokens: 5 });
    const text = await llmService.invokeWithProvider(provider, {
      messages,
      options: { purpose: "reply" },
      usage: { userId: 7, personaId: 3 },
    });
    expect(text).toBe("在的呀");
    expect(insertLlmUsage).toHaveBeenCalledTimes(1);
    expect(insertLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      personaId: 3,
      provider: "Fake",
      model: "fake-model-1",
      purpose: "reply",
      promptTokens: 42,
      completionTokens: 5,
      estimated: false,
    }));
  });

  it("believes the provider's own numbers", async () => {
    const provider = new FakeProvider("嗯", { promptTokens: 1200, completionTokens: 300 });
    await llmService.invokeWithProvider(provider, {
      messages,
      options: { purpose: "classify" },
      usage: { userId: 7 },
    });
    expect(insertLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      estimated: false,
      promptTokens: 1200,
      completionTokens: 300,
    }));
  });

  it("counts the tokens itself when the provider reports none", async () => {
    const provider = new FakeProvider("我不知道你在说什么。", null);
    await llmService.invokeWithProvider(provider, {
      messages,
      options: { purpose: "letter" },
      usage: { userId: 7 },
    });
    const row = insertLlmUsage.mock.calls[0]![0] as Record<string, number | boolean>;
    expect(row.estimated).toBe(true);
    expect(row.promptTokens as number).toBeGreaterThan(0);
    expect(row.completionTokens as number).toBeGreaterThan(0);
  });

  it("does not record a call the caller did not attribute", async () => {
    const provider = new FakeProvider("嗯", { promptTokens: 1, completionTokens: 1 });
    await llmService.invokeWithProvider(provider, { messages, options: { purpose: "eval" } });
    expect(insertLlmUsage).not.toHaveBeenCalled();
  });

  it("returns the answer when the ledger cannot be written", async () => {
    insertLlmUsage.mockRejectedValue(new Error("the database is down"));
    const provider = new FakeProvider("在的", { promptTokens: 3, completionTokens: 2 });
    await expect(
      llmService.invokeWithProvider(provider, {
        messages,
        options: { purpose: "reply" },
        usage: { userId: 7 },
      }),
    ).resolves.toBe("在的");
  });

  it("records a streamed answer once, when it ends", async () => {
    const streamed = new FakeProvider("", null);
    streamed.capabilities = { streaming: true, vision: false, tools: false, jsonMode: false };
    streamed.stream = async function* () {
      yield { text: "晚" };
      yield { text: "安" };
    };
    const chunks: string[] = [];
    for await (const chunk of llmService.streamWithProvider(streamed, {
      messages,
      options: { purpose: "reply" },
      usage: { userId: 7 },
    })) {
      chunks.push(chunk.text);
    }
    expect(chunks).toEqual(["晚", "安"]);
    expect(insertLlmUsage).toHaveBeenCalledTimes(1);
    const row = insertLlmUsage.mock.calls[0]![0] as Record<string, number | boolean>;
    expect(row.estimated).toBe(true);
    expect(row.completionTokens as number).toBeGreaterThan(0);
  });
});

describe("the money", () => {
  it("turns a per-million price into micros", () => {
    const price = { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" };
    // 1,000,000 input tokens at 2 per million is two units.
    expect(costMicrosFor(price, 1_000_000, 0)).toBe(2_000_000);
    // 500,000 output tokens at 8 is four units.
    expect(costMicrosFor(price, 0, 500_000)).toBe(4_000_000);
    expect(costMicrosFor(price, 0, 0)).toBe(0);
  });

  it("stores no cost when the user has not filled in a price", async () => {
    insertLlmUsage.mockResolvedValue(undefined);
    getLlmConfigsByUserId.mockResolvedValue([]);
    const provider = new FakeProvider("嗯", { promptTokens: 10, completionTokens: 10 });
    await llmService.invokeWithProvider(provider, {
      messages,
      options: { purpose: "reply" },
      usage: { userId: 7 },
    });
    expect(insertLlmUsage).toHaveBeenCalledWith(expect.objectContaining({ costMicros: null }));
  });

  it("uses the configured price of the provider that answered", async () => {
    insertLlmUsage.mockResolvedValue(undefined);
    getLlmConfigsByUserId.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        providerName: "fake",
        extraConfig: {
          price: { inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" },
        },
      },
    ]);
    const provider = new FakeProvider("嗯", { promptTokens: 1_000_000, completionTokens: 0 });
    await llmService.invokeWithProvider(provider, {
      messages,
      options: { purpose: "reply" },
      usage: { userId: 7 },
    });
    expect(insertLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      costMicros: 2_000_000,
    }));
  });

  it("reads a stored price, and treats a broken one as none", () => {
    expect(normalizeUsagePrice({ inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" }))
      .toEqual({ inputPerMTok: 2, outputPerMTok: 8, currency: "CNY" });
    expect(normalizeUsagePrice({ inputPerMTok: 2 })).toBeNull();
    expect(normalizeUsagePrice({ inputPerMTok: -1, outputPerMTok: 1, currency: "CNY" })).toBeNull();
    expect(normalizeUsagePrice({ inputPerMTok: 1, outputPerMTok: 1 })).toBeNull();
    expect(normalizeUsagePrice("2")).toBeNull();
    expect(normalizeUsagePrice(null)).toBeNull();
  });

  it("estimates tokens for text and for a message list", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("在的呀")).toBeGreaterThan(0);
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(estimateTokens("在吗"));
  });
});
