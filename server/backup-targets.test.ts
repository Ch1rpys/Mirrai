import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BACKUP_MAGIC, writeBackupArchive } from "./_core/backup-format";
import {
  BackupDeliveryError,
  deleteBackupFile,
  deliverBackupFile,
  s3FileUrl,
  webdavFileUrl,
} from "./backup/targets";

async function encryptedBackup(directory: string): Promise<string> {
  const out = path.join(directory, "backup.mirrai-backup");
  await writeBackupArchive({
    outPath: out,
    passphrase: "correct horse battery",
    manifest: {
      format: 1,
      appVersion: "1.3.0",
      latestMigration: "0079_scene_record_range",
      createdAt: "2026-11-21T00:00:00Z",
      scope: "instance",
      exclusions: [],
    },
    entries: [
      {
        name: "db/users.ndjson",
        compress: true,
        rows: () => 0,
        chunks: async function* () {
          yield Buffer.from("");
        },
      },
    ],
  });
  return out;
}

async function readStreamBody(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("the folder target", () => {
  it("copies the file into the folder", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-target-folder-"));
    try {
      const file = await encryptedBackup(directory);
      const target = path.join(directory, "backups");
      await deliverBackupFile({
        target: { kind: "folder", path: target },
        file,
        fileName: "mirrai-backup-1.mirrai-backup",
      });
      const copied = await fs.readFile(path.join(target, "mirrai-backup-1.mirrai-backup"));
      expect(copied.equals(await fs.readFile(file))).toBe(true);
      await deleteBackupFile({
        target: { kind: "folder", path: target },
        fileName: "mirrai-backup-1.mirrai-backup",
      });
      await expect(fs.stat(path.join(target, "mirrai-backup-1.mirrai-backup"))).rejects.toThrow();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("the WebDAV target", () => {
  it("PUTs the encrypted bytes with basic auth, and deletes by name", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-target-dav-"));
    try {
      const file = await encryptedBackup(directory);
      const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: Buffer }> = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body ? await readStreamBody(init.body) : undefined,
        });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;

      await deliverBackupFile({
        target: { kind: "webdav", url: "https://dav.example.com/mirrai", username: "me" },
        credentials: { password: "dav-pass" },
        file,
        fileName: "mirrai-backup-2.mirrai-backup",
        fetchImpl,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://dav.example.com/mirrai/mirrai-backup-2.mirrai-backup");
      expect(calls[0].method).toBe("PUT");
      expect(calls[0].headers.authorization).toMatch(/^Basic /);
      expect(calls[0].body!.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)).toBe(true);
      expect(calls[0].body!.subarray(0, 2).toString("utf-8")).not.toBe("PK");

      await deleteBackupFile({
        target: { kind: "webdav", url: "https://dav.example.com/mirrai", username: "me" },
        credentials: { password: "dav-pass" },
        fileName: "mirrai-backup-1.mirrai-backup",
        fetchImpl,
      });
      expect(calls[1].method).toBe("DELETE");
      expect(calls[1].url).toBe("https://dav.example.com/mirrai/mirrai-backup-1.mirrai-backup");
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses a WebDAV target with no password", async () => {
    await expect(
      deliverBackupFile({
        target: { kind: "webdav", url: "https://dav.example.com/mirrai", username: "me" },
        file: "/tmp/does-not-matter",
        fileName: "a.zip",
        fetchImpl: (async () => new Response(null)) as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(BackupDeliveryError);
  });
});

describe("the S3 target", () => {
  it("PUTs to the path-style URL with a SigV4 Authorization header", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-target-s3-"));
    try {
      const file = await encryptedBackup(directory);
      const calls: Array<{ url: string; headers: Record<string, string>; body: Buffer }> = [];
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: await readStreamBody(init?.body),
        });
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;

      const target = {
        kind: "s3" as const,
        endpoint: "https://s3.example.com",
        bucket: "my-bucket",
        region: "us-east-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      };
      await deliverBackupFile({
        target,
        credentials: { secretAccessKey: "secret" },
        file,
        fileName: "mirrai-backup-3.mirrai-backup",
        fetchImpl,
        now: new Date("2026-01-02T03:04:05Z"),
      });
      expect(calls[0].url).toBe(
        "https://s3.example.com/my-bucket/mirrai-backup-3.mirrai-backup",
      );
      expect(calls[0].headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260102\/us-east-1\/s3\/aws4_request, /,
      );
      expect(calls[0].headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
      expect(calls[0].body.equals(await fs.readFile(file))).toBe(true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("signs a DELETE with the empty-payload hash", async () => {
    const calls: Array<{ method?: string; authorization?: string }> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        method: init?.method,
        authorization: (init?.headers as Record<string, string>)?.authorization,
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await deleteBackupFile({
      target: {
        kind: "s3",
        endpoint: "https://s3.example.com",
        bucket: "b",
        region: "us-east-1",
        accessKeyId: "AKIA",
      },
      credentials: { secretAccessKey: "secret" },
      fileName: "old.mirrai-backup",
      fetchImpl,
    });
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });
});

describe("URLs", () => {
  it("encodes the file name and keeps the target's own path", () => {
    expect(webdavFileUrl("https://dav.example.com/a/", "x y.zip")).toBe(
      "https://dav.example.com/a/x%20y.zip",
    );
    expect(
      s3FileUrl(
        {
          kind: "s3",
          endpoint: "https://s3.example.com/",
          bucket: "b",
          region: "r",
          accessKeyId: "k",
          prefix: "backups/daily",
        },
        "x.zip",
      ),
    ).toBe("https://s3.example.com/b/backups/daily/x.zip");
  });
});
