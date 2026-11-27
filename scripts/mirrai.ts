#!/usr/bin/env node
/**
 * The command line face of Mirrai (C9.6).
 *
 * Every subcommand calls the same function the route calls — the tRPC
 * caller is the router itself, the import is the upload route's own
 * sequence of helpers, the export is the function behind the download
 * route. There is no second implementation of anything here; this file is
 * argument parsing, output and waiting.
 *
 *   pnpm mirrai -- import <file> --persona <id> --user <id> [--format] [--me] [--them]
 *   pnpm mirrai -- distill --persona <id> --user <id> [--mode fast|standard|deep] [--yes]
 *   pnpm mirrai -- measure --persona <id> --user <id>
 *   pnpm mirrai -- eval …                         (forwarded to scripts/eval-run.ts)
 *   pnpm mirrai -- export --persona <id> --user <id> --out <path> [--with-records]
 *   pnpm mirrai -- backup …                       (forwarded to scripts/backup.ts)
 *   pnpm mirrai -- doctor --user <id>
 *
 * `--json` prints one JSON line instead of sentences. A failure writes its
 * reason to standard error and exits non-zero. A passphrase is read from a
 * file (`--passphrase-file`) or asked for interactively — never from the
 * argument list, which the shell keeps in its history.
 *
 * The command line has no session, so every subcommand needs `--user <id>`,
 * the same way `pnpm eval` does.
 */
import "dotenv/config";
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { nanoid } from "nanoid";
import { appRouter } from "../server/routers";
import { copy } from "@shared/copy";
import { normalizePersonaSettings } from "@shared/persona-settings";
import { personaLocked } from "../server/_core/app-lock";
import { assertPersonaWritable } from "../server/_core/persona-access";
import { excerptHead } from "../server/importers/excerpt";
import type { TrpcContext } from "../server/_core/context";
import { ENV } from "../server/_core/env";
import { resolveUploadPath, sanitizeFileName, importEntryKind, checkFileExtension } from "../server/_core/filename";
import * as db from "../server/db";
import { startImport } from "../server/importers/index";
import { maxImportFileBytes } from "../server/importers/archive";
import { exportPersonaBundle } from "../server/personas/bundle";
import type { ImportFormatId } from "../server/importers/types";

// ─── argument parsing ───────────────────────────────────────────────────────

export type MirraiCommand =
  | "import"
  | "distill"
  | "measure"
  | "eval"
  | "export"
  | "backup"
  | "doctor";

const COMMANDS: MirraiCommand[] = [
  "import",
  "distill",
  "measure",
  "eval",
  "export",
  "backup",
  "doctor",
];

export interface ParsedArgs {
  command: MirraiCommand | null;
  /** Everything after the command, for the forwarded subcommands. */
  forwarded: string[];
  flags: Map<string, string | true>;
  positionals: string[];
  json: boolean;
  help: boolean;
}

/** Flags that take a value; everything else is a boolean. */
const VALUE_FLAGS = new Set([
  "user",
  "persona",
  "format",
  "me",
  "them",
  "mode",
  "out",
  "passphrase-file",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  const empty = (help: boolean): ParsedArgs => ({
    command: null,
    forwarded: [],
    flags,
    positionals: [],
    json: argv.includes("--json"),
    help,
  });
  if (argv.includes("-h") || argv.includes("--help")) return empty(true);

  const first = argv[0];
  if (!first || first.startsWith("-")) return empty(false);
  if (!(COMMANDS as string[]).includes(first)) {
    return { ...empty(false), positionals: [first] };
  }
  const command = first as MirraiCommand;
  const rest = argv.slice(1);
  // The two forwarded scripts have their own parsers; they get the tail
  // exactly as it was typed, including their own `--user`.
  if (command === "eval" || command === "backup") {
    return {
      command,
      forwarded: rest,
      flags,
      positionals: [],
      json: rest.includes("--json"),
      help: false,
    };
  }
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--json") {
      flags.set("json", true);
      continue;
    }
    if (token.startsWith("--")) {
      /**
       * Both `--name value` and `--name=value` are read.
       *
       * The equals form matters for the passphrase rule: a person who
       * types `--passphrase=secret` must get the refusal, not a silently
       * written plaintext file. Keeping the inline value on the flag is
       * what lets `runExport` see it.
       */
      const body = token.slice(2);
      const equals = body.indexOf("=");
      const name = equals === -1 ? body : body.slice(0, equals);
      const inline = equals === -1 ? undefined : body.slice(equals + 1);
      if (VALUE_FLAGS.has(name)) {
        const value = inline ?? rest[index + 1];
        if (inline === undefined && (!value || String(value).startsWith("--"))) {
          flags.set(name, true);
        } else {
          flags.set(name, value as string);
          if (inline === undefined) index += 1;
        }
      } else if (inline !== undefined) {
        flags.set(name, inline);
      } else {
        flags.set(name, true);
      }
      continue;
    }
    positionals.push(token);
  }
  return {
    command,
    forwarded: [],
    flags,
    positionals,
    json: flags.has("json"),
    help: false,
  };
}

