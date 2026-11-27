import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const SERVER = path.join(ROOT, "server");

/**
 * Variables the operating system provides, or the process runtime sets.
 *
 * These are not configuration: a person does not put them in `.env` and
 * the app does not choose their values. `server/_core/subprocess-env.ts`
 * passes most of them through to the Python collectors so a child process
 * finds its own tooling; the others are read by Node.js itself.
 */
const AMBIENT = new Set([
  // Passed through to child processes (subprocess-env.ts).
  "APPDATA",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LOCALAPPDATA",
  "NO_PROXY",
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  // Set by the runtime / package manager, not by a person.
  "NODE_ENV",
  "npm_package_version",
]);

/**
 * WP18's P18.1 requires every variable the handbook's appendix B added to
 * be in `.env.example`. Some of them are read through a helper that takes
 * the name as an argument (`readLimit("MAX_IMPORT_BYTES", …)`), so the
 * literal `process.env.NAME` scan below cannot see them; this list keeps
 * them honest.
 *
 * Source: docs/exec-v6.md appendix B.
 */
const APPENDIX_B = [
  "MAX_IMPORT_BYTES",
  "MAX_IMPORT_UNPACKED_BYTES",
  "OLLAMA_EMBED_MODEL",
  "PROMPT_LAYOUT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "STT_ENGINE",
  "WHISPER_CPP_BIN",
  "WHISPER_CPP_MODEL",
  "STT_HTTP_URL",
  "STT_HTTP_ALLOW_REMOTE",
  "TTS_ENGINE",
  "PIPER_BIN",
  "PIPER_MODEL",
  "TTS_HTTP_URL",
  "MAP_TILE_URL",
  "WEATHER_ENABLED",
  "OPENAI_COMPAT_ENABLED",
  "MIRRAI_PLUGINS",
  "MIRRAI_API_KEY",
];

function serverSources(dir: string = SERVER): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...serverSources(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Every `process.env.NAME` and `process.env["NAME"]` read in one file. */
function envReads(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g)) {
    names.add(match[1]);
  }
  return [...names];
}

/** The names assigned in `.env.example`, in file order. */
function documented(): Set<string> {
  const text = readFileSync(ENV_EXAMPLE, "utf-8");
  return new Set(
    [...text.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]),
  );
}

describe(".env.example", () => {
  it("documents every environment variable the server reads", () => {
    const known = documented();
    const missing = new Map<string, string[]>();
    for (const file of serverSources()) {
      const relative = path.relative(ROOT, file);
      for (const name of envReads(readFileSync(file, "utf-8"))) {
        if (known.has(name) || AMBIENT.has(name)) continue;
        const files = missing.get(name) ?? [];
        files.push(relative);
        missing.set(name, files);
      }
    }
    expect(
      [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([]);
  });

  it("documents every variable the handbook's appendix B added", () => {
    const known = documented();
    expect(APPENDIX_B.filter((name) => !known.has(name))).toEqual([]);
  });

  it("documents nothing twice", () => {
    const text = readFileSync(ENV_EXAMPLE, "utf-8");
    const names = [...text.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });
});
