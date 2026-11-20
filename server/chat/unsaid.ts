/**
 * Finishing one of their unfinished sentences (C6.5).
 *
 * This is the one place in the goodbye that calls a model for a line the
 * person never said, and it is deliberately small:
 *
 *   - the user asks for one line, from one record;
 *   - the line is written with the persona's own prompt, with the record
 *     line fenced as material;
 *   - the call carries a guard that says the sentence is for the user
 *     only, and that the persona must not decide or promise anything on
 *     the real person's behalf;
 *   - a line that still contains a promise or a decision is dropped;
 *   - nothing is written down.
 *
 * The structural test `server/records/unsaid-no-exit.test.ts` holds the
 * other half of that promise: these files have no way to send anything
 * anywhere.
 */
import type { Persona } from "../../drizzle/schema";
import { buildSystemPrompt } from "../_core/persona-utils";
import { llmService } from "../llm";
import { resolveProviderForUserWithOwnership } from "../llm/user-provider";
import { copy } from "@shared/copy";
import { asMaterial } from "@shared/material";
import { containsCommitment } from "@shared/rehearsal";

export interface CompleteUnfinishedParams {
  persona: Persona;
  userId: number;
  line: string;
  /** The lines just before it, so the continuation has the exchange. */
  context?: string[];
  locale?: "zh" | "en";
}

/**
 * The messages for one continuation.
 *
 * Exported so the fence test can hold the line without a provider.
 */
export function buildUnsaidMessages(params: {
  persona: Persona;
  line: string;
  context?: string[];
  locale?: "zh" | "en";
}): Array<{ role: "system" | "user"; content: string }> {
  const locale = params.locale ?? "zh";
  const trimmed = String(params.line ?? "").trim();
  const context = (params.context ?? [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .slice(-2);
  const material = [...context, trimmed].join("\n");
  return [
    {
      role: "system",
      content: buildSystemPrompt(params.persona, {
        locale,
        guardInstruction: copy(locale, "prompt.unsaidGuard", {
          name: params.persona.name,
        }),
      }),
    },
    {
      role: "user",
      content: `${copy(locale, "prompts.unsaidComplete")}\n${asMaterial(material, locale)}`,
    },
  ];
}

/**
 * Writes one line after the unfinished one.
 *
 * Returns `null` when there is no provider, when the call fails, or when
 * what came back is a promise or a decision on the real person's behalf.
 * A null is shown honestly: this line could not be finished.
 */
export async function completeUnfinishedLine(
  params: CompleteUnfinishedParams,
): Promise<string | null> {
  const { persona, userId, line } = params;
  const locale = params.locale ?? "zh";
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return null;

  const messages = buildUnsaidMessages({ ...params, locale });

  let text: string | null = null;
  try {
    const resolved = await resolveProviderForUserWithOwnership({
      userId,
      providerName: persona.llmProvider ?? undefined,
    });
    if (resolved.provider) {
      const answer = await resolved.provider.invoke(messages, { purpose: "reply" });
      text = answer ?? null;
    } else {
      text = await llmService.invoke({
        messages,
        options: { purpose: "reply" },
      });
    }
  } catch (error) {
    console.warn(
      "[Unsaid] The line could not be finished:",
      (error as Error)?.message ?? error,
    );
    return null;
  }

  const answer = String(text ?? "").trim().replace(/^["“「]|["”」]$/g, "").trim();
  if (!answer) return null;
  /**
   * The guard asked for no promise, and the model may still have made
   * one. A line that decides something for the real person is exactly
   * the thing this feature is not allowed to produce, so it is dropped
   * rather than shown with a warning.
   */
  if (containsCommitment(answer)) return null;
  return answer;
}
