import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The generation path reads the effective profile, not the stored one
 * (C10.6).
 *
 * The user can turn a measurement off. If any chat code reads
 * `persona.styleProfile` directly, that code keeps using a measurement
 * the user said not to use — the switch silently does not work for that
 * layer, and only that layer. A source check is the only way to be sure
 * none was missed, because each one looks perfectly ordinary.
 *
 * Params named `styleProfile` are fine: they are fed from
 * `effectiveStyleProfile` at the call site. What this looks for is code
 * reaching into the persona itself.
 */

const CHAT_DIR = join(__dirname);

function chatSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      chatSources(full, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The lines that reach the stored profile through the persona object. */
function directReads(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (line.includes("effectiveStyleProfile")) return;
    if (/persona\s*\.\s*styleProfile/.test(line)) hits.push(index + 1);
    if (/persona as \{[^}\n]*styleProfile/.test(line)) hits.push(index + 1);
  });
  return hits;
}

describe("the chat path and the style profile switch", () => {
  it("never reaches into persona.styleProfile directly", () => {
    const offenders: string[] = [];
    for (const file of chatSources(CHAT_DIR)) {
      const source = readFileSync(file, "utf8");
      const lines = directReads(source);
      for (const line of lines) {
        offenders.push(`${relative(CHAT_DIR, file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("would notice a direct read in a file", () => {
    // The scan has to be able to fail; a regex that matches nothing is
    // the failure mode this kind of test usually has.
    const invented = "const profile = (persona as { styleProfile?: unknown }).styleProfile;";
    expect(directReads(invented)).toEqual([1]);
    expect(directReads("const profile = effectiveStyleProfile(persona);")).toEqual([]);
  });
});
