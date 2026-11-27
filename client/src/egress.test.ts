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
/**
 * The exact addresses allowed, per file — not "this file may have one".
 *
 * A file-wide exemption let any new address hide inside a file that was
 * already explained once; the promise is about the address, so the list
 * is about the address (B7.8).
 */
const ALLOWED: Record<string, string[]> = {
  "client/src/pages/Settings.tsx": ["https://api.openai.com/v1"],
  "client/src/pages/Onboarding.tsx": ["https://..."],
  "client/src/i18n/zh.ts": [
    "https://dav.example.com/mirrai（你的地址）",
    "https://s3.example.com（你的地址）",
  ],
  "client/src/i18n/en.ts": [
    "https://dav.example.com/mirrai",
    "https://s3.example.com",
  ],
  "client/src/i18n/zh-Hant.ts": [
    "https://dav.example.com/mirrai（你的地址）",
    "https://s3.example.com（你的地址）",
  ],
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

function unexplainedIn(files: Array<{ file: string; source: string }>): string[] {
  const unexplained: string[] = [];
  for (const { file, source } of files) {
    for (const match of source.matchAll(/https:\/\/[^\s"'`)]+/g)) {
      if (!(ALLOWED[file] ?? []).includes(match[0])) {
        unexplained.push(`${file}: ${match[0]}`);
      }
    }
  }
  return unexplained;
}

describe("the client's external addresses", () => {
  it("has no https address that is not explained, one address at a time", () => {
    const files = sourceFiles(ROOT).map((file) => ({
      file: path.relative(path.resolve(ROOT, ".."), file),
      source: readFileSync(file, "utf8"),
    }));
    expect(unexplainedIn(files)).toEqual([]);
  });

  it("flags a new address inside a file that already had one (B7.8)", () => {
    // The check used to allow the whole file: a CDN added next to the
    // allowed placeholder would have passed.
    expect(unexplainedIn([{
      file: "client/src/pages/Settings.tsx",
      source: 'placeholder="https://api.openai.com/v1" src="https://cdn.example.com/model.bin"',
    }])).toEqual(["client/src/pages/Settings.tsx: https://cdn.example.com/model.bin"]);
  });
});
