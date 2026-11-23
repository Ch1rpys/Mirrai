/**
 * The capability flags and the adapters have to agree (C9.4).
 *
 * A provider that declares `tools: true` and then drops the field
 * quietly is the failure this test exists for: the caller believes the
 * model can call a tool, the model never sees one, and the answer is
 * just shorter. Reading the adapter's own source is deliberate — a
 * declaration is not a fact until the code that would honour it is
 * there.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { DifyProvider } from "./providers/dify";
import { XunfeiProvider } from "./providers/xunfei";

const HERE = resolve(import.meta.dirname);

/** The source of every adapter, keyed by the class that declares flags. */
const ADAPTERS: Array<{ file: string; name: string }> = [
  { file: "providers/openai.ts", name: "OpenAI" },
  { file: "providers/claude.ts", name: "Claude" },
  { file: "providers/ollama.ts", name: "Ollama" },
  { file: "providers/dify.ts", name: "Dify" },
  { file: "providers/xunfei.ts", name: "Spark" },
];

function sourceOf(file: string): string {
  return readFileSync(resolve(HERE, file), "utf-8");
}

/** The four booleans in the `capabilities = { … }` literal. */
function declared(source: string): Record<string, boolean> {
  const block = /capabilities\s*=\s*\{([\s\S]*?)\};/.exec(source);
  if (!block) throw new Error("no capabilities block");
  const out: Record<string, boolean> = {};
  for (const match of block[1].matchAll(/(\w+)\s*:\s*(true|false)/g)) {
    out[match[1]] = match[2] === "true";
  }
  return out;
}

describe("the declared capabilities match the code", () => {
  it("has all four flags on every adapter", () => {
    for (const adapter of ADAPTERS) {
      const flags = declared(sourceOf(adapter.file));
      expect(Object.keys(flags).sort(), adapter.name).toEqual(
        ["jsonMode", "streaming", "tools", "vision"],
      );
    }
  });

  it("handles tools in every adapter that declares them", () => {
    for (const adapter of ADAPTERS) {
      const source = sourceOf(adapter.file);
      if (declared(source).tools !== true) continue;
      // The request side and the response side both have to be there.
      expect(source, `${adapter.name} sends tools`).toMatch(/tool_choice/);
      expect(source, `${adapter.name} reads the calls`).toMatch(/tool_calls|tool_use/);
    }
  });

  it("handles a JSON mode in every adapter that declares one", () => {
    for (const adapter of ADAPTERS) {
      const source = sourceOf(adapter.file);
      if (declared(source).jsonMode !== true) continue;
      expect(source, `${adapter.name} asks for JSON`).toMatch(/response_format|format\s*:\s*"json"/);
    }
  });

  it("declares what each provider can actually do", () => {
    const openai = new OpenAIProvider("OpenAI", "k", "https://x.invalid/v1", "m");
    expect(openai.capabilities).toMatchObject({ tools: true, jsonMode: true });
    const claude = new ClaudeProvider("k", "m", "https://x.invalid");
    expect(claude.capabilities).toMatchObject({ tools: true, jsonMode: false });
    const ollama = new OllamaProvider("http://localhost:11434", "m");
    expect(ollama.capabilities).toMatchObject({ tools: false, jsonMode: true });
    const dify = new DifyProvider("k", "https://x.invalid");
    expect(dify.capabilities).toMatchObject({ tools: false, jsonMode: false });
    const spark = new XunfeiProvider("app", "k", "secret", "v3.5");
    expect(spark.capabilities).toMatchObject({ tools: false, jsonMode: false });
  });

  it("names every adapter file that declares a provider", () => {
    // A new adapter that is not in this list would never be checked;
    // the list is asserted against the directory so it cannot rot.
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(resolve(HERE, "providers"))
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => `providers/${name}`);
    for (const file of files) {
      const source = sourceOf(file);
      if (!/capabilities\s*=\s*\{/.test(source)) continue;
      expect(ADAPTERS.map(adapter => adapter.file), basename(file)).toContain(file);
    }
  });
});
