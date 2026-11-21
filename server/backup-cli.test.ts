import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(path.resolve(__dirname, "..", "scripts", "backup.ts"), "utf-8");

/**
 * The command line takes no passphrase argument (C8.3).
 *
 * A passphrase on the command line goes into the shell history and into
 * the process list. The script reads `--passphrase-file` instead, and
 * this test is what keeps it that way.
 */
describe("the backup command line", () => {
  it("has no passphrase option, only a passphrase file", () => {
    expect(SOURCE).toContain("--passphrase-file");
    expect(SOURCE).not.toMatch(/--passphrase(?!-file)/);
    expect(SOURCE).not.toMatch(/flags\.get\(\s*["']passphrase["']\s*\)/);
  });

  it("offers create, restore and verify", () => {
    expect(SOURCE).toContain('args.command === "create"');
    expect(SOURCE).toContain('args.command === "restore"');
    expect(SOURCE).toContain('args.command === "verify"');
  });

  it("uses the shared backup module rather than its own copy", () => {
    expect(SOURCE).toContain('import("../server/_core/backup")');
    expect(SOURCE).toContain("createBackup");
    expect(SOURCE).toContain("restoreBackup");
    expect(SOURCE).toContain("verifyBackup");
  });
});
