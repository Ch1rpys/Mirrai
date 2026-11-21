/**
 * What the model calls cost (C8.9).
 *
 * The app spends money on every reply and had no record of it. This
 * module turns one finished call into one row: who it was for, why it
 * was made, how many tokens it used, and what it cost when the user has
 * filled in a price.
 *
 * Two rules the handbook sets, and they are the reason this is one
 * small module rather than a line in each call site:
 *
 * - The provider's own numbers win. When it does not report any, the
 *   tokens are counted locally with the same tokenizer OpenAI uses, and
 *   the row is marked `estimated: true`.
 * - Writing the row must never affect the call. A logging failure is a
 *   warning, not an error.
 */
import { getEncoding } from "js-tiktoken";
import type { LLMMessage, LLMProvider, LlmPurpose, LlmUsageContext } from "./types";
import { getTextContent } from "./types";
import { getLlmConfigsByUserId, insertLlmUsage } from "../db";

/** A price the user filled in for one provider. */
export interface UsagePrice {
  inputPerMTok: number;
  outputPerMTok: number;
  currency: string;
}

/** The tokenizer, built once. */
let encoder: ReturnType<typeof getEncoding> | null = null;
let encoderFailed = false;

function tokenizer(): ReturnType<typeof getEncoding> | null {
  if (encoder) return encoder;
  if (encoderFailed) return null;
  try {
    encoder = getEncoding("cl100k_base");
    return encoder;
  } catch {
    // The tokenizer is bundled; if it cannot be built the estimate
    // degrades to a character count rather than failing the call.
    encoderFailed = true;
    return null;
  }
}

/** How many tokens a piece of text is, counted locally. */
export function estimateTokens(text: string): number {
  const value = String(text ?? "");
  if (!value) return 0;
  const tokens = tokenizer();
  if (tokens) return tokens.encode(value).length;
  return Math.max(1, Math.ceil(value.length / 4));
}

/** How many tokens the messages of one request are. */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return (messages ?? []).reduce(
    (sum, message) => sum + estimateTokens(getTextContent(message.content)) + 4,
    0,
  );
}

/**
 * A stored price, or null.
 *
 * The shape comes from `llm_configs.extraConfig.price`; anything
 * malformed is treated as "no price" rather than as zero, so a typo
 * cannot make the panel report that everything was free.
 */
export function normalizeUsagePrice(value: unknown): UsagePrice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const input = Number(record.inputPerMTok);
  const output = Number(record.outputPerMTok);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  const currency = typeof record.currency === "string" ? record.currency.trim() : "";
  if (!currency || currency.length > 8) return null;
  return { inputPerMTok: input, outputPerMTok: output, currency };
}

/**
 * The cost of one call, in millionths of the price's currency.
 *
 * `inputPerMTok: 2` and 1,000,000 input tokens cost two units — which
 * is 2,000,000 micros. So one token costs one micro per unit of
 * "per million" price, and the arithmetic is a multiplication.
 */
export function costMicrosFor(
  price: UsagePrice,
  promptTokens: number,
  completionTokens: number,
): number {
  const micros =
    Math.max(0, promptTokens) * price.inputPerMTok +
    Math.max(0, completionTokens) * price.outputPerMTok;
  return Math.round(micros);
}

/** The user's price for a provider, when they set one. */
export async function priceForProvider(
  userId: number,
  providerName: string,
): Promise<UsagePrice | null> {
  try {
    const configs = await getLlmConfigsByUserId(userId);
    const wanted = providerName.toLowerCase();
    const config = configs.find(
      (row) => String(row.providerName ?? "").toLowerCase() === wanted,
    );
    const extra = config?.extraConfig as { price?: unknown } | null | undefined;
    return normalizeUsagePrice(extra?.price);
  } catch {
    return null;
  }
}

/** The price of the provider a background run will use, if one is set. */
export async function priceForDefaultProvider(userId: number): Promise<UsagePrice | null> {
  try {
    const configs = await getLlmConfigsByUserId(userId);
    const config = configs.find((row) => row.isDefault) ?? configs[0];
    const extra = config?.extraConfig as { price?: unknown } | null | undefined;
    return normalizeUsagePrice(extra?.price);
  } catch {
    return null;
  }
}

/**
 * A rough cost for a run that has not happened yet.
 *
 * A distillation reads `chars` characters of material and writes about
 * `calls × 400` tokens of observations. Both numbers are estimates and
 * the interface says so; this is an early warning, not a bill.
 */
export function estimateRunCostMicros(
  price: UsagePrice,
  chars: number,
  calls: number,
): number {
  const promptTokens = Math.max(0, chars);
  const completionTokens = Math.max(0, calls) * 400;
  return costMicrosFor(price, promptTokens, completionTokens);
}

/**
 * Records one finished call.
 *
 * Never throws: the call has already succeeded (or failed) and its
 * outcome must not change because the ledger could not be written.
 */
export async function recordLlmCall(params: {
  usage: LlmUsageContext;
  provider: LLMProvider;
  purpose: LlmPurpose;
  messages: LLMMessage[];
  output: string;
}): Promise<void> {
  try {
    const reported = params.provider.lastUsage;
    const estimated = !(
      reported &&
      Number.isFinite(reported.promptTokens) &&
      Number.isFinite(reported.completionTokens)
    );
    const promptTokens = estimated
      ? estimateMessagesTokens(params.messages)
      : reported!.promptTokens;
    const completionTokens = estimated
      ? estimateTokens(params.output)
      : reported!.completionTokens;
    const price = await priceForProvider(params.usage.userId, params.provider.name);
    const costMicros = price
      ? costMicrosFor(price, promptTokens, completionTokens)
      : null;
    await insertLlmUsage({
      userId: params.usage.userId,
      personaId: params.usage.personaId ?? null,
      provider: params.provider.name.slice(0, 64),
      model: String(params.provider.modelName ?? params.provider.name).slice(0, 128),
      purpose: params.purpose,
      promptTokens,
      completionTokens,
      estimated,
      costMicros,
      jobId: params.usage.jobId ?? null,
    });
  } catch (error) {
    console.warn(
      "[Usage] The call could not be recorded:",
      (error as Error)?.message ?? error,
    );
  }
}
