export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

/**
 * A tool the model may call (C9.4).
 *
 * `parameters` is a JSON Schema object, which is exactly what the OpenAI
 * and Claude request bodies want. The adapter that speaks a different
 * shape converts it; the caller only ever builds one definition.
 */
export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** How the model is allowed to use the tools it was given (C9.4). */
export type LLMToolChoice = "auto" | "none" | { name: string };

/** One call the model asked for (C9.4). */
export interface LLMToolCall {
  id: string;
  name: string;
  /**
   * The arguments, as the provider sent them.
   *
   * It is the raw JSON string, not a parsed object: a provider that
   * answered with broken JSON has to be reported as broken, not crash
   * the turn on a parse.
   */
  arguments: string;
}

/** The answer to a turn, with the tool calls the words came with (C9.4). */
export interface LLMCompletion {
  text: string;
  toolCalls?: LLMToolCall[];
}

export type LLMMessage = {
  /**
   * `tool` is a result going back to the model (C9.4).
   *
   * OpenAI and Ollama put it in a `role: "tool"` message; Claude puts it
   * in a `tool_result` block inside a user message. Both are built from
   * this one shape.
   */
  role: "system" | "user" | "assistant" | "tool";
  content: string | LLMContentPart[];
  /**
   * Character length of the stable prefix of a system prompt.
   *
   * Claude splits the system field into two blocks at this index and
   * marks the first with `cache_control: { type: "ephemeral" }`. Other
   * providers ignore it.
   */
  cacheBreak?: number;
  /** The calls this assistant message asked for (C9.4). */
  toolCalls?: LLMToolCall[];
  /** Which call this tool result answers (C9.4). */
  toolCallId?: string;
  /** The tool's name, for providers that want it with the result (C9.4). */
  toolName?: string;
};

export const LLM_PURPOSES = [
  "reply",
  "plan",
  "rerank",
  "classify",
  "extract",
  "summarize",
  "distill",
  "letter",
  "eval",
  "other",
] as const;

export type LlmPurpose = (typeof LLM_PURPOSES)[number];

export type LLMOptions = {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /**
   * Extra fields merged into an OpenAI-compatible request body.
   *
   * Claude, Ollama, Dify and Spark ignore it.
   */
  extraBody?: Record<string, unknown>;
  provider?: string;
  /** Why this call is being made. Callers have to set it. */
  purpose?: LlmPurpose;
  /**
   * Sequences that end the reply.
   *
   * OpenAI sends `stop`, Claude sends `stop_sequences`, Ollama puts it
   * on `options.stop`. Dify and Spark have no field for it, so they
   * ignore it.
   */
  stop?: string[];
  /**
   * Token ids the sampler may not pick (B9.3).
   *
   * Keys are token ids as strings; values are the OpenAI bias range. Only
   * a provider whose tokenizer matches these ids may send it, and the
   * caller decides that — see `providerSupportsLogitBias`.
   */
  logitBias?: Record<string, number>;
  /** Cancels an in-flight request (used by the streaming route). */
  signal?: AbortSignal;
  /**
   * Tools the model may call (C9.4).
   *
   * Only a provider whose capabilities declare `tools: true` sends
   * them; a provider that cannot leaves the field out, so a request
   * without tools is byte-for-byte what it was before this existed.
   */
  tools?: LLMToolDef[];
  /** Only meaningful together with `tools`. */
  toolChoice?: LLMToolChoice;
  /**
   * Ask for structured JSON output where the provider has a native mode
   * (C9.4). Providers without one leave the field out and the caller
   * keeps its tolerant extraction.
   */
  responseFormat?: "json";
};

/**
 * What a provider is able to do.
 *
 * The capability flags exist so a caller can fail loudly instead of silently
 * degrading: before this existed, sending an image to Ollama or Dify quietly
 * dropped the image and answered from the text alone.
 */
export interface LLMCapabilities {
  /** Supports token-by-token streaming. */
  streaming: boolean;
  /** Understands `image_url` content parts. */
  vision: boolean;
  /** Supports function/tool calling. */
  tools: boolean;
  /** Supports a native structured-JSON output mode. */
  jsonMode: boolean;
}

export const NO_CAPABILITIES: LLMCapabilities = {
  streaming: false,
  vision: false,
  tools: false,
  jsonMode: false,
};

export type LLMStreamChunk = { text: string };

/**
 * What a provider says it used, when it says anything.
 *
 * Most APIs report it on the response; a provider that does not leaves
 * `lastUsage` null and the service counts the tokens locally instead.
 * An estimate is marked as one — the cost panel never mixes the two.
 */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Who a call is for (C8.9).
 *
 * The service does not know the user; the caller does. Passing it here
 * is what makes a row in `llm_usage` attributable. A call without it is
 * not recorded — evaluation runs against a fixture are one example.
 */
export interface LlmUsageContext {
  userId: number;
  personaId?: number | null;
  jobId?: string | null;
}

export type InvokeParams = {
  messages: LLMMessage[];
  options?: LLMOptions;
  /** Who the call is for, so it can be recorded in `llm_usage`. */
  usage?: LlmUsageContext;
};

export type InvokeResult = string;

export interface LLMProvider {
  name: string;
  /**
   * The endpoint this instance talks to, when it talks HTTP to one.
   *
   * It exists so a caller can decide whether a request field that only
   * some endpoints accept is safe to send — the official OpenAI address
   * takes `logit_bias`, a compatible gateway may serve a different
   * tokenizer. A provider that is not an HTTP endpoint leaves it unset.
   */
  readonly baseUrl?: string;
  /**
   * The extra configuration of the row this instance was built from.
   *
   * The request-shape switches (`supportsLogitBias`, `supportsGrammar`)
   * live on the user's configuration row, next to the address they
   * describe. A generation path that reads the provider instance — the
   * evaluation, a group room, rehearsal, drift — has no per-turn
   * configuration of its own, so the instance carries the row's settings
   * and the request builder reads them from here. Environment-configured
   * providers leave it unset, and nothing is sent on a guess.
   */
  readonly extraConfig?: Record<string, unknown>;
  maxAttempts?: number;
  /** Declared once at construction; every provider must set it. */
  capabilities: LLMCapabilities;
  isConfigured(): boolean;
  /** The model this instance was built with, for the usage record. */
  readonly modelName?: string;
  /**
   * The usage the provider reported on its last successful call, or
   * null. The service reads it after the call and clears nothing: the
   * next call overwrites it.
   */
  lastUsage?: LLMUsage | null;
  /**
   * The tool calls the provider reported on its last successful call,
   * or null (C9.4).
   *
   * It sits next to `lastUsage` for the same reason: `invoke` returns
   * the words, and the calls that came with them are not words. A
   * provider that never asks for a tool leaves this null, and the
   * non-tool paths never look at it.
   */
  lastToolCalls?: LLMToolCall[] | null;
  invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  /** Optional: yields text incrementally. */
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
  /**
   * Optional: turns a recording into words.
   *
   * It is optional because most providers cannot: the speech-to-text
   * is a separate service, and only the OpenAI-compatible ones expose
   * it.
   *
   * The app used to *pretend* to transcribe: it asked the chat model
   * to guess what the recording might have said from how many seconds
   * it lasted. The guess was shown to the user as their own words, it
   * was stored as their own words, and the persona answered it warmly.
   */
  transcribe?(audio: Buffer, filename: string): Promise<string>;
}

export function getTextContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => (p as { type: "text"; text: string }).text).join("\n");
}

/** True when the message carries at least one non-text part. */
export function hasNonTextContent(content: string | LLMContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some(p => p.type !== "text");
}
