import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

/**
 * The two bundle routes (C9.5).
 *
 * Auth, the lock, the size limit and the error sentences are checked here;
 * the file's contents and the import's id rewriting are checked against a
 * real database in `bundle-db.test.ts`.
 */

const authenticateRequest = vi.fn();
const refreshRequestLock = vi.fn();
const rateCheck = vi.fn();
const isEncryptionLocked = vi.fn();
const exportPersonaBundle = vi.fn();
const importPersonaBundle = vi.fn();
const getPersonaById = vi.fn();
const personaLocked = vi.fn();
const sessionKeyFromRequest = vi.fn();

vi.mock("../_core/auth", () => ({
  authenticateRequest: (...a: unknown[]) => authenticateRequest(...a),
}));
vi.mock("../_core/app-lock", () => ({
  refreshRequestLock: (...a: unknown[]) => refreshRequestLock(...a),
  personaLocked: (...a: unknown[]) => personaLocked(...a),
  sessionKeyFromRequest: (...a: unknown[]) => sessionKeyFromRequest(...a),
}));
vi.mock("../db", () => ({
  getPersonaById: (...a: unknown[]) => getPersonaById(...a),
}));
vi.mock("../_core/context", () => ({
  readLocale: () => "zh",
}));
vi.mock("../_core/rate-limit", () => ({
  RATE_LIMITS: { backupDownload: { name: "backup-download" }, upload: { name: "upload" } },
  rateLimiter: { check: (...a: unknown[]) => rateCheck(...a) },
}));
vi.mock("../encryption/lock", () => ({
  isEncryptionLocked: (...a: unknown[]) => isEncryptionLocked(...a),
}));
vi.mock("./bundle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bundle")>();
  return {
    ...actual,
    exportPersonaBundle: (...a: unknown[]) => exportPersonaBundle(...a),
    importPersonaBundle: (...a: unknown[]) => importPersonaBundle(...a),
  };
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPersonaBundleRoutes, BUNDLE_PASSPHRASE_HEADER } from "./bundle-route";
import { BackupPassphraseError } from "../_core/backup-format";

let server: Server;
let baseUrl: string;
let dir: string;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    registerPersonaBundleRoutes(app);
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(os.tmpdir(), "mirrai-bundle-route-"));
  const bundlePath = path.join(dir, "bundle");
  writeFileSync(bundlePath, Buffer.from("a bundle"));
  authenticateRequest.mockResolvedValue({ id: 7, username: "tester" });
  refreshRequestLock.mockResolvedValue(false);
  rateCheck.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 1 });
  isEncryptionLocked.mockResolvedValue(false);
  getPersonaById.mockResolvedValue({ id: 1, name: "小满", settings: {} });
  personaLocked.mockResolvedValue(false);
  sessionKeyFromRequest.mockReturnValue("session-key");
  exportPersonaBundle.mockImplementation(async (options: { outPath: string }) => {
    writeFileSync(options.outPath, Buffer.from("a bundle"));
    return {
      fileName: "小满.mirrai-persona",
      manifest: { counts: { records: 1, memories: 0, messages: 0, stickers: 0, media: 0 } },
    };
  });
  importPersonaBundle.mockResolvedValue({
    personaId: 12,
    name: "小满",
    counts: { records: 2, memories: 1, messages: 0, stickers: 0, media: 0 },
  });
  await startApp();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/persona/bundle", () => {
  it("refuses a request with no session", async () => {
    authenticateRequest.mockRejectedValue(new Error("no session"));
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1 }),
    });
    expect(res.status).toBe(401);
    expect(exportPersonaBundle).not.toHaveBeenCalled();
  });

  it("refuses while the app is locked", async () => {
    refreshRequestLock.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1 }),
    });
    expect(res.status).toBe(403);
    expect(exportPersonaBundle).not.toHaveBeenCalled();
  });

  it("refuses a locked persona that was not unlocked recently", async () => {
    getPersonaById.mockResolvedValue({ id: 1, name: "小满", settings: { locked: true } });
    personaLocked.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1, include: { records: true } }),
    });
    expect(res.status).toBe(403);
    expect(personaLocked).toHaveBeenCalledWith(expect.objectContaining({ locked: true }), "session-key");
    expect(exportPersonaBundle).not.toHaveBeenCalled();
  });

  it("answers 423 while an encrypted account is locked", async () => {
    isEncryptionLocked.mockResolvedValue(true);
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1 }),
    });
    expect(res.status).toBe(423);
    expect(exportPersonaBundle).not.toHaveBeenCalled();
  });

  it("streams the file with its name and the chosen parts", async () => {
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personaId: 3,
        include: { records: true, memories: false },
        passphrase: "long enough passphrase",
      }),
    });
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).toContain("小满.mirrai-persona");
    expect(await res.text()).toBe("a bundle");
    expect(exportPersonaBundle).toHaveBeenCalledWith(expect.objectContaining({
      personaId: 3,
      userId: 7,
      include: { records: true, memories: false, conversation: false },
      passphrase: "long enough passphrase",
    }));
  });

  it("answers 404 for somebody else's persona", async () => {
    exportPersonaBundle.mockRejectedValue(new Error("Persona not found"));
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("refuses a body with no persona id", async () => {
    const res = await fetch(`${baseUrl}/api/persona/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/persona/import-bundle", () => {
  function upload(body: Buffer | string, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/persona/import-bundle`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", ...headers },
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
  }

  it("refuses a request with no session", async () => {
    authenticateRequest.mockRejectedValue(new Error("no session"));
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(401);
    expect(importPersonaBundle).not.toHaveBeenCalled();
  });

  it("refuses an empty body", async () => {
    const res = await upload("");
    expect(res.status).toBe(400);
    expect(importPersonaBundle).not.toHaveBeenCalled();
  });

  it("refuses while an encrypted account is locked", async () => {
    isEncryptionLocked.mockResolvedValue(true);
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(423);
    expect(importPersonaBundle).not.toHaveBeenCalled();
  });

  it("imports the file and answers with the new persona", async () => {
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, personaId: 12, name: "小满" });
    expect(importPersonaBundle).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      passphrase: null,
    }));
  });

  it("passes a base64 passphrase from the header, not the URL", async () => {
    const passphrase = "correct horse battery";
    const res = await upload(Buffer.from("bundle"), {
      [BUNDLE_PASSPHRASE_HEADER]: Buffer.from(passphrase, "utf-8").toString("base64"),
    });
    expect(res.status).toBe(201);
    expect(importPersonaBundle).toHaveBeenCalledWith(expect.objectContaining({ passphrase }));
  });

  it("answers a wrong passphrase with a sentence a person can read", async () => {
    importPersonaBundle.mockRejectedValue(new BackupPassphraseError("wrong_passphrase_or_corrupt"));
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("口令不对");
  });

  it("answers a missing passphrase separately", async () => {
    importPersonaBundle.mockRejectedValue(new BackupPassphraseError("passphrase_required"));
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("需要口令");
  });

  it("rate-limits the import", async () => {
    rateCheck.mockResolvedValue({ allowed: false, retryAfterMs: 1000, remaining: 0 });
    const res = await upload(Buffer.from("bundle"));
    expect(res.status).toBe(429);
    expect(importPersonaBundle).not.toHaveBeenCalled();
  });
});
