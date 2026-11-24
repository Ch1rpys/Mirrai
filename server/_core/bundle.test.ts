/**
 * The `.mirrai-persona` container (C9.5).
 *
 * The zip and the encryption are the backup's; what is new is the manifest
 * that says `kind: "persona"` and the path checks. These tests are about
 * the container: a round trip with and without a passphrase, a wrong
 * passphrase, a changed part, an unsafe entry, and a full backup being
 * refused as the wrong kind of file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractPersonaBundle,
  PERSONA_BUNDLE_FORMAT,
  PERSONA_BUNDLE_PARTS,
  safeBundleFileName,
  writePersonaBundle,
} from "./bundle";
import { BackupFormatError, BackupPassphraseError } from "./backup-format";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-bundle-test-"));
});

/**
 * Bytes that do not compress.
 *
 * The reader hands the archive out in 64 KiB chunks (`createReadStream`'s
 * default high-water mark); a part of this size makes the archive span
 * more than one chunk, which is the case that used to deadlock.
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

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manifest(extra: Record<string, unknown> = {}) {
  return {
    kind: "persona" as const,
    format: PERSONA_BUNDLE_FORMAT,
    createdAt: new Date("2026-03-01T00:00:00Z").toISOString(),
    appVersion: "test",
    source: { personaId: 1, name: "小满" },
    includes: { memories: true, records: true, conversation: false },
    counts: { records: 1, memories: 1, messages: 0, stickers: 0, media: 0 },
    ...extra,
  };
}

function entries() {
  return [
    {
      name: PERSONA_BUNDLE_PARTS.persona,
      compress: true,
      chunks: async function* () {
        yield strToU8(JSON.stringify({ name: "小满" }));
      },
    },
    {
      name: PERSONA_BUNDLE_PARTS.records,
      compress: true,
      chunks: async function* () {
        yield strToU8(`${JSON.stringify({ index: 0, oldId: 1, content: "在吗" })}\n`);
      },
    },
    {
      name: "files/stickers/0-dog.png",
      compress: false,
      chunks: async function* () {
        yield new Uint8Array([1, 2, 3, 4]);
      },
    },
  ];
}

async function write(passphrase?: string | null): Promise<string> {
  const outPath = path.join(dir, `bundle${passphrase ? "-enc" : ""}`);
  await writePersonaBundle({
    outPath,
    entries: entries(),
    manifest: manifest(),
    passphrase: passphrase ?? null,
  });
  return outPath;
}

describe("writing and reading a bundle", () => {
  it("round-trips a plain bundle and records the parts", async () => {
    const outPath = await write(null);
    const staging = path.join(dir, "staging");
    const { manifest: read } = await extractPersonaBundle({ filePath: outPath, stagingDir: staging });
    expect(read.kind).toBe("persona");
    expect(read.encrypted).toBe(false);
    expect(read.parts.map((part) => part.file)).toEqual([
      PERSONA_BUNDLE_PARTS.persona,
      PERSONA_BUNDLE_PARTS.records,
    ]);
    expect(read.files.map((part) => part.file)).toEqual(["files/stickers/0-dog.png"]);
    expect(readFileSync(path.join(staging, PERSONA_BUNDLE_PARTS.records), "utf-8")).toContain("在吗");
    expect(readFileSync(path.join(staging, "files/stickers/0-dog.png"))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("round-trips an encrypted bundle, and needs its passphrase", async () => {
    const outPath = await write("correct horse battery");
    const staging = path.join(dir, "staging-enc");
    const { manifest: read } = await extractPersonaBundle({
      filePath: outPath,
      passphrase: "correct horse battery",
      stagingDir: staging,
    });
    expect(read.encrypted).toBe(true);
    expect(readFileSync(path.join(staging, PERSONA_BUNDLE_PARTS.persona), "utf-8")).toContain("小满");

    await expect(
      extractPersonaBundle({ filePath: outPath, stagingDir: path.join(dir, "no-pass") }),
    ).rejects.toBeInstanceOf(BackupPassphraseError);
    await expect(
      extractPersonaBundle({
        filePath: outPath,
        passphrase: "wrong passphrase",
        stagingDir: path.join(dir, "wrong-pass"),
      }),
    ).rejects.toBeInstanceOf(BackupPassphraseError);
  });

  it("round-trips a bundle whose archive is bigger than one read chunk", async () => {
    // A real persona's records and media make the archive tens or hundreds
    // of kilobytes. The reader used to wait for a part to finish before
    // pulling the next chunk, which never happened for an archive bigger
    // than the 64 KiB chunk — the import hung for ever (C9.5).
    const big = incompressible(120_000);
    for (const passphrase of [null, "a large bundle passphrase"]) {
      const label = passphrase ? "large-enc" : "large";
      const outPath = path.join(dir, label);
      const written = await writePersonaBundle({
        outPath,
        manifest: manifest(),
        entries: [
          ...entries(),
          {
            name: "files/media/0-big.bin",
            compress: false,
            chunks: async function* () {
              yield big;
            },
          },
        ],
        passphrase,
      });
      expect(written.bytes).toBeGreaterThan(64 * 1024);
      const staging = path.join(dir, `${label}-staging`);
      const { manifest: read } = await extractPersonaBundle({
        filePath: outPath,
        passphrase,
        stagingDir: staging,
      });
      expect(read.files.map((part) => part.file)).toContain("files/media/0-big.bin");
      expect(readFileSync(path.join(staging, "files/media/0-big.bin"))).toEqual(big);
    }
  });

  it("refuses a full backup as the wrong kind of file", async () => {
    const outPath = path.join(dir, "backup");
    // The backup's manifest has no kind at all.
    await writePersonaBundle({
      outPath,
      entries: [{
        name: PERSONA_BUNDLE_PARTS.persona,
        compress: true,
        chunks: async function* () {
          yield strToU8("{}");
        },
      }],
      manifest: manifest({ kind: undefined }),
    });
    await expect(
      extractPersonaBundle({ filePath: outPath, stagingDir: path.join(dir, "wrong-kind") }),
    ).rejects.toBeInstanceOf(BackupFormatError);
  });

  it("refuses a bundle whose part was changed", async () => {
    const outPath = path.join(dir, "tampered-shape");
    // A manifest that names the right file with the wrong hash.
    const payload = strToU8("{}");
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest({
        parts: [{ file: PERSONA_BUNDLE_PARTS.persona, bytes: 2, sha256: "0".repeat(64) }],
        files: [],
      }))),
      [PERSONA_BUNDLE_PARTS.persona]: payload,
    });
    writeFileSync(outPath, archive);
    await expect(
      extractPersonaBundle({ filePath: outPath, stagingDir: path.join(dir, "tampered") }),
    ).rejects.toThrow(/was changed/);
  });

  it("refuses an entry that would land outside the staging directory", async () => {
    const outPath = path.join(dir, "unsafe");
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest({ parts: [], files: [] }))),
      "../evil.txt": strToU8("no"),
    });
    writeFileSync(outPath, archive);
    await expect(
      extractPersonaBundle({ filePath: outPath, stagingDir: path.join(dir, "evil") }),
    ).rejects.toThrow(/unsafe path/);
  });

  it("refuses a bundle with no manifest", async () => {
    const outPath = path.join(dir, "no-manifest");
    writeFileSync(outPath, zipSync({ "persona.json": strToU8("{}") }));
    await expect(
      extractPersonaBundle({ filePath: outPath, stagingDir: path.join(dir, "empty") }),
    ).rejects.toThrow(/no manifest/);
  });

  it("keeps a file name safe for the archive and the uploads directory", () => {
    expect(safeBundleFileName("../../etc/passwd", "x")).toBe("passwd");
    expect(safeBundleFileName("说 话.png", "x")).toBe("___.png");
    expect(safeBundleFileName("", "x")).toBe("x");
    expect(safeBundleFileName(".hidden", "x")).toBe("hidden");
    expect(safeBundleFileName("a".repeat(300), "x")).toHaveLength(120);
  });
});
