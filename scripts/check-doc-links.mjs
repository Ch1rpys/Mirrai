#!/usr/bin/env node
/**
 * Every relative link in `docs/` and the two READMEs points at something
 * that exists.
 *
 * The documents are the only map of this repository that a person reads
 * before running anything. A link to a file that was renamed or never
 * written is a dead end, and nothing else in the gate would notice: the
 * type checker does not read markdown, and the test suite only reads the
 * files it imports.
 *
 * The check is deliberately literal, the same way the gate is: it does
 * not know what a link is *for*, only that a relative target on disk
 * must exist. External URLs are not fetched (the gate has to run offline),
 * and pure `#anchor` links are not resolved against headings (a table of
 * contents that drifts is a different, softer problem).
 *
 * Fenced code and inline code are stripped first, so an example such as
 * `[text](path)` inside a fenced block is not mistaken for a link.
 *
 * Usage: node scripts/check-doc-links.mjs
 * Exit code 0 when every relative link resolves, 1 otherwise.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** The two files at the repository root are in scope as well as docs/. */
const README_FILES = ["README.md", "README.en.md"];

/** Inline markdown links and images: `[text](target)`, `![alt](target)`. */
const LINK = /!?\[[^\]]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

function markdownFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        // Built output and dependency trees are not source documents.
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  };
  walk(resolve(ROOT, "docs"));
  for (const name of README_FILES) {
    const full = resolve(ROOT, name);
    if (existsSync(full)) files.push(full);
  }
  return files.sort();
}

/**
 * `undefined` when the target should not be checked, otherwise the text
 * that has to resolve to an existing path.
 */
function relativeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  if (target === "" || target.startsWith("#") || target.startsWith("//")) {
    return undefined;
  }
  // A scheme (https:, mailto:, tel:, data:) means "not a local file".
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return undefined;
  const path = target.split("#")[0].split("?")[0];
  if (path === "") return undefined;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

const failures = [];
let checked = 0;
let files = 0;

for (const file of markdownFiles()) {
  const source = readFileSync(file, "utf-8")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
  files += 1;
  for (const match of source.matchAll(LINK)) {
    const target = relativeTarget(match[1]);
    if (target === undefined) continue;
    checked += 1;
    const resolved = target.startsWith("/")
      ? resolve(ROOT, target.slice(1))
      : resolve(dirname(file), target);
    if (!existsSync(resolved)) {
      failures.push({
        file: relative(ROOT, file),
        line: lineAt(source, match.index ?? 0),
        target: match[1],
        resolved: relative(ROOT, resolved),
      });
    }
  }
}

if (failures.length > 0) {
  console.error(`[doc-links] ${failures.length} broken relative link(s) in ${files} file(s):`);
  for (const failure of failures) {
    console.error(`  ${failure.file}:${failure.line}  ${failure.target}  (resolved: ${failure.resolved})`);
  }
  process.exit(1);
}

console.log(`[doc-links] ${checked} relative link(s) in ${files} file(s), all resolve.`);
