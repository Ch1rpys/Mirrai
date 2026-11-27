import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import {
  BACKUP_MAGIC,
  BackupPassphraseError,
  BackupFormatError,
  decodeByteaValue,
  deriveBackupKey,
  encodeBytea,
  extractBackupToStaging,
  openBackupChunks,
  safeEntryPath,
  serializeBackupRow,
  verifyStagingPart,
  writeBackupArchive,
} from "./backup-format";

const MANIFEST = {
  format: 1,
  appVersion: "1.3.0",
  latestMigration: "0079_scene_record_range",
  createdAt: "2026-11-21T00:00:00.000Z",
  scope: "instance" as const,
  exclusions: [],
};

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mirrai-backup-format-"));
}

/**
 * Bytes that do not compress.
 *
 * The reader hands the archive out in 64 KiB chunks; a part this size
 * makes the archive span more than one chunk, which is the case that used
 * to deadlock.
 */
function incompressible(bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let state = 0x9e3779b9;
  for (let index = 0; index < bytes; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[index] = state & 0xff;
  }
  return out;
}

/** Writes one backup with one table part and one upload file. */
async function writeOne(directory: string, passphrase: string | null) {
  const upload = path.join(directory, "upload.bin");
  await fs.writeFile(upload, Buffer.from("UPLOAD-BYTES"));
  const rows = `${serializeBackupRow({ id: 1, name: "小满" })}\n${serializeBackupRow({ id: 2, name: "阿树" })}\n`;
  const out = path.join(directory, passphrase ? "a.mirrai-backup" : "a.zip");
  const written = await writeBackupArchive({
    outPath: out,
    passphrase,
    manifest: MANIFEST,
    entries: [
      {
        name: "db/personas.ndjson",
        compress: true,
        rows: () => 2,
        chunks: async function* () {
          yield Buffer.from(rows);
        },
      },
      {
        name: "uploads/personas/1/1/a.bin",
        compress: false,
        chunks: async function* () {
          for await (const chunk of (await import("node:fs")).createReadStream(upload)) {
            yield chunk as Uint8Array;
          }
        },
      },
    ],
  });
  return { out, rows, written };
}

