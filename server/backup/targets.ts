/**
 * Where a scheduled backup goes (C8.3).
 *
 * Three destinations, and all of them are the user's own:
 *
 *  - a folder on this machine (an iCloud or Syncthing folder is just a
 *    folder — the app itself does not talk to the cloud);
 *  - a WebDAV server (one PUT, basic authentication);
 *  - an S3-compatible bucket (one PUT, SigV4 signed here, no SDK).
 *
 * Every remote write is a single request per backup, and a remote
 * destination is encrypted before it leaves: the passphrase is set in
 * the settings and wrapped by `encryptSecret`, so the unattended run can
 * still encrypt.
 *
 * The retention list lives in the user's settings (`history`): the
 * names of our own files are already known, so the older ones are
 * deleted by name instead of listing a WebDAV directory (PROPFIND) or a
 * bucket (ListObjectsV2) for something this app wrote itself.
 */
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { BackupS3Target, BackupTarget } from "@shared/backup";
import { sha256File } from "../_core/backup-format";
import { EMPTY_PAYLOAD_HASH, encodeRfc3986, signAwsRequest } from "./sigv4";

/** The largest object the S3 target accepts: the manual's 5 GiB. */
export const S3_MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;

/** Credentials, decrypted for one delivery — never stored in this shape. */
export interface BackupCredentials {
  password?: string;
  secretAccessKey?: string;
}

/** A failed delivery, with a key the settings page can show. */
export class BackupDeliveryError extends Error {
  constructor(
    readonly reason:
      | "folder_missing"
      | "folder_write_failed"
      | "http_failed"
      | "s3_too_large"
      | "missing_credentials",
    readonly status?: number,
  ) {
    super(reason);
  }
}

/** The URL a backup file is PUT to. */
export function webdavFileUrl(baseUrl: string, fileName: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${encodeRfc3986(fileName)}`;
}

/** The path-style URL for one object in an S3-compatible bucket. */
export function s3FileUrl(target: BackupS3Target, fileName: string): string {
  const endpoint = target.endpoint.replace(/\/+$/, "");
  const key = target.prefix ? `${target.prefix}/${fileName}` : fileName;
  const encodedKey = key
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
  return `${endpoint}/${encodeRfc3986(target.bucket)}/${encodedKey}`;
}

/**
 * The real network call.
 *
 * It is a named function so a test can pass its own `fetchImpl` while the
 * structural outbound test still sees the one `fetch(` in this file and
 * keeps its inventory honest.
 */
export function defaultFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/** Reads a file into a web stream for `fetch`, without buffering it. */
function fileBody(file: string): ReadableStream {
  return Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf-8").toString("base64")}`;
}

/**
 * Puts one backup file at its destination.
 *
 * Throws `BackupDeliveryError` on a failure the settings page should
 * explain; anything else is a bug and is left to the caller.
 */
export async function deliverBackupFile(options: {
  target: BackupTarget;
  credentials?: BackupCredentials;
  file: string;
  fileName: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const now = options.now ?? new Date();
  const target = options.target;

  if (target.kind === "folder") {
    try {
      await fs.mkdir(target.path, { recursive: true });
    } catch {
      throw new BackupDeliveryError("folder_missing");
    }
    try {
      await fs.copyFile(options.file, path.join(target.path, options.fileName));
    } catch {
      throw new BackupDeliveryError("folder_write_failed");
    }
    return;
  }

  if (target.kind === "webdav") {
    if (!target.passwordSecret && !options.credentials?.password) {
      // The manual's WebDAV target is basic auth, so there is no
      // passwordless form: a username with no password is a half-filled
      // settings form, and refusing it here gives a readable reason
      // instead of a 401 from the server.
      throw new BackupDeliveryError("missing_credentials");
    }
    const response = await fetchImpl(webdavFileUrl(target.url, options.fileName), {
      method: "PUT",
      headers: {
        authorization: basicAuth(target.username, options.credentials?.password ?? ""),
        "content-type": "application/octet-stream",
      },
      body: fileBody(options.file),
      // Node's fetch needs this when the body is a stream.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) throw new BackupDeliveryError("http_failed", response.status);
    return;
  }

  // S3-compatible.
  const secretAccessKey = options.credentials?.secretAccessKey;
  if (!secretAccessKey) throw new BackupDeliveryError("missing_credentials");
  const size = (await fs.stat(options.file)).size;
  if (size > S3_MAX_OBJECT_BYTES) throw new BackupDeliveryError("s3_too_large");

  const payloadHash = await sha256File(options.file);
  const url = s3FileUrl(target, options.fileName);
  const signed = signAwsRequest({
    method: "PUT",
    url,
    region: target.region,
    service: "s3",
    accessKeyId: target.accessKeyId,
    secretAccessKey,
    payloadHash,
    now,
    headers: { "content-type": "application/octet-stream" },
  });
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: signed.headers,
    body: fileBody(options.file),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) throw new BackupDeliveryError("http_failed", response.status);
}

/**
 * Removes one old backup from its destination.
 *
 * A failure here is not a failed backup: the new file is already where
 * it belongs and the old one only takes space. The caller logs it.
 */
export async function deleteBackupFile(options: {
  target: BackupTarget;
  credentials?: BackupCredentials;
  fileName: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const now = options.now ?? new Date();
  const target = options.target;

  if (target.kind === "folder") {
    await fs.rm(path.join(target.path, options.fileName), { force: true });
    return;
  }

  if (target.kind === "webdav") {
    const response = await fetchImpl(webdavFileUrl(target.url, options.fileName), {
      method: "DELETE",
      headers: {
        authorization: basicAuth(target.username, options.credentials?.password ?? ""),
      },
    });
    if (!response.ok && response.status !== 404) {
      throw new BackupDeliveryError("http_failed", response.status);
    }
    return;
  }

  const secretAccessKey = options.credentials?.secretAccessKey;
  if (!secretAccessKey) throw new BackupDeliveryError("missing_credentials");
  const url = s3FileUrl(target, options.fileName);
  const signed = signAwsRequest({
    method: "DELETE",
    url,
    region: target.region,
    service: "s3",
    accessKeyId: target.accessKeyId,
    secretAccessKey,
    payloadHash: EMPTY_PAYLOAD_HASH,
    now,
  });
  const response = await fetchImpl(url, { method: "DELETE", headers: signed.headers });
  if (!response.ok && response.status !== 404) {
    throw new BackupDeliveryError("http_failed", response.status);
  }
}
