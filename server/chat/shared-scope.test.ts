import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A shared persona's generation reads the owner's records (C7.2).
 *
 * The member's own row has no records — they are the owner's. Every
 * path that reads the record for a turn has to go through
 * `resolveRecordScope`, or the persona would answer from an empty
 * history and the family share would be a different, worse persona.
 */
const CHAT = path.resolve(__dirname);

function read(name: string): string {
  return readFileSync(path.join(CHAT, name), "utf8");
}

describe("the generation path reads the owner's records for a shared persona", () => {
  it("uses the scope for exemplars, seeds, rerank and the prompt", () => {
    for (const file of ["generate.ts", "prompt.ts", "service.ts"]) {
      expect(read(file)).toContain("resolveRecordScope");
    }
    expect(read("generate.ts")).toMatch(/personaId:\s*scope\.personaId/);
    expect(read("generate.ts")).toMatch(/getCollectedMessagesForPersona\(\s*scope\.personaId/);
    expect(read("generate.ts")).toMatch(/getRerankModel\(\s*[^)]*scope\.personaId/);
    expect(read("prompt.ts")).toMatch(/resolveRecordScope\(context\.persona\)/);
    expect(read("service.ts")).toMatch(/resolveRecordScope\(persona\)\.personaId/);
  });

  it("no longer reads the member's own row for the record", () => {
    expect(read("generate.ts")).not.toMatch(
      /getCollectedMessagesForPersona\(input\.persona\.id,\s*input\.userId/,
    );
    expect(read("generate.ts")).not.toMatch(
      /getRerankModel\(input\.persona\.id,\s*input\.userId/,
    );
  });
});
