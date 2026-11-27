#!/usr/bin/env node
/**
 * The seven-step gate, as one command.
 *
 * Typecheck, the full test suite, the copy audit, the fidelity structure
 * gate, the client build, the server bundle, and the documentation links.
 * Each step is the same `node` invocation as docs/exec-v6.md §2.1 (the
 * doc-links step is WP18's P18.1). None of them go through a shell.
 *
 * `--fast` skips the two builds, for mid-work checks. A commit still
 * needs the full run.
 *
 * Usage: node scripts/gate-all.mjs [--fast]
 *        corepack pnpm gate
 *        corepack pnpm gate -- --fast
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const STEPS = [
  {
    name: "typecheck",
    args: ["node_modules/typescript/bin/tsc", "--noEmit"],
  },
  {
    name: "test",
    args: ["node_modules/vitest/vitest.mjs", "run", "--reporter=dot"],
  },
  {
    name: "copy-audit",
    args: ["node_modules/tsx/dist/cli.mjs", "scripts/audit-cn.ts"],
  },
  {
    name: "fidelity-gate",
    args: ["node_modules/tsx/dist/cli.mjs", "scripts/fidelity-gate.ts"],
  },
  {
    name: "client-build",
    args: ["node_modules/vite/bin/vite.js", "build"],
  },
  {
    name: "server-bundle",
    args: [
      "node_modules/esbuild/bin/esbuild",
      "server/_core/index.ts",
      "--platform=node",
      "--packages=external",
      "--bundle",
      "--format=esm",
      "--outdir=dist",
    ],
  },
  {
    name: "doc-links",
    args: ["scripts/check-doc-links.mjs"],
  },
];

const BUILD_STEPS = new Set(["client-build", "server-bundle"]);

function log(...args) {
  console.log("[gate]", ...args);
}

function fail(message, code) {
  console.error("[gate]", message);
  process.exit(code);
}

function runStep(step) {
  const started = Date.now();
  log(step.name);
  const result = spawnSync(process.execPath, step.args, {
    cwd: ROOT,
    stdio: "inherit",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error) {
    fail(`${step.name} could not start: ${result.error.message} (${seconds}s)`, 1);
  }
  if (result.signal) {
    fail(`failed at ${step.name} (signal ${result.signal}, ${seconds}s)`, 1);
  }
  if (result.status !== 0) {
    fail(`failed at ${step.name} (exit ${result.status}, ${seconds}s)`, result.status ?? 1);
  }
  log(`${step.name} passed (${seconds}s)`);
}

const fast = process.argv.includes("--fast");
const steps = fast ? STEPS.filter((step) => !BUILD_STEPS.has(step.name)) : STEPS;

if (fast) log("fast: skipping client-build and server-bundle");

for (const step of steps) runStep(step);

log(fast ? "fast gate passed" : "all seven steps passed");
