/**
 * Mirrai does not watch the other person.
 *
 * The reading tools — the waiting gauge, "read this line", the mirror, the
 * record reader — all read history the user imported themselves. Nothing
 * in the app connects to the other person's account, reads their online
 * status, their read receipts or their location, and no collector runs on
 * a timer.
 *
 * Those are product promises, so they are structural tests: the import
 * graph is what would break them, and an import is easier to notice than
 * a comment in a document. Each test names the file it guards, so adding
 * a new collector or a new reading tool is a decision someone has to make
 * here, in writing.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function filesUnder(dir: string, extension = ".ts"): string[] {
  const absolute = path.join(ROOT, dir);
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = path.join(absolute, entry);
    if (statSync(full).isDirectory()) {
      out.push(...filesUnder(path.join(dir, entry), extension));
    } else if (entry.endsWith(extension)) {
      out.push(path.join(dir, entry));
    }
  }
  return out;
}

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Every production (non-test) source file under a directory. */
function productionFiles(dir: string, extension = ".ts"): string[] {
  return filesUnder(dir, extension).filter((file) => !file.endsWith(".test.ts"));
}

/** The module specifiers an import or export statement mentions. */
function importsOf(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)) {
    out.push(match[1]);
  }
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push(match[1]);
  }
  return out;
}

/**
 * The five sources, exactly.
 *
 * Each one reads the user's own account or a file they exported from their
 * own phone, and each runs once, when the user presses the button:
 *
 * - feishu / dingtalk / slack — the user's own workspace account, through
 *   the credentials they entered;
 * - email — the user's own mailbox over IMAP;
 * - wechat_export — a file the user exported from their own device.
 *
 * A new source has to be added here, with a sentence saying whose data it
 * reads and when it runs. That sentence is the point of this test.
 */
const EXPECTED_COLLECTORS = ["feishu", "dingtalk", "slack", "email", "wechat_export"];

describe("the app does not become a surveillance tool", () => {
  it("never starts a collector from the scheduler", () => {
    const offenders: string[] = [];
    for (const file of productionFiles("server/scheduler")) {
      const source = read(file);
      if (/from\s+["'][^"']*collectors\//.test(source) || /collectors\/jobs/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the reading tools away from collectors, channels and WeChat", () => {
    // The reading tools are the record reader, the reports, "read this
    // line" (C3.4), the waiting gauge (C3.1), the mirror (C4.1) and their
    // routes. They read what the user imported; they never reach a live
    // account.
    const readingFiles = [
      ...productionFiles("server/records"),
      ...(filesUnder("server/records", ".ts").includes("server/records/decode.ts")
        ? ["server/records/decode.ts"]
        : []),
      "server/routers-v6/record.ts",
      "server/routers-v6/style.ts",
      // The mirror's measurement lives in the style-profile builder, not
      // just in the route that reads it.
      "server/_core/style-profile.ts",
    ];
    const offenders: string[] = [];
    for (const file of readingFiles) {
      const source = read(file);
      for (const specifier of importsOf(source)) {
        if (
          /collectors\//.test(specifier) ||
          /channels\//.test(specifier) ||
          /wechat\//.test(specifier)
        ) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never imports records from a channel", () => {
    // What arrives on a channel is the user talking to the persona. The
    // other person's real messages only ever come from an import the user
    // started. If a channel could import, the app would be reading the
    // other person's words from a live connection.
    const offenders: string[] = [];
    for (const dir of ["server/channels", "server/wechat"]) {
      for (const file of productionFiles(dir)) {
        const source = read(file);
        if (/importRecords\s*\(/.test(source) || /from\s+["'][^"']*importers/.test(source)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has exactly the five collections, each manual", () => {
    const source = read("server/collectors/types.ts");
    const match = /export type CollectorSourceId =([^;]+);/.exec(source);
    expect(match).not.toBeNull();
    const ids = Array.from((match as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)).map(
      (entry) => entry[1],
    );
    expect(ids.sort()).toEqual([...EXPECTED_COLLECTORS].sort());
  });

  it("has no column for watching the other person", () => {
    const schema = read("drizzle/schema.ts");
    for (const banned of ["lastSeen", "onlineStatus", "readReceipt", "liveLocation"]) {
      // A substring, not a whole column name: `lastSeenAt` would be the
      // same kind of watching column.
      expect(schema).not.toMatch(new RegExp(banned, "i"));
    }
  });
});
