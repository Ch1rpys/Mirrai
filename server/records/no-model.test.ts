import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The record-reading side does not talk to a model.
 *
 * Everything under `server/records/` reports what the imported records
 * say: counts, dates, firsts, places, the search. If one of these files
 * imported a model it would be able to invent something, and the whole
 * point of the section — "C2 这一组全部来自真实记录，不生成任何内容" —
 * would be lost. The check is structural because a future edit is the
 * risk, not today's code.
 */
const ROOT = path.resolve(__dirname);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

const LLM_IMPORT = /from\s+["'][^"']*(?:\/llm(?:\/|["'])|server\/llm)[^"']*["']/;

describe("the record readers never import a model", () => {
  it("finds the reader files", () => {
    // A walker that found nothing would pass the real check below.
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => statSync(file).isFile())).toBe(true);
  });

  it("has no model import under server/records", () => {
    const offenders = sourceFiles(ROOT)
      .filter((file) => LLM_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
