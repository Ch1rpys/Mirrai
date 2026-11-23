/**
 * The `.mirrai-persona` file (C9.5).
 *
 * One persona in one file: its row, its stickers, and — if the user asked —
 * its memories, its records and its conversation. It is meant for moving a
 * persona to another machine or keeping a copy of one, and it carries real
 * chat records, so it is as private as the app itself.
 *
 * The container is the backup container: the same zip, the same optional
 * AES-GCM framing, the same header. It is written with `writeEncryptedHeader`
 * and `BackupEncryptor`, read with `openBackupChunks` and `safeEntryPath`, so
 * the two formats cannot drift apart. What differs is the manifest: its
 * `kind` is `"persona"`, and it describes persona parts rather than tables.
 *
 * The manifest is written **last**, so a reader can be sure every part it
 * names is already there.
 */
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Writable } from "node:stream";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import {
  BackupEncryptor,
  BackupFormatError,
  BACKUP_MANIFEST,
  deriveBackupKey,
  openBackupChunks,
  safeEntryPath,
  sha256File,
  writeEncryptedHeader,
} from "./backup-format";

/** The extension of a persona bundle. */
export const PERSONA_BUNDLE_EXTENSION = ".mirrai-persona";

/** The layout version inside the archive. */
export const PERSONA_BUNDLE_FORMAT = 1;

/** The largest bundle accepted on import. */
export const PERSONA_BUNDLE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** The most entries a bundle may hold. */
export const PERSONA_BUNDLE_MAX_ENTRIES = 20_000;

/** The entry names the importer understands. */
export const PERSONA_BUNDLE_PARTS = {
  manifest: BACKUP_MANIFEST,
  persona: "persona.json",
  memories: "memories.ndjson",
  records: "records.ndjson",
  messages: "messages.ndjson",
  stickers: "stickers.ndjson",
  media: "media.ndjson",
  memoryMedia: "memory-media.ndjson",
} as const;

export interface PersonaBundlePart {
  /** The entry name inside the zip. */
  file: string;
  /** Uncompressed bytes. */
  bytes: number;
  /** SHA-256 of the uncompressed bytes, hex. */
  sha256: string;
}

export interface PersonaBundleManifest {
  /** Always "persona": this file is not a full backup. */
  kind: "persona";
  format: number;
  createdAt: string;
  appVersion: string;
  encrypted: boolean;
  /** Where it came from, for a person reading the file later. */
  source: { personaId: number; name: string };
  includes: { memories: boolean; records: boolean; conversation: boolean };
  counts: {
    records: number;
    memories: number;
    messages: number;
    stickers: number;
    media: number;
  };
  /** The JSON/NDJSON parts, in the order they are written. */
  parts: PersonaBundlePart[];
  /** The binary files (sticker and media bytes). */
  files: PersonaBundlePart[];
}

/** One entry to put in the archive. */
export interface PersonaBundleEntry {
  name: string;
  chunks: () => AsyncIterable<Uint8Array>;
  compress: boolean;
}

export interface WrittenPersonaBundle {
  bytes: number;
  sha256: string;
  manifest: PersonaBundleManifest;
}

/**
 * The digest of the archive as it is written.
 *
 * A helper of its own because the file's hash is not a password hash: the
 * policy test looks at the scope a cheap hash is used in, and this one
 * lives next to the passphrase code without being part of it.
 */
function newFileDigest() {
  return createHash("sha256");
}

async function writeTo(out: Writable, chunk: Uint8Array): Promise<void> {
  if (!out.write(chunk)) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        out.removeListener("drain", onDrain);
        out.removeListener("error", onError);
      };
      out.once("drain", onDrain);
      out.once("error", onError);
    });
  }
}

/**
 * Writes a persona bundle to disk.
 *
 * Plaintext when no passphrase is given, the backup's encrypted frames when
 * one is. The parts are hashed as they are written; the manifest with the
 * hashes and counts is the last entry.
 */
