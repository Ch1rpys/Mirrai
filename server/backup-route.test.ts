import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copy } from "@shared/copy";

const authenticateRequest = vi.fn();
const instanceIsEmptyForRoute = vi.fn();
const restoreBackupForRoute = vi.fn();
const createBackupForDownload = vi.fn();

vi.mock("./_core/auth", () => ({
  authenticateRequest: (...a: unknown[]) => authenticateRequest(...a),
}));

vi.mock("./backup/service", () => ({
  instanceIsEmptyForRoute: (...a: unknown[]) => instanceIsEmptyForRoute(...a),
  restoreBackupForRoute: (...a: unknown[]) => restoreBackupForRoute(...a),
}));

vi.mock("./_core/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/backup")>();
  return {
    ...actual,
    createBackupForDownload: (...a: unknown[]) => createBackupForDownload(...a),
  };
});

vi.mock("./_core/rate-limit", () => ({
  RATE_LIMITS: {
    backupDownload: { name: "backup-download", limit: 6, windowMs: 3_600_000, scope: "user" },
    backupRestore: { name: "backup-restore", limit: 5, windowMs: 900_000, scope: "ip" },
  },
  rateLimiter: { check: vi.fn(() => ({ allowed: true, retryAfterMs: 0, remaining: 5 })) },
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { registerBackupRoutes } from "./backup/route";

let server: Server;
let baseUrl: string;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    registerBackupRoutes(app);
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

describe("backup routes", () => {
  beforeEach(async () => {
    authenticateRequest.mockReset();
    instanceIsEmptyForRoute.mockReset();
    restoreBackupForRoute.mockReset();
    createBackupForDownload.mockReset();
    authenticateRequest.mockResolvedValue({ id: 7, username: "tester" });
    instanceIsEmptyForRoute.mockResolvedValue(true);
    await startApp();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("says whether a restore is possible", async () => {
    const response = await fetch(`${baseUrl}/api/backup/available`);
    expect(await response.json()).toEqual({ available: true });
  });

  it("downloads the signed-in user's own encrypted backup", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mirrai-route-dl-"));
    try {
      const file = path.join(directory, "mirrai-backup-x.mirrai-backup");
      await fs.writeFile(file, Buffer.from("ENCRYPTED-BYTES"));
      createBackupForDownload.mockResolvedValue({
        path: file,
        fileName: "mirrai-backup-x.mirrai-backup",
        bytes: 15,
      });
      const response = await fetch(`${baseUrl}/api/backup/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase: "correct horse battery" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(
        "mirrai-backup-x.mirrai-backup",
      );
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("ENCRYPTED-BYTES");
      expect(createBackupForDownload).toHaveBeenCalledWith({
        scope: 7,
        passphrase: "correct horse battery",
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a download with no session or no passphrase", async () => {
    authenticateRequest.mockRejectedValueOnce(new Error("no session"));
    const anonymous = await fetch(`${baseUrl}/api/backup/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "correct horse battery" }),
    });
    expect(anonymous.status).toBe(401);

    const noPassphrase = await fetch(`${baseUrl}/api/backup/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noPassphrase.status).toBe(400);
    expect(createBackupForDownload).not.toHaveBeenCalled();
  });

  it("refuses a restore when the instance already has an account", async () => {
    instanceIsEmptyForRoute.mockResolvedValue(false);
    const response = await fetch(`${baseUrl}/api/backup/restore`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("whatever"),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(copy("zh", "backup.errorNotEmpty"));
    expect(restoreBackupForRoute).not.toHaveBeenCalled();
  });

  it("restores an uploaded archive, passing the passphrase from the header", async () => {
    restoreBackupForRoute.mockResolvedValue({
      manifest: { createdAt: "2026-11-21T00:00:00Z", appVersion: "1.3.0" },
      tables: 56,
      rows: 120,
      files: 3,
      migrations: [],
    });
    const passphrase = Buffer.from("correct horse battery", "utf-8").toString("base64");
    const response = await fetch(`${baseUrl}/api/backup/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-mirrai-backup-passphrase": passphrase,
      },
      body: Buffer.from("ARCHIVE-BYTES"),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.rows).toBe(120);
    const calledWith = restoreBackupForRoute.mock.calls[0][0] as { file: string; passphrase: string };
    expect(calledWith.passphrase).toBe("correct horse battery");
  });

  it("maps a wrong passphrase to its own sentence", async () => {
    const error = new Error("wrong");
    error.name = "BackupPassphraseError";
    (error as unknown as { kind: string }).kind = "wrong_passphrase_or_corrupt";
    restoreBackupForRoute.mockRejectedValue(error);
    const response = await fetch(`${baseUrl}/api/backup/restore`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-mirrai-backup-passphrase": Buffer.from("wrong pass").toString("base64"),
      },
      body: Buffer.from("ARCHIVE"),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(copy("zh", "backup.errorWrongPassphrase"));
  });
});
