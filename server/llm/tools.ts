/**
 * One request that may call tools, run them, and ask again (C9.4).
 *
 * The model asking for a tool is a question, not an answer: the app has
 * to check the arguments, run the thing, hand the result back, and let
 * the model speak. Doing that by hand at every call site produced the
 * same three bugs — unvalidated arguments, a crash that ended the whole
 * turn, and a result pasted into the prompt as if the user had said it.
 *
 * This module does it once:
 *
 *   - the arguments are validated with the handler's zod schema, and a
 *     bad argument is an *error result*, not an exception;
 *   - a handler that throws is an error result too, so one broken tool
 *     cannot take the turn down;
 *   - the result goes back inside a material fence: it is data the
 *     model asked for, not an instruction from the user;
 *   - after `maxRounds` rounds of tools the model is asked once more
 *     with the tools taken away, so a loop cannot run away.
 */
import type { z } from "zod";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMToolCall,
  LLMToolDef,
  LlmUsageContext,
} from "./types";
import { asMaterial } from "@shared/material";
import type { Locale } from "@shared/copy";
import { llmService } from "./index";

/** The longest tool result that is handed back to the model. */
export const MAX_TOOL_RESULT_CHARS = 4000;

/** How a tool is executed. The schema is what the model's JSON must match. */
export interface ToolHandler {
  schema: z.ZodTypeAny;
  /** The validated arguments. Each handler narrows its own input. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(input: any, context: ToolRunContext): Promise<string>;
}

export interface ToolRunContext {
  /** The call as the provider reported it. */
  call: LLMToolCall;
  /** 1-based round of tool use. */
  round: number;
  userId: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
  ok: boolean;
  result: string;
}

export interface InvokeWithToolsParams {
  messages: LLMMessage[];
  options?: LLMOptions;
  usage?: LlmUsageContext;
  /** What the model is told it may call. */
  tools: LLMToolDef[];
  /** How each of them is validated and run. */
  handlers: Record<string, ToolHandler>;
  /** Tool rounds before the model is asked for words only. */
  maxRounds?: number;
  /** The language of the fence wording. */
  locale?: Locale;
  /** The user the turn is for; passed to the handler context. */
  userId: number;
}

export interface InvokeWithToolsResult {
  text: string;
  calls: ToolCallRecord[];
  /** How many requests were made to the provider. */
  requests: number;
}

/**
 * A tool call whose arguments are not valid JSON is a model mistake, and
 * the model has to be told — not the user, and not the process.
 */
function argumentsObject(call: LLMToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(issue => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * Runs one call. Never throws: everything that can go wrong becomes a
 * result the model can read and recover from.
 */
async function runOne(
  call: LLMToolCall,
  handler: ToolHandler | undefined,
  context: ToolRunContext,
): Promise<ToolCallRecord> {
  if (!handler) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ok: false,
      result: `There is no tool called "${call.name}".`,
    };
  }
  const input = argumentsObject(call);
  const parsed = handler.schema.safeParse(input);
  if (!parsed.success) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ok: false,
      result: `The arguments were not valid: ${zodMessage(parsed.error)}.`,
    };
  }
  try {
    const result = await handler.run(parsed.data, context);
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ok: true,
      result: result.slice(0, MAX_TOOL_RESULT_CHARS),
    };
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ok: false,
      result: `The tool failed: ${(error as Error).message}`,
    };
  }
}

/**
 * The request, the calls, and the words that come after them.
 *
 * It goes through `LLMService.invokeWithProvider`, so a call is retried
 * and written to the usage ledger exactly like an ordinary one.
 */
export async function invokeWithTools(
  provider: LLMProvider,
  params: InvokeWithToolsParams,
): Promise<InvokeWithToolsResult> {
  const handlers = params.handlers;
  const tools = params.tools.filter(tool => Boolean(handlers[tool.name]));
  const maxRounds = Math.max(1, params.maxRounds ?? 3);
  const locale: Locale = params.locale ?? "zh";
  const messages: LLMMessage[] = [...params.messages];
  const calls: ToolCallRecord[] = [];
  let requests = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    requests += 1;
    const text = await llmService.invokeWithProvider(provider, {
      messages,
      options: {
        ...params.options,
        purpose: params.options?.purpose ?? "reply",
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: params.options?.toolChoice ?? "auto",
      },
      usage: params.usage,
    });
    const toolCalls = provider.lastToolCalls ?? [];
    if (toolCalls.length === 0) {
      return { text, calls, requests };
    }

    // The assistant turn that asked, kept in the conversation so the
    // provider can match each answer to its call.
    messages.push({ role: "assistant", content: text, toolCalls: toolCalls as LLMToolCall[] });

    for (const call of toolCalls) {
      const record = await runOne(call, handlers[call.name], {
        call,
        round,
        userId: params.userId,
      });
      calls.push(record);
      messages.push({
        role: "tool",
        content: asMaterial(record.result, locale),
        toolCallId: call.id,
        toolName: call.name,
      });
    }
  }

  /**
   * Out of rounds: one last request with no tools at all.
   *
   * The manual's rule is "超过轮数就用最后一次的文字", and taking the
   * tools away is what makes it happen: the model can only answer.
   */
  requests += 1;
  const text = await llmService.invokeWithProvider(provider, {
    messages,
    options: {
      ...params.options,
      purpose: params.options?.purpose ?? "reply",
      tools: undefined,
      toolChoice: undefined,
    },
    usage: params.usage,
  });
  return { text, calls, requests };
}
