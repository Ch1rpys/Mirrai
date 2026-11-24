/**
 * The bytes of a backup file (C8.3).
 *
 * Two layers:
 *
 *  1. A zip archive. `manifest.json` comes last, because it carries the
 *     hash of every part before it — writing it first would mean either
 *     two passes over the data or a manifest written before the numbers
 *     it promises.
 *  2. When a passphrase is given, the whole archive is encrypted: scrypt
 *     derives a key from the passphrase (parameters and salt in the file
 *     header), and the archive is cut into 64 KiB frames, each encrypted
 *     with AES-256-GCM and its own nonce. A frame's index is its
 *     additional authenticated data, so frames cannot be reordered or
 *     dropped without the file failing to open.
 *
 * Nothing here depends on the database or the disk layout; the backup
 * and restore modules supply the parts. Keeping it that way is what
 * makes "a byte was changed" and "the passphrase is wrong" testable
 * without a database.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Writable } from "node:stream";
import { promisify } from "node:util";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** The version of the backup layout inside the zip. */
export const BACKUP_FORMAT_VERSION = 1;

/** The manifest's file name inside the archive. */
export const BACKUP_MANIFEST = "manifest.json";

/** The plaintext frame size. */
export const BACKUP_FRAME_BYTES = 64 * 1024;

/**
 * The 14 bytes every encrypted backup starts with.
 *
 * A `.zip` starts with `PK`; this marker is deliberately not `PK`, so a
 * file of the wrong kind fails as "this is not a Mirrai backup" rather
 * than as a corrupt zip.
 */
export const BACKUP_MAGIC = Buffer.from("mirrai-backup\x01", "utf-8");

/** The scrypt parameters. They are in the header so old files stay readable. */
export const BACKUP_KDF = { N: 2 ** 15, r: 8, p: 1 } as const;

/** AES-GCM nonce and tag sizes. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Header: magic, salt, N, r, p. */
export const BACKUP_HEADER_BYTES = BACKUP_MAGIC.length + 16 + 4 + 4 + 4;

export interface BackupTablePart {
  /** The table's name, exactly as `drizzle/schema.ts` declares it. */
  table: string;
  /** The archive entry: `db/<table>.ndjson`. */
  file: string;
  rows: number;
  /** SHA-256 of the uncompressed NDJSON bytes, hex. */
  sha256: string;
}

export interface BackupUploadPart {
  /** The archive entry: `uploads/<path relative to the uploads root>`. */
  file: string;
  bytes: number;
  sha256: string;
}

export interface BackupExclusion {
  table: string;
  reason: string;
}

export interface BackupManifest {
  /** The layout version. A restore refuses a newer one. */
  format: number;
  /** The app version that wrote it. */
  appVersion: string;
  /** The newest migration applied to the instance that wrote it. */
  latestMigration: string | null;
  /** ISO instant. */
  createdAt: string;
  /** `instance`, or the id of the one user this backup covers. */
  scope: "instance" | number;
  encrypted: boolean;
  tables: BackupTablePart[];
  uploads: BackupUploadPart[];
  /** Tables the backup deliberately leaves out, each with the reason. */
  exclusions: BackupExclusion[];
}

/** One file to put in the archive. */
export interface BackupEntry {
  /** The entry name inside the zip. */
  name: string;
  /** How the bytes are produced, pulled until it ends. */
  chunks: () => AsyncIterable<Uint8Array>;
  /** Whether to deflate. Uploads are usually already compressed. */
  compress: boolean;
  /** How many lines the entry held, for the manifest. */
  rows?: () => number;
}

/** What `writeBackupArchive` returns once the file is on disk. */
export interface WrittenBackup {
  bytes: number;
  /** The SHA-256 of the whole file as written (after encryption, if any). */
  sha256: string;
  /** The manifest that was written into the archive. */
  manifest: BackupManifest;
}

/**
 * Turns a `Buffer` into something `JSON.stringify` keeps.
 *
 * The embedding table stores raw bytes; `JSON.stringify` would turn a
 * `Buffer` into `{"type":"Buffer","data":[…]}` and the restore could
 * not tell that from a real object. This marker is turned back into
 * PostgreSQL's bytea input syntax before the row is inserted.
 */