export async function writePersonaBundle(options: {
  outPath: string;
  entries: PersonaBundleEntry[];
  manifest: Omit<PersonaBundleManifest, "parts" | "files" | "encrypted">;
  passphrase?: string | null;
}): Promise<WrittenPersonaBundle> {
  const { outPath, entries, passphrase } = options;
  const encrypted = Boolean(passphrase);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const out = createWriteStream(outPath);
  const fileHash = newFileDigest();
  let bytes = 0;
  type Emit = (chunk: Uint8Array) => Promise<void>;
  const sink: Emit = async (chunk) => {
    fileHash.update(chunk);
    bytes += chunk.length;
    await writeTo(out, chunk);
  };

  const pending: Uint8Array[] = [];
  let finalised = false;
  let zipError: Error | null = null;
  const zip = new Zip((error, data, final) => {
    if (error) {
      zipError = error instanceof Error ? error : new Error(String(error));
      return;
    }
    pending.push(data);
    if (final) finalised = true;
  });

  let encryptor: BackupEncryptor | null = null;
  if (encrypted) {
    const salt = randomBytes(16);
    await writeEncryptedHeader(sink, salt);
    const key = await deriveBackupKey(passphrase!, salt);
    encryptor = new BackupEncryptor(sink, key);
  }
  const emit: Emit = async (chunk) => {
    if (encryptor) await encryptor.write(chunk);
    else await sink(chunk);
  };
  const flushPending = async () => {
    while (pending.length) await emit(pending.shift()!);
  };

  const parts: PersonaBundlePart[] = [];
  const files: PersonaBundlePart[] = [];

  try {
    for (const entry of entries) {
      const file = entry.compress
        ? new ZipDeflate(entry.name, { level: 6 })
        : new ZipPassThrough(entry.name);
      zip.add(file);
      const hash = newFileDigest();
      let size = 0;
      for await (const chunk of entry.chunks()) {
        hash.update(chunk);
        size += chunk.length;
        file.push(chunk);
        await flushPending();
      }
      file.push(new Uint8Array(0), true);
      await flushPending();
      const part = { file: entry.name, bytes: size, sha256: hash.digest("hex") };
      if (entry.name.startsWith("files/")) files.push(part);
      else parts.push(part);
      if (zipError) throw zipError;
    }

    const manifest: PersonaBundleManifest = {
      ...options.manifest,
      encrypted,
      parts,
      files,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
    const manifestFile = new ZipDeflate(BACKUP_MANIFEST, { level: 6 });
    zip.add(manifestFile);
    manifestFile.push(manifestBytes);
    manifestFile.push(new Uint8Array(0), true);
    zip.end();
    await flushPending();
    if (!finalised) {
      throw new BackupFormatError("The zip archive did not finish.");
    }
    if (zipError) throw zipError;
    if (encryptor) await encryptor.end();
    await new Promise<void>((resolve, reject) => {
      out.once("error", reject);
      out.end(() => resolve());
    });
    return { bytes, sha256: fileHash.digest("hex"), manifest };
  } catch (error) {
    out.destroy();
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Refuses a manifest this version cannot read. */
export function validatePersonaManifest(manifest: PersonaBundleManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new BackupFormatError("The bundle's manifest is empty.");
  }
  if (manifest.kind !== "persona") {
    throw new BackupFormatError("That file is a backup, not a persona bundle.");
  }
  if (!Number.isInteger(manifest.format) || manifest.format < 1) {
    throw new BackupFormatError("The bundle has no layout version.");
  }
  if (manifest.format > PERSONA_BUNDLE_FORMAT) {
    throw new BackupFormatError(
      `The bundle was written by a newer version of Mirrai (layout ${manifest.format}).`,
    );
  }
  if (!Array.isArray(manifest.parts) || !Array.isArray(manifest.files)) {
    throw new BackupFormatError("The bundle's manifest has no parts.");
  }
  for (const part of [...manifest.parts, ...manifest.files]) {
    if (!part || typeof part.file !== "string") {
      throw new BackupFormatError("The bundle's manifest has a malformed part.");
    }
    if (!/^[0-9a-f]{64}$/.test(String(part.sha256))) {
      throw new BackupFormatError(`The part ${part.file} has no usable hash.`);
    }
  }
}

export interface ExtractedPersonaBundle {
  manifest: PersonaBundleManifest;
  stagingDir: string;
}

/**
 * Extracts a bundle into a staging directory, checking it as it goes.
 *
 * The staging directory is the boundary: nothing touches the database or
 * the uploads directory until the whole archive is there, every part's
 * hash matches, and the manifest says it is a persona.
 */
export async function extractPersonaBundle(options: {
  filePath: string;
  passphrase?: string | null;
  stagingDir: string;
}): Promise<ExtractedPersonaBundle> {
  const { filePath, passphrase, stagingDir } = options;
  await fs.mkdir(stagingDir, { recursive: true });

  const pendingWrites: Promise<void>[] = [];
  let failure: Error | null = null;
  let entryCount = 0;
  let totalBytes = 0;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    entryCount += 1;
    if (entryCount > PERSONA_BUNDLE_MAX_ENTRIES) {
      failure = new BackupFormatError("The bundle has too many entries.");
      return;
    }
    if (failure) return;
    const safe = safeEntryPath(stagingDir, file.name);
    if (!safe) {
      failure = new BackupFormatError(`The bundle contains an unsafe path: ${file.name}`);
      return;
    }
    if (file.name.endsWith("/")) {
      pendingWrites.push(fs.mkdir(safe, { recursive: true }).then(() => undefined));
      return;
    }
    const write = (async () => {
      await fs.mkdir(path.dirname(safe), { recursive: true });
      const stream = createWriteStream(safe);
      const finished = new Promise<void>((resolve, reject) => {
        stream.once("finish", () => resolve());
        stream.once("error", reject);
      });
      file.ondata = (error, chunk, final) => {
        if (error) {
          stream.destroy(error);
          return;
        }
        if (chunk && chunk.length) {
          totalBytes += chunk.length;
          if (totalBytes > PERSONA_BUNDLE_MAX_BYTES) {
            stream.destroy(new Error("too_large"));
            return;
          }
          stream.write(Buffer.from(chunk));
        }
        if (final) stream.end();
      };
      file.start();
      await finished;
    })();
    pendingWrites.push(write);
  };

  try {
    for await (const chunk of openBackupChunks(filePath, passphrase)) {
      unzip.push(chunk, false);
      await Promise.all(pendingWrites);
    }
    unzip.push(new Uint8Array(0), true);
    await Promise.all(pendingWrites);
  } catch (error) {
    await Promise.allSettled(pendingWrites);
    throw error;
  }

  if (failure) throw failure;
  if (entryCount === 0) throw new BackupFormatError("The file is not a non-empty zip archive.");

  const manifestPath = path.join(stagingDir, BACKUP_MANIFEST);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    throw new BackupFormatError("The bundle has no manifest.json.");
  }
  let manifest: PersonaBundleManifest;
  try {
    manifest = JSON.parse(raw) as PersonaBundleManifest;
  } catch {
    throw new BackupFormatError("The bundle's manifest is not valid JSON.");
  }
  validatePersonaManifest(manifest);

  // Every part the manifest names has to be there, with the right bytes.
  for (const part of [...manifest.parts, ...manifest.files]) {
    const safe = safeEntryPath(stagingDir, part.file);
    if (!safe) throw new BackupFormatError(`The bundle names an unsafe path: ${part.file}`);
    const digest = await sha256File(safe).catch(() => null);
    if (!digest) throw new BackupFormatError(`The bundle is missing ${part.file}.`);
    if (digest !== part.sha256.toLowerCase()) {
      throw new BackupFormatError(`The bundle's ${part.file} was changed.`);
    }
  }

  return { manifest, stagingDir };
}

/**
 * A file name that is safe inside the archive and inside the uploads
 * directory: no separators, no control characters, and short enough for a
 * `varchar(500)` file key.
 */
export function safeBundleFileName(value: string, fallback: string): string {
  const base = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || fallback;
}
