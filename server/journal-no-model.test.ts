import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The user's own words are not model input (C4.5).
 *
 * They are the one place in the app where a person writes purely for
 * themselves. Nothing in the generation paths may read them — not the
 * chat, not the distillation, not the provider layer. A structural test
 * is what keeps that true after everybody who wrote this has left.
 */
const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const full = path.join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(path.join(dir, entry)));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(path.join(dir, entry));
  }
  return out;
}

describe("the user's diary and the model", () => {
  it("is not read anywhere in the generation paths", () => {
    const offenders: string[] = [];
    for (const dir of ["server/chat", "server/skill-engine", "server/llm"]) {
      for (const file of filesUnder(dir)) {
        const source = readFileSync(path.join(ROOT, file), "utf8");
        if (/user_journal|userJournal|journal\./.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
