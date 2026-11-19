import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every outbound address the browser can be given (B7.8).
 *
 * The app promised that its data does not leave this machine. A model
 * downloaded from a CDN would break that promise quietly: the photos
 * never leave, but the fact that this person has photos would. So the
 * client is scanned for `https://`, and every hit has to be on this
 * list with a reason. A new one without a reason fails the test.
 */
const ALLOWED: Record<string, string> = {
  "client/src/pages/Settings.tsx":
    "a placeholder for the base URL the user types for their own provider",
  "client/src/pages/Onboarding.tsx":
    "a placeholder for the base URL the user types for their own provider",
};

const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("the client's external addresses", () => {
  it("has no https address that is not explained", () => {
    const unexplained: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      const relative = path.relative(path.resolve(ROOT, ".."), file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/https:\/\/[^\s"'`)]+/g)) {
        if (!ALLOWED[relative]) {
          unexplained.push(`${relative}: ${match[0]}`);
        }
      }
    }
    expect(unexplained).toEqual([]);
  });
});
