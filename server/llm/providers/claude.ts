import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMContentPart,
  LLMToolCall,
} from "../types";
import { getTextContent } from "../types";
import { parseSSEData } from "../sse";

function toClaudeContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    /**
     * The picture.
     *
     * Claude takes a base64 source, not a URL — so a `data:` URL has
     * to be taken apart and handed over as the bytes. A plain URL is
     * still accepted, for the providers that fetch it themselves.
     */
    const inlined = /^data:([^;,]+);base64,(.*)$/s.exec(p.url);
    if (inlined) {
      return {
        type: "image",
        source: { type: "base64", media_type: inlined[1], data: inlined[2] },
      };
    }
    return { type: "image", source: { type: "url", url: p.url } };
  });
}

/**
 * Claude's temperature.
 *
 * Claude accepts 0 to 1, so a value meant for another provider is
 * clamped rather than refused: the API answers a temperature of 1.5
 * with an error, and the user would have been told the model failed.
 */
function claudeTemperature(temperature: number | undefined): number {
  if (typeof temperature !== "number" || Number.isNaN(temperature)) return 0.7;
  return Math.min(1, Math.max(0, temperature));
}

export class ClaudeProvider implements LLMProvider {
  name = "Claude";

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
  ) {}

  capabilities = {
    streaming: true,
    vision: true,
    tools: true,
    jsonMode: false,
  };

  get modelName(): string {
    return this.model;
  }

  /** The usage the provider reported on the last call (C8.9). */
  lastUsage: { promptTokens: number; completionTokens: number } | null = null;

  /** The tool calls the provider reported on the last call (C9.4). */
  lastToolCalls: LLMToolCall[] | null = null;

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Claude's tool definitions (C9.4).
   *
   * The same JSON Schema, under `input_schema` instead of
   * `parameters`. Claude has no "none": leaving the tools out is how a
   * turn is forbidden from calling one.
   */
  private toolFields(options?: LLMOptions): Record<string, unknown> {
    const tools = options?.tools;
    if (!tools || tools.length === 0) return {};
    if (options?.toolChoice === "none") return {};
    const fields: Record<string, unknown> = {
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    };
    const choice = options?.toolChoice;
    if (choice === "auto") fields.tool_choice = { type: "auto" };
    else if (choice && typeof choice === "object") {
      fields.tool_choice = { type: "tool", name: choice.name };
    }
    return fields;
  }

  /**
   * The conversation, with tool use in Claude's block shape (C9.4).
   *
   * An assistant turn that asked for tools is text blocks plus
   * `tool_use` blocks; the answers go back inside a *user* message as
   * `tool_result` blocks. Consecutive results are merged into one user
   * message because Claude alternates the two roles.
   */
  private wireMessages(messages: LLMMessage[]) {
    const out: Array<{ role: "user" | "assistant"; content: any }> = [];
    for (const m of messages) {
      if (m.role === "tool") {
        const block = {
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: getTextContent(m.content),
        };
        const last = out[out.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)
          && last.content.every((part: any) => part?.type === "tool_result")) {
          last.content.push(block);
        } else {
          out.push({ role: "user", content: [block] });
        }
        continue;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: any[] = [];
        const text = getTextContent(m.content);
        if (text) blocks.push({ type: "text", text });
        for (const call of m.toolCalls) {
          let input: unknown = {};
          try {
            input = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input });
        }
        out.push({ role: "assistant", content: blocks });
        continue;
      }
      out.push({ role: m.role as "user" | "assistant", content: toClaudeContent(m.content) });
    }
    return out;
  }

  /** Splits the system prompt out; Claude takes it as a top-level field. */
  private splitMessages(messages: LLMMessage[]) {
    let system: string | undefined;
    let cacheBreak: number | undefined;
    const filtered: LLMMessage[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        const text = getTextContent(m.content);
        if (system === undefined) {
          system = text;
          cacheBreak = m.cacheBreak;
        } else {
          system += "\n" + text;
        }
      } else {
        filtered.push(m);
      }
    }
    return { system, filtered, cacheBreak };
  }

  /**
   * Claude's system field.
   *
   * A string stays a string. When the stable prefix is marked, it
   * becomes two text blocks and the first one carries
   * `cache_control: { type: "ephemeral" }`
   * (https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
   */
  private systemField(system: string | undefined, cacheBreak?: number) {
    if (!system) return undefined;
    if (
      cacheBreak == null ||
      cacheBreak <= 0 ||
      cacheBreak >= system.length
    ) {
      return system;
    }
    const stable = system.slice(0, cacheBreak);
    const volatile = system.slice(cacheBreak).replace(/^\n+/, "");
    if (!volatile) return system;
    return [
      { type: "text", text: stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: volatile },
    ];
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const { system, filtered, cacheBreak } = this.splitMessages(messages);

    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    // A failed call must not leave the previous call's tools behind.
    this.lastToolCalls = null;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        // The temperature the user chose. It was never sent, so every
        // Claude reply used the provider's own default and the setting
        // was silently ignored for that provider.
        temperature: claudeTemperature(options?.temperature),
        ...(options?.topP != null ? { top_p: options.topP } : {}),
        ...(options?.stop && options.stop.length > 0 ? { stop_sequences: options.stop } : {}),
        ...this.toolFields(options),
        system: this.systemField(system, cacheBreak),
        messages: this.wireMessages(filtered),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Claude] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const usage = data?.usage;
    if (
      usage &&
      typeof usage.input_tokens === "number" &&
      typeof usage.output_tokens === "number"
    ) {
      this.lastUsage = {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
      };
    } else {
      this.lastUsage = null;
    }
    /**
     * The blocks Claude answered with (C9.4).
     *
     * A tool-use turn can carry text and calls in the same message, so
     * both are read: the text is the reply so far, and the calls are
     * what has to be run before the reply can continue.
     */
    const blocks: any[] = Array.isArray(data.content) ? data.content : [];
    const calls = blocks
      .filter(block => block?.type === "tool_use" && typeof block.name === "string")
      .map(block => ({
        id: typeof block.id === "string" && block.id ? block.id : `toolu_${block.name}`,
        name: block.name as string,
        arguments: JSON.stringify(block.input ?? {}),
      }));
    this.lastToolCalls = calls.length > 0 ? calls : null;
    return blocks
      .filter(block => block?.type === "text" && typeof block.text === "string")
      .map(block => block.text as string)
      .join("");
  }

  async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<{ text: string }> {
    const { system, filtered, cacheBreak } = this.splitMessages(messages);

    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        temperature: claudeTemperature(options?.temperature),
        ...(options?.topP != null ? { top_p: options.topP } : {}),
        ...(options?.stop && options.stop.length > 0 ? { stop_sequences: options.stop } : {}),
        ...this.toolFields(options),
        system: this.systemField(system, cacheBreak),
        stream: true,
        messages: this.wireMessages(filtered),
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[Claude] LLM error ${response.status}: ${err}`);
    }

    this.lastToolCalls = null;

    for await (const payload of parseSSEData(response)) {
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.type === "content_block_delta") {
          const delta = parsed?.delta?.text;
          if (typeof delta === "string" && delta) yield { text: delta };
        }
      } catch {
        // Skip non-JSON frames.
      }
    }
  }
}
