import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The command line (C9.6).
 *
 * Two things are worth pinning: the arguments are read the way the manual
 * spells them (a missing `--user`, an unknown command and `--help` all
 * behave), and every subcommand calls the function behind the route —
 * the tRPC caller, the importer, the bundle export — rather than a second
 * implementation.
 *
 * The dependencies are injected, so "called the expected function" is an
 * assertion and not an inference. The only real I/O is a temporary file
 * and a temporary uploads directory.
 */

const { uploadRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const pathMod = require("node:path") as typeof import("node:path");
  return { uploadRoot: mkdtempSync(pathMod.join(tmpdir(), "mirrai-cli-uploads-")) };
});

vi.mock("../server/_core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/_core/env")>();
  return { ...actual, ENV: { ...actual.ENV, uploadDir: uploadRoot } };
});

import { ENV } from "../server/_core/env";
import { parseArgs, runMirrai, USAGE, type MirraiDeps } from "./mirrai";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-cli-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(uploadRoot, { recursive: true, force: true });
});

function output() {
  const lines: string[] = [];
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    lines,
    outLines,
    errLines,
    io: {
      out: (line: string) => { lines.push(line); outLines.push(line); },
      err: (line: string) => { lines.push(line); errLines.push(line); },
    },
  };
}

function deps(overrides: Partial<MirraiDeps> = {}) {
  const caller = {
    skillEngine: {
      estimate: vi.fn().mockResolvedValue({ chars: 1200, calls: 3 }),
      startPipeline: vi.fn().mockResolvedValue({ success: true }),
    },
    style: { measure: vi.fn().mockResolvedValue({ profile: { fingerprint: { samples: 60 } } }) },
    system: { diagnose: vi.fn().mockResolvedValue({ items: [{ id: "database", status: "ok" }] }) },
  };
  const base: MirraiDeps = {
    getUserById: vi.fn().mockResolvedValue({ id: 1, name: "阿树" }),
    getPersonaById: vi.fn().mockResolvedValue({ id: 3, name: "小满", analysisStatus: "ready" }),
    createCaller: vi.fn().mockReturnValue(caller),
    createPersonaFile: vi.fn().mockResolvedValue(11),
    deletePersonaFile: vi.fn().mockResolvedValue(true),
    startImport: vi.fn().mockResolvedValue({ status: "done", written: 2 }),
    exportPersonaBundle: vi.fn().mockResolvedValue({
      bytes: 1024,
      fileName: "小满.mirrai-persona",
      manifest: { counts: { records: 2, memories: 1, stickers: 0 } },
    }),
    forward: vi.fn().mockReturnValue(0),
    ask: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return { base, caller };
}

function chatFile(name = "chat.txt"): string {
  const file = path.join(dir, name);
  writeFileSync(file, "[2022-03-01 20:00:00] 小满：在吗\n[2022-03-01 20:00:05] 阿树：在的\n");
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the arguments", () => {
  it("takes the command, its flags and its positionals", () => {
    const parsed = parseArgs([
      "import", "chat.txt", "--persona", "3", "--user", "1", "--me", "阿树", "--json",
    ]);
    expect(parsed.command).toBe("import");
    expect(parsed.positionals).toEqual(["chat.txt"]);
    expect(parsed.flags.get("persona")).toBe("3");
    expect(parsed.flags.get("user")).toBe("1");
    expect(parsed.flags.get("me")).toBe("阿树");
    expect(parsed.json).toBe(true);
  });

  it("reads the equals form of a flag", () => {
    const parsed = parseArgs([
      "import", "chat.txt", "--persona=3", "--user=1", "--passphrase=secret",
    ]);
    expect(parsed.flags.get("persona")).toBe("3");
    expect(parsed.flags.get("user")).toBe("1");
    // The inline value stays visible so the passphrase rule can refuse it.
    expect(parsed.flags.get("passphrase")).toBe("secret");
  });

  it("keeps the tail of a forwarded command exactly as typed", () => {
    const parsed = parseArgs(["eval", "--persona", "3", "--user", "1", "--without", "act,rerank"]);
    expect(parsed.command).toBe("eval");
    expect(parsed.forwarded).toEqual(["--persona", "3", "--user", "1", "--without", "act,rerank"]);
  });

  it("prints the usage for --help", async () => {
    const { lines, io } = output();
    const code = await runMirrai(["--help"], deps().base, io);
    expect(code).toBe(0);
    expect(lines.join("\n")).toBe(USAGE);
  });

  it("refuses a command without --user", async () => {
    const { lines, io } = output();
    const code = await runMirrai(["measure", "--persona", "3"], deps().base, io);
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("--user");
  });

  it("refuses an unknown command", async () => {
    const { lines, io } = output();
    const code = await runMirrai(["frobnicate", "--user", "1"], deps().base, io);
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("Unknown command");
  });

  it("refuses a user the database does not have", async () => {
    const { base } = deps({ getUserById: vi.fn().mockResolvedValue(undefined) });
    const { lines, io } = output();
    const code = await runMirrai(["measure", "--persona", "3", "--user", "9"], base, io);
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("No user 9");
  });
});

