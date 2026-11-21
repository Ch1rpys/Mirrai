#!/usr/bin/env node
/**
 * Full backup, restore and verify from a terminal (C8.3).
 *
 * The interface can download a signed-in user's own backup and restore
 * into a fresh instance. This script is the operator's path: a whole
 * instance without starting the app, and a restore into an empty
 * database.
 *
 *   pnpm tsx scripts/backup.ts create --out <path> [--user <id>]
 *   pnpm tsx scripts/backup.ts restore --in <path>
 *   pnpm tsx scripts/backup.ts verify --in <path>
 *
 * The passphrase is never a command-line argument — that would put it in
 * the shell history. Both create and restore take `--passphrase-file
 * <path>` instead.
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, flags };
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  if (typeof value !== "string" || !value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

/** The passphrase, read from the file the operator pointed at. */
function passphraseFrom(args: ParsedArgs): string | null {
  const file = args.flags.get("passphrase-file");
  if (typeof file !== "string") return null;
  if (!existsSync(file)) throw new Error(`The passphrase file ${file} does not exist.`);
  const value = readFileSync(file, "utf-8").replace(/\r?\n$/, "");
  if (!value) throw new Error("The passphrase file is empty.");
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { createBackup, restoreBackup, verifyBackup } = await import("../server/_core/backup");

  if (args.command === "create") {
    const out = path.resolve(requireFlag(args, "out"));
    const userFlag = args.flags.get("user");
    const user = typeof userFlag === "string" ? Number(userFlag) : null;
    if (userFlag !== undefined && (!Number.isInteger(user) || Number(user) <= 0)) {
      throw new Error("--user takes the numeric id of one user.");
    }
    const passphrase = passphraseFrom(args);
    const created = await createBackup({
      scope: user === null ? "instance" : user,
      passphrase,
      out,
    });
    const rows = created.manifest.tables.reduce((sum, part) => sum + part.rows, 0);
    console.log(
      `[backup] ${created.file} (${created.bytes} bytes, ${rows} rows, ` +
        `${created.manifest.uploads.length} files, ${passphrase ? "encrypted" : "not encrypted"})`,
    );
    return;
  }

  if (args.command === "verify") {
    const file = path.resolve(requireFlag(args, "in"));
    const passphrase = passphraseFrom(args);
    const verified = await verifyBackup({ file, passphrase });
    const rows = verified.tables.reduce((sum, part) => sum + part.rows, 0);
    console.log(
      `[backup] ${file} is intact: ${verified.tables.length} tables, ${rows} rows, ` +
        `${verified.uploads.length} files, written ${verified.createdAt} by Mirrai ${verified.appVersion}.`,
    );
    return;
  }

  if (args.command === "restore") {
    const file = path.resolve(requireFlag(args, "in"));
    const passphrase = passphraseFrom(args);
    const restored = await restoreBackup({ file, passphrase });
    console.log(
      `[backup] restored ${restored.tables} tables (${restored.rows} rows) and ` +
        `${restored.files} files; ${restored.migrations.length} migration(s) recorded.`,
    );
    return;
  }

  throw new Error(
    "Usage: tsx scripts/backup.ts create --out <path> [--user <id>] [--passphrase-file <path>] | " +
      "restore --in <path> [--passphrase-file <path>] | verify --in <path>",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backup] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