// ─── output ─────────────────────────────────────────────────────────────────

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const consoleIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** What a subcommand needs from the outside world; tests pass fakes. */
export interface MirraiDeps {
  getUserById(id: number): Promise<{ id: number; name?: string | null } | undefined>;
  getPersonaById(
    id: number,
    userId: number,
  ): Promise<{
    id: number;
    name?: string | null;
    analysisStatus?: string | null;
    settings?: unknown;
    sharedFromPersonaId?: number | null;
  } | undefined>;
  createCaller(context: TrpcContext): any;
  createPersonaFile(input: Record<string, unknown>): Promise<number>;
  deletePersonaFile(fileId: number, userId: number): Promise<unknown>;
  startImport(input: Record<string, unknown>): Promise<{ status: string; written: number }>;
  exportPersonaBundle(input: {
    personaId: number;
    userId: number;
    include: { memories: boolean; records: boolean; conversation: boolean };
    passphrase: string | null;
    outPath: string;
  }): Promise<{ bytes: number; fileName: string; manifest: { counts: Record<string, number> } }>;
  forward(script: "eval-run" | "backup", argv: string[]): number;
  /** Asks a question and reads a line; null when the terminal is not one. */
  ask(question: string): Promise<string | null>;
}

function cliContext(user: { id: number }): TrpcContext {
  // tRPC's context normally comes from Express. The command line has no
  // request; the router's middleware reads `headers` and, for a user-scoped
  // limit, the user id — both are here.
  return {
    req: { headers: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" } } as never,
    res: {} as never,
    user: user as never,
    locale: "zh",
  };
}

/** The real thing, wired to the app's own functions. */
export function defaultDeps(): MirraiDeps {
  return {
    getUserById: (id) => db.getUserById(id),
    getPersonaById: (id, userId) => db.getPersonaById(id, userId),
    createCaller: (context) => appRouter.createCaller(context),
    createPersonaFile: async (input) =>
      db.createPersonaFile(input as never),
    deletePersonaFile: (fileId, userId) => db.deletePersonaFile(fileId, userId),
    startImport: async (input) => startImport(input as never),
    exportPersonaBundle: async (input) => exportPersonaBundle(input),
    forward: (script, argv) => {
      const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
      const file = path.resolve("scripts", `${script}.ts`);
      const result = spawnSync(process.execPath, [tsx, file, ...argv], {
        stdio: "inherit",
      });
      return result.status ?? 1;
    },
    ask: async (question) => {
      if (!process.stdin.isTTY) return null;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

// ─── usage ──────────────────────────────────────────────────────────────────

export const USAGE = `mirrai — the command line

  mirrai import <file> --persona <id> --user <id> [--format <id>] [--me <name>] [--them <name>]
  mirrai distill --persona <id> --user <id> [--mode fast|standard|deep] [--yes]
  mirrai measure --persona <id> --user <id>
  mirrai eval <arguments…> --user <id>        (forwarded to scripts/eval-run.ts)
  mirrai backup <arguments…>                  (forwarded to scripts/backup.ts)
  mirrai export --persona <id> --user <id> --out <path> [--with-records] [--passphrase-file <path>]
  mirrai doctor --user <id>

Every command takes --user <id>: the command line has no session.
--json prints one JSON line. Failures go to standard error and exit non-zero.
Passphrases are read from a file or asked for; never pass one as an argument.`;

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function requiredNumber(args: ParsedArgs, name: string): number | null {
  const raw = flag(args, name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function fail(io: CliIo, message: string): number {
  io.err(message);
  return 1;
}

// ─── the subcommands ────────────────────────────────────────────────────────

async function runImport(args: ParsedArgs, deps: MirraiDeps, io: CliIo, userId: number): Promise<number> {
  const filePath = args.positionals[0];
  if (!filePath) return fail(io, "import needs a file: mirrai import <file> --persona <id> --user <id>");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return fail(io, `No such file: ${filePath}`);
  }
  const personaId = requiredNumber(args, "persona");
  if (personaId == null) return fail(io, "import needs --persona <id>.");

  const persona = await deps.getPersonaById(personaId, userId);
  if (!persona) return fail(io, `No persona ${personaId} for user ${userId}.`);
  /**
   * The upload route's checks, in the same order: a read-only shared
   * persona does not take records (C7.2), and a locked persona does not
   * either (C8.4). The command line has no PIN, so a lock means the
   * person has to unlock in the app — but this process has no session,
   * so it refuses rather than pretending.
   */
  try {
    assertPersonaWritable(persona, "zh");
  } catch (error) {
    return fail(io, error instanceof Error ? error.message : String(error));
  }
  if (await personaLocked(normalizePersonaSettings(persona.settings), null)) {
    return fail(io, copy("zh", "lock.personaCli"));
  }

  const safeName = sanitizeFileName(path.basename(filePath));
  const kind = importEntryKind(safeName);
  if (kind !== "chat" && kind !== "archive") {
    return fail(io, `The importer does not read ${path.extname(safeName) || "that file"}.`);
  }
  const fileType = kind === "archive" ? "archive" : "chat_export";
  const problem = checkFileExtension(safeName, fileType, "zh");
  if (problem) return fail(io, problem);
  const bytes = statSync(filePath).size;
  if (bytes > maxImportFileBytes()) {
    return fail(io, `That file is larger than the import limit (${maxImportFileBytes()} bytes).`);
  }

  // The upload route's own sequence: copy the file into the uploads
  // directory, create the persona_file row (with the readable excerpt),
  // then run the importer.
  const fileKey = `personas/${userId}/${personaId}/${nanoid()}-${safeName}`;
  const absPath = resolveUploadPath(ENV.uploadDir, fileKey);
  mkdirSync(path.dirname(absPath), { recursive: true });
  copyFileSync(filePath, absPath);

  let extractedMemory: string | undefined;
  if (fileType === "chat_export") {
    extractedMemory = await excerptHead(absPath).catch(() => undefined);
  }

  let fileId: number;
  try {
    fileId = await deps.createPersonaFile({
      personaId,
      userId,
      fileType,
      originalName: safeName,
      fileKey,
      fileUrl: `/uploads/${fileKey}`,
      fileSize: bytes,
      extractedMemory,
      processStatus: "done",
    });
  } catch (error) {
    await unlink(absPath).catch(() => undefined);
    return fail(io, error instanceof Error ? error.message : String(error));
  }

  const me = flag(args, "me");
  const them = flag(args, "them");
  const format = flag(args, "format") as ImportFormatId | undefined;
  let result: Awaited<ReturnType<MirraiDeps["startImport"]>>;
  try {
    result = await deps.startImport({
      fileId,
      userId,
      locale: "zh",
      ...(format ? { format } : {}),
      ...(me ? { me: [me] } : {}),
      ...(them ? { them: [them] } : {}),
    });
  } catch (error) {
    /**
     * A failed import must not leave the uploaded bytes or a file row
     * behind — the route cleans up the same way. `needs_*` returns are
     * not exceptions: they are the wizard's states and keep the file so
     * the app can continue.
     */
    await unlink(absPath).catch(() => undefined);
    await deps.deletePersonaFile(fileId, userId).catch(() => undefined);
    return fail(io, error instanceof Error ? error.message : String(error));
  }
  if (args.json) {
    io.out(JSON.stringify({ fileId, fileKey, status: result.status, written: result.written }));
  }
  if (result.status === "done") {
    if (!args.json) {
      io.out(`Imported ${result.written} records.`);
      io.out(`fileId ${fileId}`);
    }
    return 0;
  }
  /**
   * The wizard's intermediate states cannot be finished from a terminal:
   * report them as a failure, with the reason on standard error. The file
   * and the row stay so the app can pick the import up.
   */
  return fail(
    io,
    args.json
      ? `The import stopped at ${result.status}; finish it in the app.`
      : `Imported ${result.written} records, but the import stopped at ${result.status}; finish it in the app.`,
  );
}

async function runDistill(args: ParsedArgs, deps: MirraiDeps, io: CliIo, userId: number): Promise<number> {
  const personaId = requiredNumber(args, "persona");
  if (personaId == null) return fail(io, "distill needs --persona <id>.");
  const mode = flag(args, "mode");
  if (mode && !["fast", "standard", "deep", "colleague", "celebrity"].includes(mode)) {
    return fail(io, `Unknown --mode ${mode}. Use fast, standard or deep.`);
  }
  const caller = deps.createCaller(cliContext({ id: userId }));
  const estimate = await caller.skillEngine.estimate({
    personaId,
    ...(mode ? { mode } : {}),
  });
  const estimateLine = `This run reads about ${estimate.chars} characters and makes about ${estimate.calls} model calls.`;
  if (!args.json) io.out(estimateLine);
  if (!boolFlag(args, "yes")) {
    const answer = await deps.ask("Start the distillation? [y/N] ");
    if (answer == null || !/^y(es)?$/i.test(answer.trim())) {
      if (args.json) io.out(JSON.stringify({ estimate, started: false }));
      return fail(io, "Not started.");
    }
  }
  await caller.skillEngine.startPipeline({
    personaId,
    ...(mode ? { mode } : {}),
  });
  // The route starts the run in the background; the command line waits,
  // because a terminal command that returns before the work is done is
  // not usable in a script.
  const deadline = Date.now() + 60 * 60 * 1000;
  let lastProgress = -1;
  for (;;) {
    if (Date.now() > deadline) return fail(io, "The distillation did not finish within an hour.");
    const row = await deps.getPersonaById(personaId, userId);
    if (!row) return fail(io, `No persona ${personaId} for user ${userId}.`);
    const status = String((row as { analysisStatus?: string }).analysisStatus ?? "");
    const progress = Number((row as { analysisProgress?: number }).analysisProgress ?? 0);
    if (!args.json && progress !== lastProgress) {
      lastProgress = progress;
      io.out(`${status} ${progress}%${(row as { analysisMessage?: string }).analysisMessage ? ` — ${(row as { analysisMessage?: string }).analysisMessage}` : ""}`);
    }
    if (status === "ready" || status === "error") {
      if (args.json) {
        io.out(JSON.stringify({
          estimate,
          personaId,
          status,
          message: (row as { analysisMessage?: string }).analysisMessage ?? null,
        }));
      } else {
        io.out(status === "ready" ? "The persona was rebuilt." : "The distillation failed.");
      }
      return status === "ready" ? 0 : 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function runMeasure(args: ParsedArgs, deps: MirraiDeps, io: CliIo, userId: number): Promise<number> {
  const personaId = requiredNumber(args, "persona");
  if (personaId == null) return fail(io, "measure needs --persona <id>.");
  const caller = deps.createCaller(cliContext({ id: userId }));
  const result = await caller.style.measure({ personaId });
  const profile = result?.profile ?? result ?? null;
  const measured = profile && typeof profile === "object";
  if (args.json) {
    io.out(JSON.stringify({ personaId, measured: Boolean(measured), profile: measured ? profile : null }));
  } else {
    io.out(measured ? `Measured the style of persona ${personaId}.` : `Nothing measurable for persona ${personaId}.`);
  }
  return 0;
}

async function runExport(args: ParsedArgs, deps: MirraiDeps, io: CliIo, userId: number): Promise<number> {
  const personaId = requiredNumber(args, "persona");
  if (personaId == null) return fail(io, "export needs --persona <id>.");
  const persona = await deps.getPersonaById(personaId, userId);
  if (!persona) return fail(io, `No persona ${personaId} for user ${userId}.`);
  /** The download route refuses a locked persona (C8.4); so does this. */
  if (await personaLocked(normalizePersonaSettings(persona.settings), null)) {
    return fail(io, copy("zh", "lock.personaCli"));
  }
  const out = flag(args, "out");
  if (!out) return fail(io, "export needs --out <path>.");
  const passphraseFile = flag(args, "passphrase-file");
  /**
   * A passphrase must never be read from the argument list: the shell
   * keeps a command's arguments in its history. Silently ignoring a
   * `--passphrase` would write a plaintext file while the person
   * believed it was encrypted, so it is refused by name.
   */
  if (args.flags.has("passphrase")) {
    return fail(io, "A passphrase is never read from an argument; use --passphrase-file <path>.");
  }
  let passphrase: string | null = null;
  if (passphraseFile) {
    if (!existsSync(passphraseFile)) return fail(io, `No such file: ${passphraseFile}`);
    passphrase = readFileSync(passphraseFile, "utf-8").trim();
    if (!passphrase) return fail(io, `The passphrase file is empty: ${passphraseFile}`);
  } else {
    // A passphrase is never an argument; a terminal user may be asked.
    const answer = await deps.ask("Passphrase for the file (leave empty for none): ");
    passphrase = answer && answer.trim() ? answer.trim() : null;
  }
  const include = {
    memories: true,
    records: boolFlag(args, "with-records"),
    conversation: false,
  };
  const written = await deps.exportPersonaBundle({
    personaId,
    userId,
    include,
    passphrase,
    outPath: path.resolve(out),
  });
  if (args.json) {
    io.out(JSON.stringify({
      personaId,
      out: path.resolve(out),
      bytes: written.bytes,
      fileName: written.fileName,
      counts: written.manifest.counts,
    }));
  } else {
    io.out(`Wrote ${written.bytes} bytes to ${path.resolve(out)}.`);
    io.out(`records ${written.manifest.counts.records ?? 0}, memories ${written.manifest.counts.memories ?? 0}, stickers ${written.manifest.counts.stickers ?? 0}.`);
  }
  return 0;
}

async function runDoctor(args: ParsedArgs, deps: MirraiDeps, io: CliIo, userId: number): Promise<number> {
  const caller = deps.createCaller(cliContext({ id: userId }));
  const result = await caller.system.diagnose();
  const items = Array.isArray(result?.items) ? result.items : [];
  if (args.json) {
    io.out(JSON.stringify({ items }));
  } else {
    for (const item of items) {
      io.out(`${String(item.status).toUpperCase().padEnd(7)} ${item.id}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  }
  const failing = items.filter((item: { status?: string }) => item.status === "fail").length;
  return failing > 0 ? 1 : 0;
}

// ─── the entry point ────────────────────────────────────────────────────────

export async function runMirrai(
  argv: string[],
  deps: MirraiDeps = defaultDeps(),
  io: CliIo = consoleIo,
): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    io.out(USAGE);
    return 0;
  }
  if (!args.command) {
    if (args.positionals[0]) return fail(io, `Unknown command: ${args.positionals[0]}\n\n${USAGE}`);
    io.out(USAGE);
    return 2;
  }
  if (args.command === "eval" || args.command === "backup") {
    // The two scripts have their own parsers and their own `--user`.
    const script = args.command === "eval" ? "eval-run" : "backup";
    return deps.forward(script, args.forwarded);
  }
  const rawUser = flag(args, "user");
  const userId = rawUser ? Number(rawUser) : NaN;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return fail(io, `--user <id> is required: the command line has no session.\n\n${USAGE}`);
  }
  const user = await deps.getUserById(userId);
  if (!user) return fail(io, `No user ${userId}.`);

  try {
    switch (args.command) {
      case "import":
        return await runImport(args, deps, io, userId);
      case "distill":
        return await runDistill(args, deps, io, userId);
      case "measure":
        return await runMeasure(args, deps, io, userId);
      case "export":
        return await runExport(args, deps, io, userId);
      case "doctor":
        return await runDoctor(args, deps, io, userId);
      default:
        return fail(io, `Unknown command: ${String(args.command)}`);
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// The script runs only when it is the entry point, so a test can import it.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  runMirrai(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
