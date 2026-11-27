import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "gate-all.mjs");

/**
 * The one-command gate, as text.
 *
 * The gate is only as good as the seven steps it actually runs, in the
 * order the handbook named them, without a shell in between. A refactor
 * that drops a step or sets `shell: true` would still look like a gate
 * from the outside. The seventh step is WP18's doc-link check, which the
 * handbook added after the original six.
 */
function source(): string {
  return readFileSync(SCRIPT, "utf-8");
}

function firstIndex(snippet: string): number {
  const at = source().indexOf(snippet);
  if (at === -1) throw new Error(`gate-all.mjs does not contain ${JSON.stringify(snippet)}`);
  return at;
}

describe("the gate script", () => {
  it("runs the seven steps, in the handbook order, through process.execPath", () => {
    const text = source();
    expect(text).toContain("process.execPath");
    expect(text).toContain("spawnSync");

    const order = [
      "node_modules/typescript/bin/tsc",
      "node_modules/vitest/vitest.mjs",
      "scripts/audit-cn.ts",
      "scripts/fidelity-gate.ts",
      "node_modules/vite/bin/vite.js",
      "node_modules/esbuild/bin/esbuild",
      "scripts/check-doc-links.mjs",
    ].map(firstIndex);

    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("does not go through a shell", () => {
    expect(source()).not.toMatch(/shell\s*:\s*true/);
  });

  it("has a --fast path that still names the two builds it skips", () => {
    const text = source();
    expect(text).toContain("--fast");
    expect(text).toContain("client-build");
    expect(text).toContain("server-bundle");
  });
});