describe("the subcommands call the function behind the route", () => {
  it("import: creates the file row and runs the same importer", async () => {
    const { base } = deps();
    const { lines, io } = output();
    const code = await runMirrai(
      ["import", chatFile(), "--persona", "3", "--user", "1", "--me", "阿树", "--them", "小满"],
      base,
      io,
    );
    expect(code).toBe(0);
    expect(base.createPersonaFile).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 3,
      userId: 1,
      fileType: "chat_export",
      originalName: "chat.txt",
      extractedMemory: expect.stringContaining("在吗"),
    }));
    expect(base.startImport).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 11,
      userId: 1,
      me: ["阿树"],
      them: ["小满"],
    }));
    expect(lines.join("\n")).toContain("Imported 2 records");
  });

  it("import: a missing file fails without touching the database", async () => {
    const { base } = deps();
    const { io } = output();
    const code = await runMirrai(
      ["import", path.join(dir, "nope.txt"), "--persona", "3", "--user", "1"],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(base.createPersonaFile).not.toHaveBeenCalled();
  });

  it("distill: prints the estimate, asks, then starts the same pipeline", async () => {
    const { base, caller } = deps({ ask: vi.fn().mockResolvedValue("y") });
    const { lines, io } = output();
    const code = await runMirrai(
      ["distill", "--persona", "3", "--user", "1", "--mode", "fast"],
      base,
      io,
    );
    expect(code).toBe(0);
    expect(caller.skillEngine.estimate).toHaveBeenCalledWith({ personaId: 3, mode: "fast" });
    expect(caller.skillEngine.startPipeline).toHaveBeenCalledWith({ personaId: 3, mode: "fast" });
    expect(lines.join("\n")).toContain("1200 characters");
  });

  it("distill: does not start without a yes", async () => {
    const { base, caller } = deps({ ask: vi.fn().mockResolvedValue("n") });
    const { io } = output();
    const code = await runMirrai(["distill", "--persona", "3", "--user", "1"], base, io);
    expect(code).not.toBe(0);
    expect(caller.skillEngine.startPipeline).not.toHaveBeenCalled();
  });

  it("distill: --yes starts without asking", async () => {
    const { base, caller } = deps();
    const { io } = output();
    const code = await runMirrai(["distill", "--persona", "3", "--user", "1", "--yes"], base, io);
    expect(code).toBe(0);
    expect(base.ask).not.toHaveBeenCalled();
    expect(caller.skillEngine.startPipeline).toHaveBeenCalled();
  });

  it("measure: calls the style route", async () => {
    const { base, caller } = deps();
    const { io } = output();
    const code = await runMirrai(["measure", "--persona", "3", "--user", "1"], base, io);
    expect(code).toBe(0);
    expect(caller.style.measure).toHaveBeenCalledWith({ personaId: 3 });
  });

  it("export: reads the passphrase from a file, never from an argument", async () => {
    const passphraseFile = path.join(dir, "passphrase.txt");
    writeFileSync(passphraseFile, "a long passphrase\n");
    const { base } = deps();
    const { io } = output();
    const out = path.join(dir, "out.mirrai-persona");
    const code = await runMirrai(
      [
        "export", "--persona", "3", "--user", "1", "--out", out,
        "--with-records", "--passphrase-file", passphraseFile,
      ],
      base,
      io,
    );
    expect(code).toBe(0);
    expect(base.exportPersonaBundle).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 3,
      userId: 1,
      include: { memories: true, records: true, conversation: false },
      passphrase: "a long passphrase",
      outPath: out,
    }));
  });

  it("refuses a passphrase given as an argument", async () => {
    const { base } = deps();
    const { lines, io } = output();
    const code = await runMirrai(
      [
        "export", "--persona", "3", "--user", "1", "--out", path.join(dir, "arg.mirrai-persona"),
        // The manual says a passphrase is never read from the argument
        // list; ignoring it would silently write a plaintext file.
        "--passphrase", "a long passphrase",
      ],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(base.exportPersonaBundle).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("--passphrase-file");
  });

  it("doctor: prints the items, and one JSON line with --json", async () => {
    const { base } = deps();
    const human = output();
    const code = await runMirrai(["doctor", "--user", "1"], base, human.io);
    expect(code).toBe(0);
    expect(human.lines.join("\n")).toContain("database");

    const json = output();
    const jsonCode = await runMirrai(["doctor", "--user", "1", "--json"], base, json.io);
    expect(jsonCode).toBe(0);
    expect(json.lines).toHaveLength(1);
    expect(Array.isArray(JSON.parse(json.lines[0]).items)).toBe(true);
  });

  it("doctor: exits non-zero when an item failed (C9.6)", async () => {
    const { base } = deps({
      createCaller: vi.fn().mockReturnValue({
        system: {
          diagnose: vi.fn().mockResolvedValue({
            items: [
              { id: "database", status: "ok" },
              { id: "redis", status: "fail", detail: "unreachable" },
            ],
          }),
        },
      }),
    });
    const { lines, io } = output();
    const code = await runMirrai(["doctor", "--user", "1"], base, io);
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("redis");
  });

  it("every --json line parses", async () => {
    const { base } = deps();
    for (const argv of [
      ["measure", "--persona", "3", "--user", "1", "--json"],
      ["distill", "--persona", "3", "--user", "1", "--yes", "--json"],
    ]) {
      const { lines, io } = output();
      await runMirrai(argv, base, io);
      const jsonLine = lines.find((line) => line.trim().startsWith("{"));
      expect(jsonLine).toBeDefined();
      expect(() => JSON.parse(jsonLine!)).not.toThrow();
    }
  });

  it("import: refuses a locked persona without writing anything", async () => {
    const { base } = deps({
      getPersonaById: vi.fn().mockResolvedValue({ id: 3, settings: { locked: true } }),
    });
    const { lines, io } = output();
    const code = await runMirrai(
      ["import", chatFile("locked.txt"), "--persona", "3", "--user", "1"],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("锁着");
    expect(base.createPersonaFile).not.toHaveBeenCalled();
    expect(base.startImport).not.toHaveBeenCalled();
  });

  it("import: refuses a shared read-only persona", async () => {
    const { base } = deps({
      getPersonaById: vi.fn().mockResolvedValue({ id: 3, sharedFromPersonaId: 9 }),
    });
    const { lines, io } = output();
    const code = await runMirrai(
      ["import", chatFile("shared.txt"), "--persona", "3", "--user", "1"],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("家人共用");
    expect(base.createPersonaFile).not.toHaveBeenCalled();
  });

  it("import: a failed import cleans up the uploaded file and its row", async () => {
    const { base } = deps({
      startImport: vi.fn().mockRejectedValue(new Error("the importer exploded")),
    });
    const { lines, io } = output();
    const code = await runMirrai(
      ["import", chatFile("cleanup.txt"), "--persona", "3", "--user", "1"],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("the importer exploded");
    expect(base.deletePersonaFile).toHaveBeenCalledWith(11, 1);
    const folder = path.join(ENV.uploadDir, "personas", "1", "3");
    const remaining = existsSync(folder) ? readdirSync(folder) : [];
    // Other tests may leave their own uploads here; only this file matters.
    expect(remaining.filter((name) => name.endsWith("-cleanup.txt"))).toEqual([]);
  });

  it("import: a needs_roles stop exits non-zero and says why", async () => {
    const { base } = deps({
      startImport: vi.fn().mockResolvedValue({ status: "needs_roles", written: 0 }),
    });
    const { errLines, io } = output();
    const code = await runMirrai(
      ["import", chatFile("needs-roles.txt"), "--persona", "3", "--user", "1"],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(errLines.join("\n")).toContain("needs_roles");
  });

  it("export: refuses a locked persona", async () => {
    const { base } = deps({
      getPersonaById: vi.fn().mockResolvedValue({ id: 3, settings: { locked: true } }),
    });
    const { lines, io } = output();
    const code = await runMirrai(
      ["export", "--persona", "3", "--user", "1", "--out", path.join(dir, "locked.mirrai-persona")],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("锁着");
    expect(base.exportPersonaBundle).not.toHaveBeenCalled();
  });

  it("export: refuses the equals form of a passphrase argument", async () => {
    const { base } = deps();
    const { lines, io } = output();
    const code = await runMirrai(
      [
        "export", "--persona", "3", "--user", "1",
        "--out", path.join(dir, "arg-equals.mirrai-persona"),
        "--passphrase=secret",
      ],
      base,
      io,
    );
    expect(code).not.toBe(0);
    expect(base.exportPersonaBundle).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("--passphrase-file");
  });

  it("export: reads the equals form of --passphrase-file", async () => {
    const passphraseFile = path.join(dir, "passphrase-equals.txt");
    writeFileSync(passphraseFile, "a long passphrase\n");
    const { base } = deps();
    const { io } = output();
    const code = await runMirrai(
      [
        "export", "--persona", "3", "--user", "1",
        "--out", path.join(dir, "equals.mirrai-persona"),
        `--passphrase-file=${passphraseFile}`,
      ],
      base,
      io,
    );
    expect(code).toBe(0);
    expect(base.exportPersonaBundle).toHaveBeenCalledWith(expect.objectContaining({
      passphrase: "a long passphrase",
    }));
  });

  it("distill: --json is exactly one JSON line", async () => {
    const { base } = deps();
    const { outLines, io } = output();
    const code = await runMirrai(
      ["distill", "--persona", "3", "--user", "1", "--yes", "--json"],
      base,
      io,
    );
    expect(code).toBe(0);
    expect(outLines).toHaveLength(1);
    const parsed = JSON.parse(outLines[0]!);
    expect(parsed.estimate).toEqual({ chars: 1200, calls: 3 });
    expect(parsed.status).toBe("ready");
  });

  it("forwards eval and backup to their own scripts", async () => {
    const { base } = deps();
    const { io } = output();
    await runMirrai(["eval", "--persona", "3", "--user", "1"], base, io);
    expect(base.forward).toHaveBeenCalledWith("eval-run", ["--persona", "3", "--user", "1"]);
    await runMirrai(["backup", "create", "--out", "/tmp/x"], base, io);
    expect(base.forward).toHaveBeenCalledWith("backup", ["create", "--out", "/tmp/x"]);
  });
});
