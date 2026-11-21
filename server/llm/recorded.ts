/**
 * One raw provider call that also lands on the usage ledger (C8.9).
 *
 * Most call sites go through `llmService.invokeWithProvider`, which
 * records for them. A few hold a provider instance directly (a user's
 * own provider resolved for one feature) and used to call
 * `provider.invoke` — and those calls never reached the ledger. This
 * helper keeps the exact call shape (so the tests that stub
 * `provider.invoke` still see it) and writes the row afterwards.
 */
import type { InvokeParams, LLMProvider, LlmPurpose } from "./types";
import { recordLlmCall } from "./usage";

export async function invokeAndRecord(
  provider: LLMProvider,
  params: InvokeParams,
  purpose: LlmPurpose,
): Promise<string> {
  const text = await provider.invoke(params.messages, {
    ...params.options,
    purpose: params.options?.purpose ?? purpose,
  });
  const calledPurpose = params.options?.purpose ?? purpose;
  if (params.usage) {
    await recordLlmCall({
      usage: params.usage,
      provider,
      purpose: calledPurpose,
      messages: params.messages,
      output: typeof text === "string" ? text : "",
    });
  }
  return typeof text === "string" ? text : "";
}
