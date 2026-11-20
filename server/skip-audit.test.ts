import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * What a test suite is allowed to skip (WP10 acceptance follow-up).
 *
 * The manual first said "the skipped count may not grow" and then
 * required every database test to be `describe.skipIf(!DATABASE_URL)`
 * — the two rules cannot both hold once another database test exists
 * (the baseline itself already carried eight skipped cases). The
 * agreed resolution is: an *existing* test may never become skipped,
 * and the only new skips are those database tests. A number alone
 * cannot tell those two apart, so this test reads the sources and
 * checks the reasons instead.
 *
 * The `DATABASE_TEST_FILES` list is the code-side record of the
 * database-gated tests. Adding one means adding it here and recording
 * the new skip count in `docs/exec-v6-progress.md`; deleting one from
 * the list without deleting the file is refused.
 */

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRECTORIES = ["server", "shared", "client"];

/** The only reasons a test file may skip cases. */
const ALLOWED_SKIP_CONDITIONS = new Set([
  "!DATABASE_URL",
  "!process.env.DATABASE_URL",
  "!PYTHON",
  "!BASH",
]);

/** Every test file that skips without a database. Recorded by design. */
const DATABASE_TEST_FILES = new Set([
  "server/collectors/idempotency-db.test.ts",
  "server/db-media.test.ts",
  "server/db-memory-media.test.ts",
  "server/db-persona-versions.test.ts",
  "server/db-push.test.ts",
  "server/db-exemplars.test.ts",
  "server/db-records.test.ts",
  "server/db-search.test.ts",
  "server/db-stickers.test.ts",
  "server/db-unique-indexes.test.ts",
  "server/routers-v6/material.test.ts",
]);

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...testFiles(full));
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/**
 * This file names the patterns it looks for, so it would flag itself.
 * It is the only file left out of its own walk.
 */
const SELF = "server/skip-audit.test.ts";

const files = SKIP_DIRECTORIES
  .flatMap((dir) => {
    const full = path.join(ROOT, dir);
    try {
      return testFiles(full);
    } catch {
      return [];
    }
  })
  .filter((file) => relative(file) !== SELF);

describe("the tests may only skip for an environment reason", () => {
  it("has no unconditional skip, todo, or focused test", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // `.skipIf(` is checked separately below; these forms hide a
      // test outright or focus the suite on one of them.
      if (/\.(skip|todo)\s*\(/.test(source.replace(/\.skipIf\s*\(/g, ""))) {
        offenders.push(`${relative(file)} skips a test unconditionally`);
      }
      if (/\.only\s*\(/.test(source)) {
        offenders.push(`${relative(file)} focuses a test with .only(`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("skips only for one of the known environment conditions", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.skipIf\s*\(\s*([^)]+?)\s*\)/g)) {
        const condition = match[1]!.trim();
        if (!ALLOWED_SKIP_CONDITIONS.has(condition)) {
          offenders.push(`${relative(file)} skips on an unregistered condition: ${condition}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the database-gated files on the recorded list", () => {
    const gated = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (
        source.includes("skipIf(!DATABASE_URL)") ||
        source.includes("skipIf(!process.env.DATABASE_URL)")
      ) {
        gated.add(relative(file));
      }
    }
    expect([...gated].sort()).toEqual([...DATABASE_TEST_FILES].sort());
  });

  it("finds the test files it is supposed to look at", () => {
    // A walker that silently found nothing would pass every check above.
    expect(files.length).toBeGreaterThan(400);
    expect(files.every((file) => statSync(file).isFile())).toBe(true);
  });
});