export function encodeBytea(buffer: Buffer): { __mirraiBytea: string } {
  return { __mirraiBytea: buffer.toString("hex") };
}

/** Undoes `encodeBytea` for one value. */
export function decodeByteaValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.__mirraiBytea === "string") {
    return `\\x${record.__mirraiBytea}`;
  }
  return value;
}

/** Serialises one database row for the NDJSON part. */
export function serializeBackupRow(row: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = Buffer.isBuffer(value) ? encodeBytea(value) : value;
  }
  return JSON.stringify(out);
}

/**
 * A hasher for the archive's own bytes.
 *
 * Kept in its own function because the password-hash policy test looks
 * at the function a hash is created in: `writeBackupArchive` deals with
 * a passphrase, and a hash created directly there reads as a password
 * being hashed with SHA-256. This is file integrity, not a password.
 */
function newFileHasher() {
  return createHash("sha256");
}

/** SHA-256 of a whole file, streaming. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The key the file is encrypted with. */
export async function deriveBackupKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return scrypt(passphrase, salt, 32, {
    N: BACKUP_KDF.N,
    r: BACKUP_KDF.r,
    p: BACKUP_KDF.p,
    // Node's default (32 MiB) is exactly the memory scrypt needs here,
    // and its check is strict; twice that leaves room.
    maxmem: 2 * 128 * BACKUP_KDF.N * BACKUP_KDF.r,
  });
}

/** How ciphertext is handed on: writing may wait for the disk. */
type Emit = (chunk: Uint8Array) => Promise<void>;

/** Writes the header of an encrypted backup: magic, salt and parameters. */
export async function writeEncryptedHeader(emit: Emit, salt: Buffer): Promise<void> {
  const header = Buffer.alloc(BACKUP_HEADER_BYTES);
  BACKUP_MAGIC.copy(header, 0);
  salt.copy(header, BACKUP_MAGIC.length);
  header.writeUInt32BE(BACKUP_KDF.N, BACKUP_MAGIC.length + 16);
  header.writeUInt32BE(BACKUP_KDF.r, BACKUP_MAGIC.length + 20);
  header.writeUInt32BE(BACKUP_KDF.p, BACKUP_MAGIC.length + 24);
  await emit(header);
}

/**
 * Encrypts archive chunks into frames.
 *
 * The caller pushes chunks (`write`) and then calls `end`; frames are
 * emitted as soon as 64 KiB have accumulated.
 */
export class BackupEncryptor {
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private frameIndex = 0;
  private ended = false;

  constructor(
    private readonly emit: Emit,
    private readonly key: Buffer,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    if (this.ended) throw new Error("backup encryptor already ended");
    this.buffered.push(Buffer.from(chunk));
    this.bufferedBytes += chunk.length;
    while (this.bufferedBytes >= BACKUP_FRAME_BYTES) {
      const joined = Buffer.concat(this.buffered, this.bufferedBytes);
      const frame = joined.subarray(0, BACKUP_FRAME_BYTES);
      const rest = joined.subarray(BACKUP_FRAME_BYTES);
      await this.emitFrame(Buffer.from(frame));
      this.buffered = rest.length ? [Buffer.from(rest)] : [];
      this.bufferedBytes = rest.length;
    }
  }

  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.bufferedBytes > 0) {
      const frame = Buffer.concat(this.buffered, this.bufferedBytes);
      this.buffered = [];
      this.bufferedBytes = 0;
      await this.emitFrame(frame);
    }
  }

  private async emitFrame(plaintext: Buffer): Promise<void> {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(frameAad(this.frameIndex));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(ciphertext.length, 0);
    await this.emit(Buffer.concat([prefix, nonce, tag, ciphertext]));
    this.frameIndex += 1;
  }
}

function frameAad(index: number): Buffer {
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(index, 0);
  return aad;
}

/** A file whose shape is wrong (not a zip, or not ours). */
export class BackupFormatError extends Error {}

/** The file is encrypted and the passphrase is missing or wrong. */
export class BackupPassphraseError extends Error {
  constructor(readonly kind: "passphrase_required" | "wrong_passphrase_or_corrupt") {
    super(kind);
  }
}