describe("the backup archive", () => {
  it("round-trips an unencrypted archive with its manifest and hashes", async () => {
    const directory = await tempDir();
    try {
      const { out, rows, written } = await writeOne(directory, null);
      expect(written.manifest.encrypted).toBe(false);
      expect(written.manifest.tables).toHaveLength(1);
      expect(written.manifest.tables[0].rows).toBe(2);
      expect(written.manifest.uploads).toHaveLength(1);
      const manifest = await extractBackupToStaging({
        filePath: out,
        passphrase: null,
        stagingDir: path.join(directory, "staging"),
      });
      expect(manifest.appVersion).toBe("1.3.0");
      await expect(
        verifyStagingPart(path.join(directory, "staging"), manifest.tables[0]),
      ).resolves.toBe(true);
      const table = await fs.readFile(
        path.join(directory, "staging", "db", "personas.ndjson"),
        "utf-8",
      );
      expect(table).toBe(rows);
      const upload = await fs.readFile(
        path.join(directory, "staging", "uploads", "personas", "1", "1", "a.bin"),
        "utf-8",
      );
      expect(upload).toBe("UPLOAD-BYTES");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("round-trips an encrypted archive, and the bytes are not a zip", async () => {
    const directory = await tempDir();
    try {
      const { out, written } = await writeOne(directory, "correct horse battery");
      const head = Buffer.alloc(BACKUP_MAGIC.length);
      const handle = await fs.open(out, "r");
      await handle.read(head, 0, head.length, 0);
      await handle.close();
      expect(head.equals(BACKUP_MAGIC)).toBe(true);
      const firstBytes = (await fs.readFile(out)).subarray(0, 2).toString("utf-8");
      expect(firstBytes).not.toBe("PK");
      expect(written.manifest.encrypted).toBe(true);
      const manifest = await extractBackupToStaging({
        filePath: out,
        passphrase: "correct horse battery",
        stagingDir: path.join(directory, "staging"),
      });
      expect(manifest.tables[0].rows).toBe(2);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("round-trips an archive whose file is bigger than one read chunk", async () => {
    // A real instance's backup is far bigger than the 64 KiB chunk the
    // reader hands out. The reader used to wait for a part to finish
    // before pulling the next chunk, so restoring such a backup hung for
    // ever (found while accepting C9.5; the same loop served C8.3).
    const directory = await tempDir();
    try {
      const big = incompressible(120_000);
      for (const passphrase of [null, "a large backup passphrase"]) {
        const label = passphrase ? "big-enc" : "big";
        const out = path.join(directory, `${label}${passphrase ? ".mirrai-backup" : ".zip"}`);
        const written = await writeBackupArchive({
          outPath: out,
          passphrase,
          manifest: MANIFEST,
          entries: [{
            name: "uploads/big.bin",
            compress: false,
            chunks: async function* () {
              yield big;
            },
          }],
        });
        expect(written.bytes).toBeGreaterThan(64 * 1024);
        const staging = path.join(directory, `${label}-staging`);
        const manifest = await extractBackupToStaging({
          filePath: out,
          passphrase,
          stagingDir: staging,
        });
        expect(manifest.uploads.map((part) => part.file)).toContain("uploads/big.bin");
        await expect(fs.readFile(path.join(staging, "uploads", "big.bin"))).resolves.toEqual(big);
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses a truncated archive instead of waiting for the rest of it", async () => {
    // The same truncation case as the persona bundle's test: a download
    // that stopped in the middle must fail, not hang, for a whole-instance
    // backup too.
    const directory = await tempDir();
    try {
      const big = incompressible(120_000);
      for (const passphrase of [null, "a truncated backup passphrase"]) {
        const label = passphrase ? "cut-enc" : "cut";
        const out = path.join(directory, `${label}${passphrase ? ".mirrai-backup" : ".zip"}`);
        await writeBackupArchive({
          outPath: out,
          passphrase,
          manifest: MANIFEST,
          entries: [{
            name: "uploads/big.bin",
            compress: false,
            chunks: async function* () {
              yield big;
            },
          }],
        });
        const complete = await fs.readFile(out);
        const cutPath = path.join(directory, `${label}-cut`);
        await fs.writeFile(cutPath, complete.subarray(0, Math.floor(complete.length * 0.8)));
        await expect(
          extractBackupToStaging({
            filePath: cutPath,
            passphrase,
            stagingDir: path.join(directory, `${label}-staging`),
          }),
        ).rejects.toBeInstanceOf(Error);
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("refuses a wrong passphrase and a changed byte with the same error kind", async () => {
    const directory = await tempDir();
    try {
      const { out } = await writeOne(directory, "correct horse battery");
      await expect(
        extractBackupToStaging({
          filePath: out,
          passphrase: "wrong passphrase",
          stagingDir: path.join(directory, "wrong"),
        }),
      ).rejects.toBeInstanceOf(BackupPassphraseError);

      const bytes = await fs.readFile(out);
      const changed = Buffer.from(bytes);
      changed[changed.length - 20] ^= 0xff;
      const tampered = path.join(directory, "tampered.mirrai-backup");
      await fs.writeFile(tampered, changed);
      await expect(
        extractBackupToStaging({
          filePath: tampered,
          passphrase: "correct horse battery",
          stagingDir: path.join(directory, "tampered"),
        }),
      ).rejects.toBeInstanceOf(BackupPassphraseError);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("needs a passphrase to read an encrypted archive", async () => {
    const directory = await tempDir();
    try {
      const { out } = await writeOne(directory, "correct horse battery");
      await expect(
        extractBackupToStaging({
          filePath: out,
          passphrase: null,
          stagingDir: path.join(directory, "none"),
        }),
      ).rejects.toMatchObject({ kind: "passphrase_required" });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses an archive with no manifest and an unsafe entry path", async () => {
    const directory = await tempDir();
    try {
      const noManifest = path.join(directory, "no-manifest.zip");
      await fs.writeFile(noManifest, zipSync({ "db/users.ndjson": new Uint8Array([1]) }));
      await expect(
        extractBackupToStaging({
          filePath: noManifest,
          passphrase: null,
          stagingDir: path.join(directory, "a"),
        }),
      ).rejects.toBeInstanceOf(BackupFormatError);

      const unsafe = path.join(directory, "unsafe.zip");
      await fs.writeFile(
        unsafe,
        zipSync({ "../escaped.txt": new Uint8Array([1]), "manifest.json": new Uint8Array([123]) }),
      );
      await expect(
        extractBackupToStaging({
          filePath: unsafe,
          passphrase: null,
          stagingDir: path.join(directory, "b"),
        }),
      ).rejects.toBeInstanceOf(BackupFormatError);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a manifest of a newer layout", async () => {
    const directory = await tempDir();
    try {
      const out = path.join(directory, "newer.zip");
      await fs.writeFile(
        out,
        zipSync({
          "manifest.json": Buffer.from(
            JSON.stringify({ ...MANIFEST, format: 99, tables: [], uploads: [], encrypted: false }),
          ),
        }),
      );
      await expect(
        extractBackupToStaging({
          filePath: out,
          passphrase: null,
          stagingDir: path.join(directory, "staging"),
        }),
      ).rejects.toThrow(/newer version/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("streaming the plaintext", () => {
  it("yields the archive back for an unencrypted file", async () => {
    const directory = await tempDir();
    try {
      const { out } = await writeOne(directory, null);
      const collected: Buffer[] = [];
      for await (const chunk of openBackupChunks(out, null)) collected.push(Buffer.from(chunk));
      const bytes = Buffer.concat(collected);
      expect(bytes.subarray(0, 2).toString("utf-8")).toBe("PK");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe("rows and paths", () => {
  it("keeps bytes through JSON with a marker", () => {
    const row = serializeBackupRow({ id: 1, vec: Buffer.from([1, 2, 255]) });
    const parsed = JSON.parse(row) as Record<string, unknown>;
    expect(parsed.vec).toEqual({ __mirraiBytea: "0102ff" });
    expect(decodeByteaValue(parsed.vec)).toBe("\\x0102ff");
    expect(decodeByteaValue({ plain: 1 })).toEqual({ plain: 1 });
  });

  it("derives a different key for a different salt", async () => {
    const a = await deriveBackupKey("passphrase", Buffer.alloc(16, 1));
    const b = await deriveBackupKey("passphrase", Buffer.alloc(16, 2));
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
  }, 20_000);

  it("keeps entry paths inside the staging directory", () => {
    const root = path.join(os.tmpdir(), "staging-root");
    expect(safeEntryPath(root, "db/users.ndjson")).toBe(path.join(root, "db", "users.ndjson"));
    expect(safeEntryPath(root, "../etc/passwd")).toBeNull();
    expect(safeEntryPath(root, "/etc/passwd")).toBeNull();
    expect(safeEntryPath(root, "a/../../b")).toBeNull();
  });
});

describe("the manifest parts", () => {
  it("records the row count of a table part", async () => {
    const directory = await tempDir();
    try {
      const { written } = await writeOne(directory, null);
      expect(written.manifest.tables[0].rows).toBe(2);
      expect(written.manifest.tables[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(written.manifest.uploads[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(written.manifest.uploads[0].bytes).toBe("UPLOAD-BYTES".length);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("reports the hash of the file as written", async () => {
    const directory = await tempDir();
    try {
      const { out, written } = await writeOne(directory, null);
      const { createHash } = await import("node:crypto");
      const actual = createHash("sha256").update(await fs.readFile(out)).digest("hex");
      expect(written.sha256).toBe(actual);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
