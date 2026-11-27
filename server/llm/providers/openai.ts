import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMContentPart,
  LLMToolCall,
} from "../types";
import { getTextContent } from "../types";
import { parseSSEData } from "../sse";
import { stripForbiddenExtraBody } from "../extra-body";

function toOpenAIContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

/**
 * The OpenAI tool definitions (C9.4).
 *
 * The function wrapper is OpenAI's, not ours: `parameters` is the JSON
 * Schema the caller built.
 */
function toOpenAITools(options?: LLMOptions): unknown[] | undefined {
  if (!options?.tools || options.tools.length === 0) return undefined;
  return options.tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** OpenAI's three shapes of `tool_choice` (C9.4). */
function toOpenAIToolChoice(options?: LLMOptions): unknown {
  const choice = options?.toolChoice;
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none") return choice;
  return { type: "function", function: { name: choice.name } };
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    public readonly baseUrl: string,
    private model: string,
    private systemMessage?: string,
    public readonly maxAttempts = 3,
  ) {}

  capabilities = {
    streaming: true,
    vision: true,
    tools: true,
    jsonMode: true,
  };

  get modelName(): string {
    return this.model;
  }

  /** The usage the provider reported on the last call (C8.9). */
  lastUsage: { promptTokens: number; completionTokens: number } | null = null;

  isConfigured(): boolean {
    // A key on its own is not enough. A provider with no base URL calls
    // "/chat/completions", which is not a URL, and one with no model is
    // refused by the API — and both used to report themselves as ready.
    return !!this.apiKey && !!this.baseUrl && !!this.model;
  }

  /**
   * The tool calls the provider reported on the last call (C9.4).
   *
   * `invoke` returns the words; the calls are read from here by
   * `invokeWithTools`, the same way the token counts are read from
   * `lastUsage`.
   */
  lastToolCalls: LLMToolCall[] | null = null;

  private buildMessages(messages: LLMMessage[]): LLMMessage[] {
    return this.systemMessage
      ? [{ role: "system" as const, content: this.systemMessage }, ...messages]
      : messages;
  }

  /**
   * Turns the shared message shapes into the OpenAI wire shapes (C9.4).
   *
   * A tool result is a `role: "tool"` message carrying the id it
   * answers; an assistant message that asked for tools carries them
   * back. Everything else is what it always was.
   */
  private wireMessages(messages: LLMMessage[]) {
    return this.buildMessages(messages).map(m => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId,
          content: getTextContent(m.content),
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const text = getTextContent(m.content);
        return {
          role: "assistant",
          content: text ? text : null,
          tool_calls: m.toolCalls.map(call => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      return { role: m.role, content: toOpenAIContent(m.content) };
    });
  }

  private buildBody(messages: LLMMessage[], options: LLMOptions | undefined, stream: boolean) {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.wireMessages(messages),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };
    if (options?.topP != null) body.top_p = options.topP;
    if (options?.presencePenalty != null) body.presence_penalty = options.presencePenalty;
    if (options?.frequencyPenalty != null) body.frequency_penalty = options.frequencyPenalty;
    if (options?.stop && options.stop.length > 0) body.stop = options.stop;
    const tools = toOpenAITools(options);
    if (tools) body.tools = tools;
    const toolChoice = toOpenAIToolChoice(options);
    if (toolChoice !== undefined) body.tool_choice = toolChoice;
    if (options?.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }
    if (stream) body.stream = true;
    if (options?.extraBody) {
      Object.assign(body, stripForbiddenExtraBody(options.extraBody));
    }
    /**
     * The sampler's token ban (B9.3).
     *
     * It sits after `extraBody` on purpose: the bias is a layer with a
     * measured reason, and a field typed by hand must not silently win
     * over it. The caller only sets it for an endpoint where the token
     * ids are known to mean what OpenAI means.
     */
    if (options?.logitBias && Object.keys(options.logitBias).length > 0) {
      body.logit_bias = options.logitBias;
    }
    return JSON.stringify(body);
  }

  /**
   * Turns a recording into words.
   *
   * The OpenAI-compatible speech-to-text endpoint: the file goes up,
   * the text comes back. It is the only honest way to hear a voice
   * message — the chat model cannot, and asking it to guess produced
   * words the user never said.
   */
  async transcribe(audio: Buffer, filename: string): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)]), filename);
    form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `The speech-to-text service answered ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      return (parsed.text ?? "").trim();
    } catch {
      // Some servers answer with the plain text.
      return raw.trim();
    }
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    // A failed call must not leave the previous call's tools behind.
    this.lastToolCalls = null;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildBody(messages, options, false),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    /**
     * What the response says it used (C8.9).
     *
     * OpenAI-compatible servers report `usage` on a non-streaming call.
     * A server that leaves it out is estimated locally, and the row says
     * so.
     */
    const usage = data?.usage;
    if (
      usage &&
      typeof usage.prompt_tokens === "number" &&
      typeof usage.completion_tokens === "number"
    ) {
      this.lastUsage = {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
      };
    } else {
      this.lastUsage = null;
    }
    const message = data.choices?.[0]?.message;
    /**
     * What the model asked for, if anything (C9.4).
     *
     * A tool-call reply usually has no `content` at all, so the calls
     * are read before the text: an empty string plus a call is a
     * question, not an empty answer.
     */
    const rawCalls = message?.tool_calls;
    if (Array.isArray(rawCalls)) {
      const calls: LLMToolCall[] = rawCalls.flatMap((call: any) => {
        const name = call?.function?.name;
        if (typeof name !== "string" || !name) return [];
        const args = call?.function?.arguments;
        return [{
          id: typeof call?.id === "string" && call.id ? call.id : `call_${name}`,
          name,
          arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        }];
      });
      this.lastToolCalls = calls.length > 0 ? calls : null;
    } else {
      this.lastToolCalls = null;
    }
    // Some providers answer with the reasoning in `reasoning_content` and
    // leave `content` empty. Reading only `content` turned such a reply
    // into an empty one, which the app then stored as "(silence)".
    const text = message?.content ?? message?.reasoning_content ?? "";
    return typeof text === "string" ? text : "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.lastToolCalls = null;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: this.buildBody(messages, options, true),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        const choice = parsed?.choices?.[0]?.delta;
        const delta = choice?.content ?? choice?.reasoning_content;
        if (typeof delta === "string" && delta) yield { text: delta };
      } catch {
        // Skip frames that are not JSON (keep-alives, for instance).
      }
    }
  }
}