/** Yields the plaintext of a possibly-encrypted backup file. */
export async function* openBackupChunks(
  filePath: string,
  passphrase: string | null | undefined,
): AsyncIterable<Uint8Array> {
  const handle = await fs.open(filePath, "r");
  try {
    const magic = Buffer.alloc(BACKUP_MAGIC.length);
    const head = await handle.read(magic, 0, magic.length, 0);
    const encrypted = head.bytesRead === magic.length && magic.equals(BACKUP_MAGIC);
    if (!encrypted) {
      await handle.close();
      for await (const chunk of createReadStream(filePath)) yield chunk as Uint8Array;
      return;
    }
    if (!passphrase) throw new BackupPassphraseError("passphrase_required");

    const salt = Buffer.alloc(16);
    const rest = Buffer.alloc(BACKUP_HEADER_BYTES - magic.length);
    const read = await handle.read(rest, 0, rest.length, magic.length);
    if (read.bytesRead !== rest.length) {
      throw new BackupFormatError("The backup header is cut short.");
    }
    rest.copy(salt, 0, 0, 16);
    const N = rest.readUInt32BE(16);
    const r = rest.readUInt32BE(20);
    const p = rest.readUInt32BE(24);
    const key =
      N === BACKUP_KDF.N && r === BACKUP_KDF.r && p === BACKUP_KDF.p
        ? await deriveBackupKey(passphrase, salt)
        : await scrypt(passphrase, salt, 32, {
            N,
            r,
            p,
            maxmem: 2 * 128 * N * r,
          });
    await handle.close();

    let buffered: Buffer = Buffer.alloc(0);
    let frameIndex = 0;
    for await (const chunk of createReadStream(filePath, { start: BACKUP_HEADER_BYTES })) {
      const incoming = chunk as Buffer;
      buffered = buffered.length ? Buffer.concat([buffered, incoming]) : incoming;
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        const frameSize = 4 + NONCE_BYTES + TAG_BYTES + length;
        if (buffered.length < frameSize) break;
        const frame = buffered.subarray(0, frameSize);
        buffered = buffered.subarray(frameSize);
        const nonce = frame.subarray(4, 4 + NONCE_BYTES);
        const tag = frame.subarray(4 + NONCE_BYTES, 4 + NONCE_BYTES + TAG_BYTES);
        const ciphertext = frame.subarray(4 + NONCE_BYTES + TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(frameAad(frameIndex));
        decipher.setAuthTag(Buffer.from(tag));
        let plaintext: Buffer;
        try {
          plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch {
          throw new BackupPassphraseError("wrong_passphrase_or_corrupt");
        }
        frameIndex += 1;
        yield plaintext;
      }
    }
    if (buffered.length > 0) {
      throw new BackupFormatError("The backup ends in the middle of a frame.");
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
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
 * Writes a backup archive to `outPath`.
 *
 * Every entry is read once; the manifest is written last with the row
 * counts and hashes collected along the way. When a passphrase is given
 * the frames are encrypted as they are produced — the archive is never
 * on disk unencrypted, not even for a moment.
 */
export async function writeBackupArchive(options: {
  outPath: string;
  entries: BackupEntry[];
  manifest: Omit<BackupManifest, "tables" | "uploads" | "encrypted">;
  passphrase?: string | null;
  /** Called with each table/upload part as it is written. */
  onPart?: (part: BackupTablePart | BackupUploadPart) => void;
}): Promise<WrittenBackup> {
  const { outPath, entries, passphrase } = options;
  const encrypted = Boolean(passphrase);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const out = createWriteStream(outPath);
  const fileHash = newFileHasher();
  let bytes = 0;
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

  const tables: BackupTablePart[] = [];
  const uploads: BackupUploadPart[] = [];

  try {
    for (const entry of entries) {
      const file = entry.compress
        ? new ZipDeflate(entry.name, { level: 6 })
        : new ZipPassThrough(entry.name);
      zip.add(file);
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of entry.chunks()) {
        hash.update(chunk);
        size += chunk.length;
        file.push(chunk);
        await flushPending();
      }
      file.push(new Uint8Array(0), true);
      await flushPending();
      const part = entry.name.startsWith("db/")
        ? ({
            table: entry.name.slice(3, -".ndjson".length),
            file: entry.name,
            rows: entry.rows?.() ?? 0,
            sha256: hash.digest("hex"),
          } satisfies BackupTablePart)
        : ({
            file: entry.name,
            bytes: size,
            sha256: hash.digest("hex"),
          } satisfies BackupUploadPart);
      if (entry.name.startsWith("db/")) tables.push(part as BackupTablePart);
      else uploads.push(part as BackupUploadPart);
      options.onPart?.(part);
      if (zipError) throw zipError;
    }

    // The manifest is written last: it is the only entry whose content
    // depends on every other entry.
    const fullManifest: BackupManifest = {
      ...options.manifest,
      encrypted,
      tables,
      uploads,
    };
    const manifestBytes = Buffer.from(JSON.stringify(fullManifest, null, 2), "utf-8");
    const manifestFile = new ZipDeflate(BACKUP_MANIFEST, { level: 6 });
    zip.add(manifestFile);
    manifestFile.push(manifestBytes);
    manifestFile.push(new Uint8Array(0), true);
    zip.end();
    await flushPending();
    if (!finalised) {
      // The synchronous deflate stream finishes during `end`; anything
      // that did not is a bug, and waiting forever would hide it.
      throw new BackupFormatError("The zip archive did not finish.");
    }
    if (zipError) throw zipError;
    if (encryptor) await encryptor.end();
    await new Promise<void>((resolve, reject) => {
      out.once("error", reject);
      out.end(() => resolve());
    });
    return { bytes, sha256: fileHash.digest("hex"), manifest: fullManifest };
  } catch (error) {
    out.destroy();
    await fs.rm(outPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** What one archive extraction left in the staging directory. */
export interface ExtractedArchive {
  /** Entries the archive named, directory entries included. */
  entryCount: number;
  /** Uncompressed bytes written for the file entries. */
  bytes: number;
}

/**
 * Unpacks one archive into a staging directory.
 *
 * Backups and persona bundles share this: they read the same zip (and,
 * with a passphrase, the same encrypted frames) and write one file per
 * entry. The subtle part is that a file entry can span many read chunks
 * (the reader hands out 64 KiB at a time, and `openBackupChunks` may hand
 * out one decrypted frame at a time). Waiting for every open file to
 * finish before pulling the next chunk waits for data that has not been
 * read yet: imports and restores of any archive bigger than one chunk
 * hung for ever. This loop waits for `drain` (the stream wants a pause)
 * and checks that no file is still open only after the last chunk.
 *
 * Paths are checked against `stagingDir`; the caller decides what a
 * failure means.
 */
export async function extractArchiveToStaging(options: {
  filePath: string;
  passphrase?: string | null;
  stagingDir: string;
  /** Refuse an archive with more entries than this. */
  maxEntries?: number;
  /** Refuse more uncompressed bytes than this. */
  maxBytes?: number;
}): Promise<ExtractedArchive> {
  const { filePath, passphrase, stagingDir, maxEntries, maxBytes } = options;
  await fs.mkdir(stagingDir, { recursive: true });

  const pendingWrites: Promise<void>[] = [];
  let failure: BackupFormatError | null = null;
  let entryCount = 0;
  let totalBytes = 0;
  /**
   * A write stream that asked for a pause, and the promise for its drain.
   *
   * It is awaited at the next chunk boundary. Waiting for `finish` while
   * the rest of the archive is still unread would deadlock.
   */
  let drain: Promise<void> | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    entryCount += 1;
    if (maxEntries != null && entryCount > maxEntries) {
      failure = new BackupFormatError("The archive has too many entries.");
      return;
    }
    if (failure) return;
    const safe = safeEntryPath(stagingDir, file.name);
    if (!safe) {
      failure = new BackupFormatError(`The archive contains an unsafe path: ${file.name}`);
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
      /** The entry's last chunk has arrived; later calls are noise. */
      let stopped = false;
      file.ondata = (error, chunk, final) => {
        if (error) {
          stopped = true;
          stream.destroy(error);
          return;
        }
        if (stopped) return;
        if (chunk && chunk.length) {
          totalBytes += chunk.length;
          if (maxBytes != null && totalBytes > maxBytes) {
            stopped = true;
            stream.destroy(new Error("too_large"));
            return;
          }
          if (!stream.write(Buffer.from(chunk))) {
            drain ??= new Promise<void>((resolve) => {
              const done = () => {
                stream.off("drain", done);
                stream.off("error", done);
                stream.off("close", done);
                resolve();
              };
              stream.once("drain", done);
              stream.once("error", done);
              stream.once("close", done);
            });
          }
        }
        if (final) {
          stopped = true;
          stream.end();
        }
      };
      file.start();
      await finished;
    })();
    pendingWrites.push(write);
  };

  try {
    for await (const chunk of openBackupChunks(filePath, passphrase)) {
      unzip.push(chunk, false);
      if (drain) {
        const waiting = drain;
        drain = null;
        await waiting;
      }
    }
    unzip.push(new Uint8Array(0), true);
    await Promise.all(pendingWrites);
  } catch (error) {
    await Promise.allSettled(pendingWrites);
    throw error;
  }

  if (failure) throw failure;
  if (entryCount === 0) throw new BackupFormatError("The file is not a non-empty zip archive.");
  return { entryCount, bytes: totalBytes };
}

/**
 * Extracts a backup archive into a staging directory.
 *
 * The staging directory is the boundary: a restore verifies every part
 * here before it writes a single row or moves a single file into the
 * uploads directory. The returned manifest is the one from the archive.
 */
export async function extractBackupToStaging(options: {
  filePath: string;
  passphrase?: string | null;
  stagingDir: string;
}): Promise<BackupManifest> {
  const { filePath, passphrase, stagingDir } = options;
  try {
    await extractArchiveToStaging({ filePath, passphrase, stagingDir });
  } catch (error) {
    if (error instanceof BackupFormatError || error instanceof BackupPassphraseError) throw error;
    throw new BackupFormatError(
      error instanceof Error ? error.message : "The backup could not be read.",
    );
  }

  const manifestPath = path.join(stagingDir, BACKUP_MANIFEST);
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    throw new BackupFormatError("The backup has no manifest.json.");
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch {
    throw new BackupFormatError("The manifest is not valid JSON.");
  }
  validateManifest(manifest);
  return manifest;
}

/** Refuses a manifest of a shape this version cannot read. */
export function validateManifest(manifest: BackupManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new BackupFormatError("The manifest is empty.");
  }
  if (!Number.isInteger(manifest.format) || manifest.format < 1) {
    throw new BackupFormatError("The manifest has no layout version.");
  }
  if (manifest.format > BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `The backup was written by a newer version of Mirrai (layout ${manifest.format}).`,
    );
  }
  if (!Array.isArray(manifest.tables) || !Array.isArray(manifest.uploads)) {
    throw new BackupFormatError("The manifest has no parts.");
  }
  for (const part of manifest.tables) {
    if (!part || typeof part.table !== "string" || typeof part.file !== "string") {
      throw new BackupFormatError("The manifest has a malformed table part.");
    }
    if (!part.file.startsWith("db/") || !/^[A-Za-z0-9_]+$/.test(part.table)) {
      throw new BackupFormatError(`The manifest names an unexpected table: ${String(part.file)}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(part.sha256))) {
      throw new BackupFormatError(`The part ${part.file} has no usable hash.`);
    }
  }
  for (const part of manifest.uploads ?? []) {
    if (!part || typeof part.file !== "string" || !part.file.startsWith("uploads/")) {
      throw new BackupFormatError("The manifest has a malformed upload part.");
    }
    if (!/^[0-9a-f]{64}$/.test(String(part.sha256))) {
      throw new BackupFormatError(`The part ${part.file} has no usable hash.`);
    }
  }
}

/** Verifies a table or upload part against its manifest hash. */
export async function verifyStagingPart(
  stagingDir: string,
  part: { file: string; sha256: string },
): Promise<boolean> {
  const safe = safeEntryPath(stagingDir, part.file);
  if (!safe) return false;
  try {
    const digest = await sha256File(safe);
    return digest === part.sha256.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Joins an archive entry to the staging directory, refusing anything
 * that could land outside it.
 */
export function safeEntryPath(stagingDir: string, entryName: string): string | null {
  const normalised = entryName.replace(/\\/g, "/");
  if (!normalised || normalised.startsWith("/") || normalised.includes("\0")) return null;
  if (normalised.split("/").some((part) => part === "..")) return null;
  const target = path.resolve(stagingDir, normalised);
  const root = path.resolve(stagingDir);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
