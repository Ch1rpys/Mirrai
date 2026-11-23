import type { LLMMessage, LLMOptions, LLMProvider, LLMToolCall } from "../types";
import { getTextContent } from "../types";
import { parseNDJSON } from "../sse";

export class OllamaProvider implements LLMProvider {
  name = "Ollama";

  constructor(
    private url: string,
    private model: string,
  ) {}

  /**
   * Ollama accepts image parts in its API, but the chat endpoint used here
   * drops them. Declaring `vision: false` makes the caller report the
   * limitation instead of answering as if the image had been seen.
   */
  capabilities = {
    streaming: true,
    vision: false,
    tools: false,
    /**
     * Ollama has a native JSON mode: `format: "json"` (C9.4).
     *
     * It constrains the sampler to valid JSON, which is what the
     * extraction and labelling calls parse. Tools are not implemented
     * on this adapter, so that flag stays false.
     */
    jsonMode: true,
  };

  isConfigured(): boolean {
    return !!this.url && !!this.model;
  }

  get modelName(): string {
    return this.model;
  }

  /** The usage the provider reported on the last call (C8.9). */
  lastUsage: { promptTokens: number; completionTokens: number } | null = null;

  /** This adapter never asks for a tool, so the list is always empty. */
  lastToolCalls: LLMToolCall[] | null = null;

  /** The native JSON mode, on the body (C9.4). */
  private formatField(options?: LLMOptions): Record<string, unknown> {
    return options?.responseFormat === "json" ? { format: "json" } : {};
  }

  /** Sampling fields Ollama accepts on `options`. */
  private samplingOptions(options?: LLMOptions) {
    const next: Record<string, unknown> = {};
    if (options?.temperature != null) next.temperature = options.temperature;
    if (options?.topP != null) next.top_p = options.topP;
    if (options?.frequencyPenalty != null) {
      next.repeat_penalty = Math.min(2, 1 + options.frequencyPenalty);
    }
    if (options?.stop && options.stop.length > 0) next.stop = options.stop;
    return Object.keys(next).length ? next : undefined;
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
        stream: false,
        ...this.formatField(options),
        options: this.samplingOptions(options),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Ollama] error ${response.status}: ${err}`);
    }

    const data = await response.json();
    /**
     * Ollama counts tokens itself (C8.9).
     *
     * `prompt_eval_count`/`eval_count` are its own numbers, so the panel
     * shows them as measured rather than estimated.
     */
    if (
      typeof data?.prompt_eval_count === "number" &&
      typeof data?.eval_count === "number"
    ) {
      this.lastUsage = {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
      };
    } else {
      this.lastUsage = null;
    }
    return data.message?.content ?? "";
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const response = await fetch(`${this.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
        stream: true,
        ...this.formatField(options),
        options: this.samplingOptions(options),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Ollama] error ${response.status}: ${err}`);
    }

    for await (const text of parseNDJSON(response)) {
      yield { text };
    }
  }
}
