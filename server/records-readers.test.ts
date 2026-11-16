import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every reader of the record table asks for the newest page.
 *
 * `getCollectedMessagesForPersona` without `newest` returns the
 * *oldest* twenty thousand rows. A history longer than that then
 * quietly dropped the recent years — the ones exemplars, rhythm, and
 * evaluation actually need.
 */

const ROOT = path.resolve(__dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf-8");
}

/** The argument list of one call, including the outer parentheses. */
function argumentLists(source: string, name: string): string[] {
  const out: string[] = [];
  const needle = `${name}(`;
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(needle, from);
    if (start === -1) break;
    const before = source.slice(Math.max(0, start - 40), start);
    if (/export async function\s+$/.test(before)) {
      from = start + needle.length;
      continue;
    }
    let depth = 0;
    let end = start + name.length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }
    out.push(source.slice(start, end));
    from = end;
  }
  return out;
}

const READERS: Array<{ file: string; what: string; names?: string[] }> = [
  { file: "server/chat/prompt.ts", what: "exemplars" },
  { file: "server/chat/generate.ts", what: "rerank" },
  { file: "server/_core/behavior-profile.ts", what: "the behavior profile" },
  {
    file: "server/routers.ts",
    what: "distillation, evaluation, and the miners",
    names: ["getCollectedMessagesForPersona", "getCollectedMessagesForPersonaRows"],
  },
  { file: "server/eval/run.ts", what: "the eval runner" },
  { file: "scripts/eval-run.ts", what: "the eval CLI" },
];

describe("readers of the record table", () => {
  for (const site of READERS) {
    it(`${site.what} ask for the newest page`, () => {
      const source = read(site.file);
      const names = site.names ?? ["getCollectedMessagesForPersona"];
      const calls = names.flatMap((name) => argumentLists(source, name));
      if (site.file === "server/eval/run.ts") {
        // After P0.6 the runner goes through generate.ts, which is
        // checked above. This file must not grow a raw read of its own.
        expect(calls, site.file).toEqual([]);
        return;
      }
      expect(calls.length, `${site.file} has no reads`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, call).toMatch(/newest:\s*true/);
      }
    });
  }
});
