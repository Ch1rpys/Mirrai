import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LLM_PURPOSES } from "./types";

const ROOT = join(__dirname, "../..");
const SERVER = join(ROOT, "server");

/**
 * Every model call under `server/` has to say why it is being made.
 *
 * The four names the handbook lists, plus `invokeForUserWithReason`,
 * which is the same door with a failure reason attached.
 */
const CALL_RE =
  /\b(?:llmService\.(?:invokeWithProvider|streamWithProvider|invoke)|invokeWithProvider|streamWithProvider|invokeForUserWithReason|invokeForUser)\s*\(/g;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

function isDefinition(source: string, index: number): boolean {
  const before = source.slice(Math.max(0, index - 40), index);
  if (/\b(?:async\s*\*?\s*|function\s+)$/.test(before)) return true;
  if (/\bthis\.\s*$/.test(before)) return true;
  return false;
}

function aroundCall(source: string, index: number): string {
  return source.slice(Math.max(0, index - 800), index + 2000);
}

describe("every model call names its purpose", () => {
  it("puts purpose on every invokeWithProvider, streamWithProvider, llmService.invoke, and invokeForUser call", () => {
    const missing: string[] = [];
    for (const full of walk(SERVER)) {
      const source = readFileSync(full, "utf8");
      const file = relative(ROOT, full).replaceAll("\\", "/");
      CALL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CALL_RE.exec(source))) {
        const name = match[0].replace(/\s*\($/, "");
        if (isDefinition(source, match.index)) continue;
        const window = aroundCall(source, match.index);
        if (!/\bpurpose\s*:/.test(window)) {
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${file}:${line} ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("only uses the closed set of purposes", () => {
    expect(LLM_PURPOSES).toEqual([
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
    ]);
  });
});
