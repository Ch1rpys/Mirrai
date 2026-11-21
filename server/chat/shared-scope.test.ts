import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A shared persona's generation reads the owner's records (C7.2).
 *
 * The member's own row has no records — they are the owner's. Every
 * path in the generation code that reads the record has to take its
 * `(personaId, userId)` pair from `resolveRecordScope`, or the persona
 * would answer from an empty history and the family share would be a
 * different, worse persona.
 *
 * A scan, not a single-case test: the first version checked only that
 * the three files mentioned the helper, and a fallback path in
 * `prompt.ts` still built its params from the member's ids.
 */
const CHAT = path.resolve(__dirname);

function sourceNames(): string[] {
  return readdirSync(CHAT)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

function read(name: string): string {
  return readFileSync(path.join(CHAT, name), "utf8");
}

/** The three reads the manual names. */
const RECORD_READ = /(?:iterateRecords|getCollectedMessagesForPersona|candidateRecordsByOverlap)\s*\(/;

/**
 * Entry points that compose a turn. They must pass the scope themselves.
 */
const GENERATION_FILES = new Set([
  "generate.ts",
  "prompt.ts",
  "service.ts",
  // The record-range scenes (C8.13) read the record too: the loader is
  // handed the persona and resolves the scope itself, like the others.
  "scene-range.ts",
]);

/**
 * Helpers that receive the `(personaId, userId)` pair from an entry
 * point. Their callers are checked by the assertions below; the pair is
 * not something a helper can invent.
 */
const READ_HELPERS = new Set(["exemplar-query.ts", "rerank-model.ts", "embeddings.ts"]);

describe("the generation path reads the owner's records for a shared persona", () => {
  it("takes every record-read pair from resolveRecordScope", () => {
    const offenders: string[] = [];
    for (const name of sourceNames()) {
      const lines = read(name).split("\n");
      for (const [index, line] of lines.entries()) {
        if (!RECORD_READ.test(line)) continue;
        if (GENERATION_FILES.has(name)) {
          if (!/\bscope\.(?:personaId|userId)\b/.test(line) && !/resolveRecordScope\(/.test(line)) {
            offenders.push(`${name}:${index + 1}: ${line.trim()}`);
          }
          continue;
        }
        if (!READ_HELPERS.has(name)) {
          offenders.push(`${name}:${index + 1}: unclassified record read: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("builds the exemplar and rerank params from the scope", () => {
    const generate = read("generate.ts");
    expect(generate).toMatch(/const scope = resolveRecordScope\(input\.persona\)/);
    expect(generate).toMatch(/personaId:\s*scope\.personaId/);
    expect(generate).toMatch(/userId:\s*scope\.userId/);
    expect(generate).toMatch(/getRerankModel\(\s*scope\.personaId,\s*scope\.userId/);

    const prompt = read("prompt.ts");
    expect(prompt).toMatch(/const scope = resolveRecordScope\(context\.persona\)/);
    // The preview path builds its exemplar params from the same scope as
    // the chat path; the two must not read different record sets.
    expect(prompt).toMatch(/personaId:\s*scope\.personaId/);
    expect(prompt).toMatch(/userId:\s*scope\.userId/);
    expect(prompt).toMatch(/getCollectedMessagesForPersona\(\s*scope\.personaId,\s*scope\.userId/);
  });

  it("does not read a shared persona's own empty row", () => {
    // The old shapes: the member's persona id paired with the member's
    // user id, or the raw `input.persona.id`, anywhere a record is read.
    expect(read("generate.ts")).not.toMatch(
      /getCollectedMessagesForPersona\(input\.persona\.id,\s*input\.userId/,
    );
    expect(read("generate.ts")).not.toMatch(
      /getRerankModel\(input\.persona\.id,\s*input\.userId/,
    );
    expect(read("prompt.ts")).not.toMatch(
      /getCollectedMessagesForPersona\(context\.persona\.id,\s*context\.userId/,
    );
  });
});
