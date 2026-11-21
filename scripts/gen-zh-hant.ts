#!/usr/bin/env tsx
/**
 * Generates the traditional Chinese dictionary from the simplified one.
 *
 * The interface's words live in `client/src/i18n/zh.ts`; the English half is
 * `en.ts`. Traditional Chinese is not a second translation — it is the same
 * words in different characters — so it is machine-converted with OpenCC
 * (cn → tw) rather than written out by hand. Hand-writing it would mean a
 * second dictionary to keep in step with the first, and the first one is
 * edited on every feature.
 *
 * The output is checked in: the client bundles it as a dictionary, and it
 * does not carry the (large) simplified → traditional converter. Re-running
 * this script is what changes it:
 *
 *   pnpm i18n:hant
 *
 * The run is deterministic: the dictionary is written in the source's key
 * order, with two-space indentation, so running it twice produces a
 * byte-identical file (and a clean `git status`).
 *
 * The server's own words (`shared/copy/`) are converted at run time instead,
 * because they are looked up by key rather than bundled as a dictionary.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Converter } from "opencc-js/cn2t";
import { zh } from "../client/src/i18n/zh";

/** `cn → tw`: simplified characters to their Taiwanese traditional forms. */
const convert = Converter({ from: "cn", to: "tw" });

/** Converts every string in the dictionary, keeping its shape. */
function convertValue(value: unknown): unknown {
  if (typeof value === "string") return convert(value);
  if (Array.isArray(value)) return value.map(convertValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = convertValue(child);
    return out;
  }
  return value;
}

/** Every leaf in the dictionary — what "the same keys" is checked on. */
function countLeaves(value: unknown): number {
  if (value == null || typeof value !== "object") return 1;
  if (Array.isArray(value)) return 1;
  let total = 0;
  for (const child of Object.values(value as Record<string, unknown>)) {
    total += countLeaves(child);
  }
  return total;
}

const HEADER = `/**
 * The traditional Chinese dictionary.
 *
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`scripts/gen-zh-hant.ts\` from \`zh.ts\` with OpenCC (cn → tw).
 * The generated file is what the client bundles, so the interface can offer
 * 繁體中文 without shipping the simplified → traditional converter. To change
 * anything here, change \`zh.ts\` and run:
 *
 *   pnpm i18n:hant
 *
 * The keys are identical to \`zh.ts\` (the dictionary test enforces it), and
 * the words are the same words in traditional characters.
 */
`;

const converted = convertValue(zh) as Record<string, unknown>;
const body = JSON.stringify(converted, null, 2);
const file = join(dirname(import.meta.dirname), "client", "src", "i18n", "zh-Hant.ts");
writeFileSync(
  file,
  `${HEADER}export const zhHant = ${body} as const;\n`,
  "utf8",
);

console.log(
  `[i18n] wrote ${file} — ${countLeaves(zh)} keys, converted from zh.ts`,
);
